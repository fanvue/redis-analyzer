import { parseInfoSection } from "../utils/connection.js";
import {
  bold,
  colorByStatus,
  dim,
  formatBytes,
  formatPercent,
  printFinding,
  printMetric,
  printSectionHeader,
  renderBar,
} from "../utils/format.js";
import {
  FRAGMENTATION_CRITICAL,
  FRAGMENTATION_WARNING,
  MEMORY_USAGE_CRITICAL_PERCENT,
  MEMORY_USAGE_WARNING_PERCENT,
} from "../utils/thresholds.js";

/**
 * Run memory analysis against a Redis instance.
 *
 * @param {import("ioredis").Redis} redis
 * @returns {Promise<{status: string, title: string, metrics: object, findings: string[]}>}
 */
export async function runMemoryCheck(redis) {
  const title = "MEMORY ANALYSIS";
  const findings = [];
  let status = "ok";

  try {
    const infoRaw = await redis.info("memory");
    const info = parseInfoSection(infoRaw);

    const usedMemory = parseInt(info.used_memory || "0", 10);
    const usedMemoryHuman = info.used_memory_human || "N/A";
    const peakMemory = parseInt(info.used_memory_peak || "0", 10);
    const peakMemoryHuman = info.used_memory_peak_human || "N/A";
    const maxMemory = parseInt(info.maxmemory || "0", 10);
    const maxMemoryPolicy = info.maxmemory_policy || "N/A";
    const fragmentationRatio = parseFloat(info.mem_fragmentation_ratio || "0");
    const evictedKeys = parseInt(info.evicted_keys || "0", 10);
    const usedMemoryOverhead = parseInt(info.used_memory_overhead || "0", 10);
    const usedMemoryDataset = parseInt(info.used_memory_dataset || "0", 10);
    const luaMemory = parseInt(info.used_memory_lua || "0", 10);

    // Check memory utilization
    let memoryUtilization = 0;
    if (maxMemory > 0) {
      memoryUtilization = (usedMemory / maxMemory) * 100;
      if (memoryUtilization >= MEMORY_USAGE_CRITICAL_PERCENT) {
        status = "critical";
        findings.push(
          `Memory usage at ${formatPercent(memoryUtilization)} of maxmemory - critically high`
        );
      } else if (memoryUtilization >= MEMORY_USAGE_WARNING_PERCENT) {
        status = "warning";
        findings.push(
          `Memory usage at ${formatPercent(memoryUtilization)} of maxmemory - approaching limit`
        );
      }
    } else {
      findings.push("maxmemory is not set (unlimited) - consider setting a limit for production");
      status = "warning";
    }

    // Check fragmentation
    if (fragmentationRatio >= FRAGMENTATION_CRITICAL) {
      status = "critical";
      findings.push(
        `Fragmentation ratio ${fragmentationRatio.toFixed(2)} is critically high (>= ${FRAGMENTATION_CRITICAL})`
      );
    } else if (fragmentationRatio >= FRAGMENTATION_WARNING) {
      if (status !== "critical") {
        status = "warning";
      }
      findings.push(
        `Fragmentation ratio ${fragmentationRatio.toFixed(2)} is elevated (>= ${FRAGMENTATION_WARNING})`
      );
    }

    // Check evictions
    if (evictedKeys > 0) {
      if (status !== "critical") {
        status = "warning";
      }
      findings.push(
        `${evictedKeys.toLocaleString("en-US")} keys have been evicted - memory pressure detected`
      );
    }

    const metrics = {
      usedMemory,
      usedMemoryHuman,
      peakMemory,
      peakMemoryHuman,
      maxMemory,
      maxMemoryPolicy,
      fragmentationRatio,
      evictedKeys,
      usedMemoryOverhead,
      usedMemoryDataset,
      luaMemory,
      memoryUtilization,
    };

    return { status, title, metrics, findings };
  } catch (error) {
    findings.push(`Memory check failed: ${error.message}`);
    return { status: "critical", title, metrics: {}, findings };
  }
}

/**
 * Print the memory check results to the console.
 *
 * @param {{status: string, title: string, metrics: object, findings: string[]}} result
 */
export function printMemoryCheck(result) {
  printSectionHeader(result.title, result.status);
  const metrics = result.metrics;

  if (!metrics.usedMemory && metrics.usedMemory !== 0) {
    printFinding(result.findings[0] || "No data available", "critical");
    return;
  }

  if (metrics.maxMemory > 0) {
    const memoryStatus =
      metrics.memoryUtilization >= MEMORY_USAGE_CRITICAL_PERCENT
        ? "critical"
        : metrics.memoryUtilization >= MEMORY_USAGE_WARNING_PERCENT
          ? "warning"
          : "ok";
    const bar = renderBar(metrics.memoryUtilization / 100, 20, memoryStatus);
    const percentText = colorByStatus(bold(formatPercent(metrics.memoryUtilization)), memoryStatus);
    printMetric(
      "Used Memory:",
      `${metrics.usedMemoryHuman} / ${formatBytes(metrics.maxMemory)}  ${bar}  ${percentText}`
    );
  } else {
    printMetric("Used Memory:", `${metrics.usedMemoryHuman} ${dim("(no maxmemory set)")}`);
  }

  printMetric("Peak Memory:", metrics.peakMemoryHuman);

  const fragmentationStatus =
    metrics.fragmentationRatio >= FRAGMENTATION_CRITICAL
      ? "critical"
      : metrics.fragmentationRatio >= FRAGMENTATION_WARNING
        ? "warning"
        : "ok";
  printMetric(
    "Fragmentation Ratio:",
    colorByStatus(bold(metrics.fragmentationRatio.toFixed(2)), fragmentationStatus)
  );

  printMetric("Eviction Policy:", metrics.maxMemoryPolicy);
  printMetric(
    "Evicted Keys:",
    metrics.evictedKeys > 0
      ? colorByStatus(bold(metrics.evictedKeys.toLocaleString("en-US")), "warning")
      : dim("0")
  );
  printMetric(
    "Dataset / Overhead:",
    `${formatBytes(metrics.usedMemoryDataset)} ${dim("/")} ${formatBytes(metrics.usedMemoryOverhead)}`
  );

  if (metrics.luaMemory > 0) {
    printMetric("Lua Memory:", formatBytes(metrics.luaMemory));
  }

  for (const finding of result.findings) {
    printFinding(finding);
  }
}
