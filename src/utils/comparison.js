import fs from "node:fs";
import {
  bold,
  cyan,
  dim,
  formatBytes,
  formatPercent,
  green,
  printSectionHeader,
  red,
} from "./format.js";

/**
 * Load a previous JSON report from disk.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
export function loadPreviousReport(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    console.error(`  Failed to load comparison file: ${error.message}`);
    return null;
  }
}

/**
 * Format a delta value with arrow and color.
 *
 * @param {number} current
 * @param {number} previous
 * @param {object} options
 * @param {boolean} [options.higherIsBetter=false]
 * @param {(n: number) => string} [options.formatter]
 * @returns {string}
 */
function formatDelta(current, previous, options = {}) {
  const { higherIsBetter = false, formatter = String } = options;
  const delta = current - previous;

  if (delta === 0) {
    return dim("→ unchanged");
  }

  const direction = delta > 0 ? "↑" : "↓";
  const absFormatted = formatter(Math.abs(delta));
  const isGood = higherIsBetter ? delta > 0 : delta < 0;
  const color = isGood ? green : red;

  return color(`${direction} ${absFormatted}`);
}

/**
 * Print comparison between current and previous report.
 *
 * @param {object} current - Current analysis results object
 * @param {object} previous - Previous JSON report
 */
export function printComparison(current, previous) {
  printSectionHeader("COMPARISON WITH PREVIOUS RUN", "ok");

  const prevTimestamp = previous.timestamp || "unknown";
  console.info(`    ${dim("Previous run:")} ${dim(prevTimestamp)}`);
  console.info("");

  const rows = [];

  // Memory metrics
  if (current.memory?.metrics && previous.memory?.metrics) {
    const cm = current.memory.metrics;
    const pm = previous.memory.metrics;

    if (cm.usedMemory !== undefined && pm.usedMemory !== undefined) {
      rows.push([
        "Memory Used",
        formatBytes(pm.usedMemory),
        formatBytes(cm.usedMemory),
        formatDelta(cm.usedMemory, pm.usedMemory, { formatter: formatBytes }),
      ]);
    }

    if (cm.fragmentationRatio !== undefined && pm.fragmentationRatio !== undefined) {
      rows.push([
        "Fragmentation",
        pm.fragmentationRatio.toFixed(2),
        cm.fragmentationRatio.toFixed(2),
        formatDelta(cm.fragmentationRatio, pm.fragmentationRatio, {
          formatter: (n) => n.toFixed(2),
        }),
      ]);
    }

    if (cm.memoryUtilization !== undefined && pm.memoryUtilization !== undefined) {
      rows.push([
        "Memory Utilization",
        formatPercent(pm.memoryUtilization),
        formatPercent(cm.memoryUtilization),
        formatDelta(cm.memoryUtilization, pm.memoryUtilization, { formatter: formatPercent }),
      ]);
    }
  }

  // Performance metrics
  if (current.performance?.metrics && previous.performance?.metrics) {
    const cp = current.performance.metrics;
    const pp = previous.performance.metrics;

    if (cp.hitRate !== undefined && pp.hitRate !== undefined) {
      rows.push([
        "Hit Rate",
        formatPercent(pp.hitRate),
        formatPercent(cp.hitRate),
        formatDelta(cp.hitRate, pp.hitRate, { higherIsBetter: true, formatter: formatPercent }),
      ]);
    }

    if (cp.opsPerSecond !== undefined && pp.opsPerSecond !== undefined) {
      rows.push([
        "Operations/sec",
        String(pp.opsPerSecond),
        String(cp.opsPerSecond),
        formatDelta(cp.opsPerSecond, pp.opsPerSecond, {
          higherIsBetter: true,
          formatter: String,
        }),
      ]);
    }

    if (cp.slowLogLength !== undefined && pp.slowLogLength !== undefined) {
      rows.push([
        "Slow Log Entries",
        String(pp.slowLogLength),
        String(cp.slowLogLength),
        formatDelta(cp.slowLogLength, pp.slowLogLength, { formatter: String }),
      ]);
    }
  }

  // Connection metrics
  if (current.connections?.metrics && previous.connections?.metrics) {
    const cc = current.connections.metrics;
    const pc = previous.connections.metrics;

    if (cc.connectedClients !== undefined && pc.connectedClients !== undefined) {
      rows.push([
        "Connected Clients",
        String(pc.connectedClients),
        String(cc.connectedClients),
        formatDelta(cc.connectedClients, pc.connectedClients, { formatter: String }),
      ]);
    }
  }

  // Summary counts
  if (current.summary && previous.summary) {
    rows.push([
      "Warnings",
      String(previous.summary.warnings),
      String(current.summary.warnings),
      formatDelta(current.summary.warnings, previous.summary.warnings, { formatter: String }),
    ]);
    rows.push([
      "Critical Issues",
      String(previous.summary.critical),
      String(current.summary.critical),
      formatDelta(current.summary.critical, previous.summary.critical, { formatter: String }),
    ]);
  }

  if (rows.length === 0) {
    console.info(`    ${dim("No comparable metrics found in previous report.")}`);
    return;
  }

  // Print table
  const colWidths = [20, 16, 16, 20];
  const headers = ["Metric", "Previous", "Current", "Change"];

  console.info(
    `    ${bold(headers[0].padEnd(colWidths[0]))} ${dim(headers[1].padEnd(colWidths[1]))} ${bold(headers[2].padEnd(colWidths[2]))} ${headers[3]}`
  );
  console.info(`    ${dim("─".repeat(colWidths.reduce((a, b) => a + b + 1, 0)))}`);

  for (const [metric, prev, curr, delta] of rows) {
    console.info(
      `    ${cyan(metric.padEnd(colWidths[0]))} ${dim(prev.padEnd(colWidths[1]))} ${bold(curr.padEnd(colWidths[2]))} ${delta}`
    );
  }

  console.info("");
}
