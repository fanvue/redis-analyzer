import { bold, dim, green, red, yellow, yellowBright } from "colorette";
import {
  colorByStatus,
  formatNumber,
  formatPercent,
  renderBar,
  stripAnsi,
} from "../../utils/format.js";
import { HIT_RATE_CRITICAL_PERCENT, HIT_RATE_WARNING_PERCENT } from "../../utils/thresholds.js";

const CHART_HEIGHT = 6;
const VERTICAL_BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Render a vertical bar chart from hit rate history values.
 * Auto-scales the y-axis to the data range for better visibility.
 * Returns an array of strings, one per row (top to bottom).
 *
 * @param {number[]} history - Hit rate values (0-100)
 * @returns {string[]}
 */
const MAX_BARS = 10;

function renderVerticalChart(history) {
  // Clamp values to 0-100 and scale from 0 to 100
  const colWidth = 4;
  const emptyColumns = MAX_BARS - history.length;
  const leftPad = " ".repeat(emptyColumns * colWidth);
  const rows = [];

  for (let row = CHART_HEIGHT - 1; row >= 0; row--) {
    let line = leftPad;
    for (const rawValue of history) {
      const value = Math.max(0, Math.min(100, rawValue));
      const filledRows = (value / 100) * CHART_HEIGHT;
      const status =
        value < HIT_RATE_CRITICAL_PERCENT
          ? "critical"
          : value < HIT_RATE_WARNING_PERCENT
            ? "warning"
            : "ok";
      const color = status === "critical" ? red : status === "warning" ? yellow : green;

      if (filledRows >= row + 1) {
        line += color("██") + "  ";
      } else if (filledRows > row) {
        const fraction = filledRows - row;
        const blockIndex = Math.round(fraction * 8);
        line += color(VERTICAL_BLOCKS[blockIndex].repeat(2)) + "  ";
      } else {
        line += " ".repeat(colWidth);
      }
    }
    rows.push(line);
  }

  // Percentage labels beneath each bar
  let labels = leftPad;
  for (const value of history) {
    const label = `${Math.round(Math.max(0, Math.min(100, value)))}%`;
    labels += dim(label.padEnd(colWidth));
  }
  rows.push(labels);

  return rows;
}

/**
 * Format a slow log command array for display.
 *
 * @param {string[]} commandParts
 * @returns {string}
 */
function formatSlowLogCommand(commandParts) {
  if (commandParts.length === 0) {
    return "";
  }
  const name = String(commandParts[0]).toUpperCase();
  const displayParts = commandParts.slice(0, 3);
  if (commandParts.length > displayParts.length) {
    const omitted = commandParts.length - displayParts.length;
    return `${displayParts.join(" ")} [+${omitted}]`;
  }
  return displayParts.join(" ");
}

/**
 * Render the Performance tab content.
 *
 * @param {{ result: object, cols: number, contentRows: number, hitRateHistory: number[] }} options
 * @returns {string[]}
 */
