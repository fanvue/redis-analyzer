import { parseInfoSection } from "../utils/connection.js";
import {
  bold,
  colorByStatus,
  cyan,
  dim,
  formatBytes,
  formatNumber,
  formatPercent,
  printFinding,
  printSectionHeader,
  printTable,
  renderBar,
} from "../utils/format.js";
import {
  DEFAULT_SCAN_COUNT,
  NO_TTL_WARNING_PERCENT,
  PIPELINE_BATCH_SIZE,
  SCAN_BATCH_SIZE,
  TOP_KEYS_COUNT,
} from "../utils/thresholds.js";

/**
 * Run key pattern analysis against a Redis instance.
 * Uses SCAN for production-safe, non-blocking key sampling.
 *
 * @param {import("ioredis").Redis} redis
 * @param {object} options
 * @param {number} [options.scanCount] - Number of keys to sample
 * @returns {Promise<{status: string, title: string, metrics: object, findings: string[]}>}
 */
export async function runKeyPatternCheck(redis, options = {}) {
  const title = "KEY PATTERN ANALYSIS";
  const findings = [];
  let status = "ok";
  const maxSampleKeys = options.scanCount || DEFAULT_SCAN_COUNT;

  try {
    // Get keyspace overview from INFO
    const keyspaceRaw = await redis.info("keyspace");
    const keyspaceInfo = parseInfoSection(keyspaceRaw);

    let totalKeys = 0;
    let totalExpiring = 0;
    const databases = {};

    for (const [key, value] of Object.entries(keyspaceInfo)) {
      if (!key.startsWith("db")) {
        continue;
      }
      const parts = value.split(",");
      const keysCount = parseInt(parts[0]?.split("=")[1] || "0", 10);
      const expires = parseInt(parts[1]?.split("=")[1] || "0", 10);
      databases[key] = { keys: keysCount, expires };
      totalKeys += keysCount;
      totalExpiring += expires;
    }

    if (totalKeys === 0) {
      return {
        status: "ok",
        title,
        metrics: { totalKeys: 0, databases },
        findings: ["No keys found in this Redis instance"],
      };
    }

    // Sample keys using SCAN
    const sampledKeys = [];
    let cursor = "0";

    do {
      const [nextCursor, keys] = await redis.scan(cursor, "COUNT", SCAN_BATCH_SIZE);
      cursor = nextCursor;
      sampledKeys.push(...keys);
    } while (cursor !== "0" && sampledKeys.length < maxSampleKeys);

    // Trim to max sample size
    if (sampledKeys.length > maxSampleKeys) {
      sampledKeys.length = maxSampleKeys;
    }

    // Analyze sampled keys using pipelines
    const typeDistribution = {};
    const encodingDistribution = {};
    const timeToLiveDistribution = {
      none: 0,
      under1Hour: 0,
      from1HourTo24Hours: 0,
      from1DayTo7Days: 0,
      over7Days: 0,
    };
    const keySizes = [];
    const prefixGroups = {};

    for (let batchIndex = 0; batchIndex < sampledKeys.length; batchIndex += PIPELINE_BATCH_SIZE) {
      const batch = sampledKeys.slice(batchIndex, batchIndex + PIPELINE_BATCH_SIZE);
      const pipeline = redis.pipeline();

      for (const key of batch) {
        pipeline.type(key);
        pipeline.memory("USAGE", key, "SAMPLES", "0");
        pipeline.ttl(key);
        pipeline.object("ENCODING", key);
      }

      const results = await pipeline.exec();

      for (let keyIndex = 0; keyIndex < batch.length; keyIndex++) {
        const key = batch[keyIndex];
        const baseOffset = keyIndex * 4;

        const typeResult = results[baseOffset];
        const memoryResult = results[baseOffset + 1];
        const timeToLiveResult = results[baseOffset + 2];
        const encodingResult = results[baseOffset + 3];

        // Type distribution
        const keyType = typeResult?.[1] || "unknown";
        if (!typeDistribution[keyType]) {
          typeDistribution[keyType] = { count: 0, totalBytes: 0 };
        }
        typeDistribution[keyType].count++;

        // Memory usage
        const memoryBytes = memoryResult?.[1] || 0;
        typeDistribution[keyType].totalBytes += memoryBytes;
        keySizes.push({ key, type: keyType, bytes: memoryBytes });

        // TTL distribution
        const timeToLive = timeToLiveResult?.[1];
        if (timeToLive === -1) {
          timeToLiveDistribution.none++;
        } else if (timeToLive < 3600) {
          timeToLiveDistribution.under1Hour++;
        } else if (timeToLive < 86400) {
          timeToLiveDistribution.from1HourTo24Hours++;
        } else if (timeToLive < 604800) {
          timeToLiveDistribution.from1DayTo7Days++;
        } else {
          timeToLiveDistribution.over7Days++;
        }

        // Encoding distribution
        const encoding = encodingResult?.[1] || "unknown";
        encodingDistribution[encoding] = (encodingDistribution[encoding] || 0) + 1;

        // Prefix grouping (split on first colon)
        const colonIndex = key.indexOf(":");
        const prefix = colonIndex > 0 ? key.slice(0, colonIndex) + ":*" : key;
        if (!prefixGroups[prefix]) {
          prefixGroups[prefix] = { count: 0, totalBytes: 0 };
        }
        prefixGroups[prefix].count++;
        prefixGroups[prefix].totalBytes += memoryBytes;
      }
    }

    // Sort keys by size for top-N
    keySizes.sort((a, b) => b.bytes - a.bytes);
    const topKeys = keySizes.slice(0, TOP_KEYS_COUNT);

    // Check no-TTL percentage
    const noTimeToLivePercent =
      sampledKeys.length > 0 ? (timeToLiveDistribution.none / sampledKeys.length) * 100 : 0;

    if (noTimeToLivePercent >= NO_TTL_WARNING_PERCENT) {
      status = "warning";
      findings.push(
        `${formatPercent(noTimeToLivePercent)} of sampled keys have no TTL - potential memory growth risk`
      );
    }

    // Sort prefix groups by total memory
    const sortedPrefixes = Object.entries(prefixGroups)
      .sort((a, b) => b[1].totalBytes - a[1].totalBytes)
      .slice(0, 15);

    const metrics = {
      totalKeys,
      totalExpiring,
      databases,
      sampledCount: sampledKeys.length,
      typeDistribution,
      encodingDistribution,
      timeToLiveDistribution,
      topKeys,
      noTimeToLivePercent,
      sortedPrefixes,
    };

    return { status, title, metrics, findings };
  } catch (error) {
    findings.push(`Key pattern check failed: ${error.message}`);
    return { status: "critical", title, metrics: {}, findings };
  }
}

