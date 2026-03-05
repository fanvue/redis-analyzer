import { bold, dim, red, yellow, yellowBright } from "colorette";
import {
  colorByStatus,
  formatNumber,
  formatPercent,
  renderBar,
} from "../../utils/format.js";
import {
  CLIENT_USAGE_WARNING_PERCENT,
  IDLE_CLIENT_THRESHOLD_SECONDS,
} from "../../utils/thresholds.js";

/**
 * Render the Connections tab content.
 *
 * @param {{ result: object, cols: number, contentRows: number }} options
 * @returns {string[]}
 */
export function renderConnectionsTab({ result, cols, contentRows }) {
  const lines = [];
  const metrics = result.results.connections?.metrics;

  if (!metrics || (!metrics.connectedClients && metrics.connectedClients !== 0)) {
    lines.push("");
    lines.push("  No connection data available.");
    while (lines.length < contentRows) {
      lines.push("");
    }
    return lines.slice(0, contentRows);
  }

  lines.push("");

  // Client count bar
  const clientStatus = metrics.clientUtilization >= CLIENT_USAGE_WARNING_PERCENT ? "warning" : "ok";
  const bar = renderBar(metrics.clientUtilization / 100, 25, clientStatus);
  const percentText = colorByStatus(bold(formatPercent(metrics.clientUtilization)), clientStatus);
  lines.push(`  ${dim("Connected Clients:".padEnd(24))} ${bold(formatNumber(metrics.connectedClients))} ${dim("/")} ${formatNumber(metrics.maxClients)}  ${bar}  ${percentText}`);
  lines.push("");

  // Blocked clients
  lines.push(
    `  ${dim("Blocked Clients:".padEnd(24))} ${
      metrics.blockedClients > 0
        ? colorByStatus(bold(formatNumber(metrics.blockedClients)), "warning")
        : dim("0")
    }`
  );

  // Idle clients
  if (!metrics.clientListSkipped) {
    lines.push(
      `  ${dim("Long-idle Clients:".padEnd(24))} ${
        metrics.longIdleClients > 0
          ? `${bold(formatNumber(metrics.longIdleClients))} ${dim(`(idle > ${IDLE_CLIENT_THRESHOLD_SECONDS}s)`)}`
          : dim(`0 (idle > ${IDLE_CLIENT_THRESHOLD_SECONDS}s)`)
      }`
    );
    lines.push(
      `  ${dim("Large Buffer Clients:".padEnd(24))} ${
        metrics.largeBufferClients > 0
          ? colorByStatus(bold(formatNumber(metrics.largeBufferClients)), "warning")
          : dim("0")
      }`
    );
  }

  lines.push("");

  // Database distribution
  const databaseEntries = Object.entries(metrics.databaseDistribution || {});
  if (databaseEntries.length > 0) {
    lines.push(`  ${bold("Client Distribution by Database:")}`);
    const sorted = databaseEntries.sort((a, b) => b[1] - a[1]);
    const maxCount = sorted[0][1];

    for (const [database, count] of sorted) {
      const ratio = count / maxCount;
      const dbBar = renderBar(ratio, 20, "ok");
      lines.push(`    ${dim(`db${database}:`.padEnd(8))} ${String(count).padStart(5)}  ${dbBar}`);
    }
  }

  // Findings
  if (result.results.connections.findings.length > 0) {
    lines.push("");
    lines.push(`  ${bold("Findings:")}`);
    for (const finding of result.results.connections.findings) {
      const icon = result.results.connections.status === "critical" ? red("✗") : yellow("⚠");
      const colored = result.results.connections.status === "critical" ? red(finding) : yellowBright(finding);
      lines.push(`    ${icon}  ${colored}`);
    }
  }

  while (lines.length < contentRows) {
    lines.push("");
  }
  return lines.slice(0, contentRows);
}