export function renderPerformanceTab({ result, cols, contentRows, hitRateHistory = [] }) {
  const lines = [];
  const metrics = result.results.performance?.metrics;

  if (!metrics || (!metrics.opsPerSecond && metrics.opsPerSecond !== 0)) {
    lines.push("");
    lines.push("  No performance data available.");
    while (lines.length < contentRows) {
      lines.push("");
    }
    return lines.slice(0, contentRows);
  }

  lines.push("");
  lines.push(`  ${dim("Operations/sec:".padEnd(24))} ${bold(formatNumber(metrics.opsPerSecond))}`);
  lines.push(`  ${dim("Total Commands:".padEnd(24))} ${formatNumber(metrics.totalCommands)}`);
  lines.push("");

  // Hit rate
  const totalOps = metrics.keyspaceHits + metrics.keyspaceMisses;
  if (totalOps > 0) {
    const hitStatus =
      metrics.hitRate < HIT_RATE_CRITICAL_PERCENT
        ? "critical"
        : metrics.hitRate < HIT_RATE_WARNING_PERCENT
          ? "warning"
          : "ok";
    const bar = renderBar(metrics.hitRate / 100, 25, hitStatus);
    const percentText = colorByStatus(bold(formatPercent(metrics.hitRate)), hitStatus);

    const currentRate = hitRateHistory.length > 0 ? hitRateHistory[hitRateHistory.length - 1] : null;

    lines.push(`  ${dim("Hit Rate (all time):".padEnd(24))} ${percentText}  ${bar}`);
    lines.push(`  ${" ".repeat(24)} ${dim(`hits: ${formatNumber(metrics.keyspaceHits)}  misses: ${formatNumber(metrics.keyspaceMisses)}`)}`);
    if (currentRate !== null) {
      const currentStatus =
        currentRate < HIT_RATE_CRITICAL_PERCENT
          ? "critical"
          : currentRate < HIT_RATE_WARNING_PERCENT
            ? "warning"
            : "ok";
      const currentBar = renderBar(currentRate / 100, 25, currentStatus);
      const currentText = colorByStatus(bold(formatPercent(currentRate)), currentStatus);
      lines.push(`  ${dim("Hit Rate (current):".padEnd(24))} ${currentText}  ${currentBar}`);
    }

    if (hitRateHistory.length > 0) {
      const chartRows = renderVerticalChart(hitRateHistory);
      lines.push("");
      for (const chartRow of chartRows) {
        lines.push(`  ${" ".repeat(24)} ${chartRow}`);
      }
    }
  } else {
    lines.push(`  ${dim("Hit Rate:".padEnd(24))} ${dim("N/A (no keyspace operations)")}`);
  }
  lines.push("");

  lines.push(
    `  ${dim("Rejected Connections:".padEnd(24))} ${
      metrics.rejectedConnections > 0
        ? colorByStatus(bold(formatNumber(metrics.rejectedConnections)), "warning")
        : dim("0")
    }`
  );
  lines.push("");

  // Slow log table
  if (metrics.slowLogEntries && metrics.slowLogEntries.length > 0) {
    lines.push(`  ${bold("Slow Log")} ${dim(`(${metrics.slowLogLength} total, showing last ${metrics.slowLogEntries.length})`)}`);
    lines.push("");

    const sortedEntries = [...metrics.slowLogEntries].sort((a, b) => b[2] - a[2]);
    const cmdWidth = Math.max(20, cols - 50);

    lines.push(`  ${dim("Duration".padEnd(12))} ${dim("Command".padEnd(cmdWidth))} ${dim("Timestamp")}`);
    lines.push(`  ${dim("─".repeat(12))} ${dim("─".repeat(cmdWidth))} ${dim("─".repeat(19))}`);

    for (const entry of sortedEntries) {
      const duration = entry[2];
      const command = entry[3];
      const timestamp = entry[1];
      const durationText = `${(duration / 1000).toFixed(2)}ms`;
      const dateText = new Date(timestamp * 1000).toISOString().slice(0, 19);
      const commandText = Array.isArray(command) ? formatSlowLogCommand(command) : String(command);
      const truncatedCommand = stripAnsi(commandText).length > cmdWidth
        ? commandText.slice(0, cmdWidth - 3) + "..."
        : commandText;

      const durationColor = duration > 100000 ? red : duration > 10000 ? yellow : dim;
      lines.push(`  ${durationColor(durationText.padEnd(12))} ${truncatedCommand.padEnd(cmdWidth)} ${dim(dateText)}`);
    }
  }

  // Findings
  if (result.results.performance.findings.length > 0) {
    lines.push("");
    lines.push(`  ${bold("Findings:")}`);
    for (const finding of result.results.performance.findings) {
      const icon = result.results.performance.status === "critical" ? red("✗") : yellow("⚠");
      const colored = result.results.performance.status === "critical" ? red(finding) : yellowBright(finding);
      lines.push(`    ${icon}  ${colored}`);
    }
  }

  while (lines.length < contentRows) {
    lines.push("");
  }
  return lines.slice(0, contentRows);
}
