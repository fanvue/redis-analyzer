import { bold, dim, red, yellow, yellowBright } from "colorette";
import {
  colorByStatus,
  formatBytes,
  formatPercent,
  renderBar,
} from "../../utils/format.js";
import {
  FRAGMENTATION_CRITICAL,
  FRAGMENTATION_WARNING,
  MEMORY_USAGE_CRITICAL_PERCENT,
  MEMORY_USAGE_WARNING_PERCENT,
} from "../../utils/thresholds.js";

/**
 * Render the Memory tab content.
 *
 * @param {{ result: object, cols: number, contentRows: number }} options
 * @returns {string[]}
 */
export function renderMemoryTab({ result, cols, contentRows }) {
  const lines = [];
  const metrics = result.results.memory?.metrics;

  if (!metrics || (!metrics.usedMemory && metrics.usedMemory !== 0)) {
    lines.push("");
    lines.push("  No memory data available.");
    while (lines.length < contentRows) {
      lines.push("");
    }
    return lines.slice(0, contentRows);
  }

  lines.push("");

  // Used memory with bar
  if (metrics.maxMemory > 0) {
    const memoryStatus =
      metrics.memoryUtilization >= MEMORY_USAGE_CRITICAL_PERCENT
        ? "critical"
        : metrics.memoryUtilization >= MEMORY_USAGE_WARNING_PERCENT
          ? "warning"
          : "ok";
    const bar = renderBar(metrics.memoryUtilization / 100, 25, memoryStatus);
    const percentText = colorByStatus(bold(formatPercent(metrics.memoryUtilization)), memoryStatus);
    lines.push(`  ${dim("Used Memory:".padEnd(24))} ${metrics.usedMemoryHuman} / ${formatBytes(metrics.maxMemory)}  ${bar}  ${percentText}`);
  } else {
    lines.push(`  ${dim("Used Memory:".padEnd(24))} ${metrics.usedMemoryHuman} ${dim("(no maxmemory set)")}`);
  }

  // Peak memory
  lines.push(`  ${dim("Peak Memory:".padEnd(24))} ${metrics.peakMemoryHuman}`);
  lines.push("");

  // Fragmentation
  const fragmentationStatus =
    metrics.fragmentationRatio >= FRAGMENTATION_CRITICAL
      ? "critical"
      : metrics.fragmentationRatio >= FRAGMENTATION_WARNING
        ? "warning"
        : "ok";
  const fragBar = renderBar(Math.min(metrics.fragmentationRatio / 5, 1), 25, fragmentationStatus);
  lines.push(`  ${dim("Fragmentation Ratio:".padEnd(24))} ${colorByStatus(bold(metrics.fragmentationRatio.toFixed(2)), fragmentationStatus)}  ${fragBar}`);
  lines.push("");

  // Eviction policy and keys
  lines.push(`  ${dim("Eviction Policy:".padEnd(24))} ${metrics.maxMemoryPolicy}`);
  lines.push(
    `  ${dim("Evicted Keys:".padEnd(24))} ${
      metrics.evictedKeys > 0
        ? colorByStatus(bold(metrics.evictedKeys.toLocaleString("en-US")), "warning")
        : dim("0")
    }`
  );
  lines.push("");

  // Dataset vs Overhead
  const totalDataOverhead = metrics.usedMemoryDataset + metrics.usedMemoryOverhead;
  const datasetRatio = totalDataOverhead > 0 ? metrics.usedMemoryDataset / totalDataOverhead : 0;
  const dataBar = renderBar(datasetRatio, 25, "ok");
  lines.push(`  ${dim("Dataset / Overhead:".padEnd(24))} ${formatBytes(metrics.usedMemoryDataset)} ${dim("/")} ${formatBytes(metrics.usedMemoryOverhead)}  ${dataBar}`);

  if (metrics.luaMemory > 0) {
    lines.push(`  ${dim("Lua Memory:".padEnd(24))} ${formatBytes(metrics.luaMemory)}`);
  }

  // Findings
  if (result.results.memory.findings.length > 0) {
    lines.push("");
    lines.push(`  ${bold("Findings:")}`);
    for (const finding of result.results.memory.findings) {
      const icon = result.results.memory.status === "critical" ? red("✗") : yellow("⚠");
      const colored = result.results.memory.status === "critical" ? red(finding) : yellowBright(finding);
      lines.push(`    ${icon}  ${colored}`);
    }
  }

  while (lines.length < contentRows) {
    lines.push("");
  }
  return lines.slice(0, contentRows);
}