/**
 * Print the key pattern check results to the console.
 *
 * @param {{status: string, title: string, metrics: object, findings: string[]}} result
 */
export function printKeyPatternCheck(result) {
  printSectionHeader(result.title, result.status);
  const metrics = result.metrics;

  if (!metrics.totalKeys && metrics.totalKeys !== 0) {
    printFinding(result.findings[0] || "No data available", "critical");
    return;
  }

  const sampleNote = metrics.sampledCount
    ? dim(` (sampled ${formatNumber(metrics.sampledCount)} of ${formatNumber(metrics.totalKeys)})`)
    : "";
  console.info(
    `    ${dim("Total Keys:".padEnd(22))} ${bold(formatNumber(metrics.totalKeys))}${sampleNote}`
  );

  // Database distribution
  const databaseEntries = Object.entries(metrics.databases || {});
  if (databaseEntries.length > 0) {
    for (const [database, info] of databaseEntries) {
      const expiryRatio = info.keys > 0 ? info.expires / info.keys : 0;
      const bar = renderBar(expiryRatio, 10, "ok");
      console.info(
        `    ${dim(`${database}:`.padEnd(22))} ${bold(formatNumber(info.keys))} keys  ${bar}  ${dim(`${formatNumber(info.expires)} with expiry`)}`
      );
    }
  }

  // Type distribution with bar chart
  if (metrics.typeDistribution) {
    console.info("");
    console.info(`    ${bold("Type Distribution:")}`);
    const typeEntries = Object.entries(metrics.typeDistribution).sort(
      (a, b) => b[1].count - a[1].count
    );
    const maxTypeCount = typeEntries[0]?.[1]?.count || 1;

    for (const [type, data] of typeEntries) {
      const percentage = metrics.sampledCount > 0 ? (data.count / metrics.sampledCount) * 100 : 0;
      const ratio = data.count / maxTypeCount;
      const bar = renderBar(ratio, 15, "ok");
      const label = `  ${type}`.padEnd(22);
      console.info(
        `    ${cyan(label)} ${String(data.count).padStart(6)} ${dim(`(${formatPercent(percentage).padStart(6)})`)}  ${bar}  ${dim(`~${formatBytes(data.totalBytes)}`)}`
      );
    }
  }

  // Top largest keys as table
  if (metrics.topKeys && metrics.topKeys.length > 0) {
    console.info("");
    console.info(`    ${bold("Top Largest Keys:")}`);

    const rows = metrics.topKeys.map((entry) => [formatBytes(entry.bytes), entry.type, entry.key]);

    printTable({
      headers: ["Size", "Type", "Key"],
      widths: [10, 8, 48],
      alignments: ["right", "left", "left"],
      rows,
      indent: "    ",
    });
  }

  // TTL distribution with bar chart
  if (metrics.timeToLiveDistribution) {
    const distribution = metrics.timeToLiveDistribution;
    const total = metrics.sampledCount || 1;
    const maxTimeToLive =
      Math.max(
        distribution.none,
        distribution.under1Hour,
        distribution.from1HourTo24Hours,
        distribution.from1DayTo7Days,
        distribution.over7Days
      ) || 1;

    console.info("");
    console.info(`    ${bold("TTL Distribution:")}`);

    const ttlRows = [
      [
        "No expiry",
        distribution.none,
        distribution.none >= total * (NO_TTL_WARNING_PERCENT / 100) ? "warning" : "ok",
      ],
      ["< 1 hour", distribution.under1Hour, "ok"],
      ["1h - 24h", distribution.from1HourTo24Hours, "ok"],
      ["1d - 7d", distribution.from1DayTo7Days, "ok"],
      ["> 7 days", distribution.over7Days, "ok"],
    ];

    for (const [label, count, barStatus] of ttlRows) {
      const percentage = (count / total) * 100;
      const bar = renderBar(count / maxTimeToLive, 15, barStatus);
      const percentText =
        barStatus === "warning"
          ? colorByStatus(formatPercent(percentage).padStart(6), "warning")
          : dim(formatPercent(percentage).padStart(6));
      console.info(
        `      ${dim(label.padEnd(12))} ${String(count).padStart(6)} ${percentText}  ${bar}`
      );
    }
  }

  // Key prefix groups as table
  if (metrics.sortedPrefixes && metrics.sortedPrefixes.length > 0) {
    console.info("");
    console.info(`    ${bold("Key Prefix Groups")} ${dim("(by memory):")}`);

    const rows = metrics.sortedPrefixes.map(([prefix, data]) => [
      prefix,
      formatNumber(data.count),
      `~${formatBytes(data.totalBytes)}`,
    ]);

    printTable({
      headers: ["Prefix", "Keys", "Memory"],
      widths: [35, 8, 12],
      alignments: ["left", "right", "right"],
      rows,
      indent: "    ",
    });
  }

  for (const finding of result.findings) {
    printFinding(finding);
  }
}
