import { bold, cyan, dim, green, red, yellow, yellowBright } from "colorette";
import {
  colorByStatus,
  formatBytes,
  formatNumber,
  formatPercent,
  renderBar,
  stripAnsi,
} from "../../utils/format.js";
import { NO_TTL_WARNING_PERCENT } from "../../utils/thresholds.js";

/**
 * Render the Keys tab content.
 *
 * @param {{ result: object, cols: number, contentRows: number, noScan: boolean }} options
 * @returns {string[]}
 */
export function renderKeysTab({ result, cols, contentRows, noScan }) {
  const lines = [];

  if (noScan) {
    lines.push("");
    lines.push(`  ${dim("Key scanning is disabled (--no-scan).")}`);
    lines.push(`  ${dim("Remove --no-scan to enable key pattern analysis.")}`);
    while (lines.length < contentRows) {
      lines.push("");
    }
    return lines.slice(0, contentRows);
  }

  const metrics = result.results.keyPatterns?.metrics;

  if (!metrics || (!metrics.totalKeys && metrics.totalKeys !== 0)) {
    lines.push("");
    lines.push("  No key data available.");
    while (lines.length < contentRows) {
      lines.push("");
    }
    return lines.slice(0, contentRows);
  }

  lines.push("");

  const confidenceColors = { high: green, medium: yellow, low: red };
  const confidenceColor = confidenceColors[metrics.confidence] || dim;
  const confidenceLabel = metrics.confidence
    ? `  ${confidenceColor(`[${metrics.confidence} confidence]`)}`
    : "";
  const sampleNote = metrics.sampledCount
    ? dim(` (sampled ${formatNumber(metrics.sampledCount)} of ${formatNumber(metrics.totalKeys)})`) + confidenceLabel
    : "";
  lines.push(`  ${dim("Total Keys:".padEnd(22))} ${bold(formatNumber(metrics.totalKeys))}${sampleNote}`);
  lines.push("");

  // Type distribution
  if (metrics.typeDistribution) {
    lines.push(`  ${bold("Type Distribution:")}`);
    const typeEntries = Object.entries(metrics.typeDistribution).sort(
      (a, b) => b[1].count - a[1].count
    );
    const maxTypeCount = typeEntries[0]?.[1]?.count || 1;

    for (const [type, data] of typeEntries) {
      const percentage = metrics.sampledCount > 0 ? (data.count / metrics.sampledCount) * 100 : 0;
      const ratio = data.count / maxTypeCount;
      const bar = renderBar(ratio, 15, "ok");
      const label = `  ${type}`.padEnd(18);
      lines.push(
        `  ${cyan(label)} ${String(data.count).padStart(6)} ${dim(`(${formatPercent(percentage).padStart(6)})`)}  ${bar}  ${dim(`~${formatBytes(data.totalBytes)}`)}`
      );
    }
    lines.push("");
  }

  // TTL distribution
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

    lines.push(`  ${bold("TTL Distribution:")}`);

    const ttlRows = [
      ["No expiry", distribution.none, distribution.none >= total * (NO_TTL_WARNING_PERCENT / 100) ? "warning" : "ok"],
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
      lines.push(`    ${dim(label.padEnd(12))} ${String(count).padStart(6)} ${percentText}  ${bar}`);
    }
    lines.push("");
  }

  // Top largest keys
  if (metrics.topKeys && metrics.topKeys.length > 0) {
    const keyColWidth = Math.max(20, cols - 40);
    lines.push(`  ${bold("Top Largest Keys:")}`);
    lines.push(`  ${dim("Size".padEnd(12))} ${dim("Type".padEnd(10))} ${dim("Key")}`);
    lines.push(`  ${dim("─".repeat(12))} ${dim("─".repeat(10))} ${dim("─".repeat(Math.min(keyColWidth, 50)))}`);

    for (const entry of metrics.topKeys) {
      const keyText = entry.key.length > keyColWidth ? entry.key.slice(0, keyColWidth - 3) + "..." : entry.key;
      lines.push(`  ${formatBytes(entry.bytes).padEnd(12)} ${dim(entry.type.padEnd(10))} ${keyText}`);
    }
    lines.push("");
  }

  // Prefix groups
  if (metrics.sortedPrefixes && metrics.sortedPrefixes.length > 0) {
    lines.push(`  ${bold("Key Prefix Groups")} ${dim("(by memory):")}`);
    lines.push(`  ${dim("Prefix".padEnd(30))} ${dim("Keys".padStart(8))} ${dim("Memory".padStart(12))}`);
    lines.push(`  ${dim("─".repeat(30))} ${dim("─".repeat(8))} ${dim("─".repeat(12))}`);

    for (const [prefix, data] of metrics.sortedPrefixes) {
      const prefixText = prefix.length > 28 ? prefix.slice(0, 25) + "..." : prefix;
      lines.push(`  ${prefixText.padEnd(30)} ${formatNumber(data.count).padStart(8)} ${("~" + formatBytes(data.totalBytes)).padStart(12)}`);
    }
  }

  // Findings
  if (result.results.keyPatterns?.findings?.length > 0) {
    lines.push("");
    lines.push(`  ${bold("Findings:")}`);
    for (const finding of result.results.keyPatterns.findings) {
      const icon = result.results.keyPatterns.status === "critical" ? red("✗") : yellow("⚠");
      const colored = result.results.keyPatterns.status === "critical" ? red(finding) : yellowBright(finding);
      lines.push(`    ${icon}  ${colored}`);
    }
  }

  while (lines.length < contentRows) {
    lines.push("");
  }
  return lines.slice(0, contentRows);
}
