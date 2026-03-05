import { bold, dim, green, red, yellow, yellowBright } from "colorette";
import { colorByStatus, formatDuration } from "../../utils/format.js";

/**
 * Render the Replication tab content.
 *
 * @param {{ result: object, cols: number, contentRows: number }} options
 * @returns {string[]}
 */
export function renderReplicationTab({ result, cols, contentRows }) {
  const lines = [];
  const metrics = result.results.replication?.metrics;

  if (!metrics || !metrics.role) {
    lines.push("");
    lines.push("  No replication data available.");
    while (lines.length < contentRows) {
      lines.push("");
    }
    return lines.slice(0, contentRows);
  }

  lines.push("");
  lines.push(`  ${dim("Role:".padEnd(24))} ${bold(metrics.role)}`);
  lines.push(`  ${dim("Connected Replicas:".padEnd(24))} ${metrics.connectedSlaves}`);
  lines.push("");

  // Replica details
  if (metrics.replicas && metrics.replicas.length > 0) {
    lines.push(`  ${bold("Replicas:")}`);
    for (const replica of metrics.replicas) {
      const replicaStatus = replica.state === "online" ? "ok" : "critical";
      const lagStatus = replica.lag > 10 ? "warning" : "ok";
      lines.push(`    ${bold(`${replica.ip}:${replica.port}`)}`);
      lines.push(`      ${dim("Status:".padEnd(12))} ${colorByStatus(replica.state, replicaStatus)}`);
      lines.push(`      ${dim("Lag:".padEnd(12))} ${colorByStatus(`${replica.lag}s`, lagStatus)}`);
    }
    lines.push("");
  }

  // RDB save status
  lines.push(`  ${bold("Persistence:")}`);
  if (metrics.timeSinceLastSave > 0) {
    const saveStatusColor = metrics.rdbLastSaveStatus === "ok" ? "ok" : "critical";
    const saveStatusText = colorByStatus(metrics.rdbLastSaveStatus, saveStatusColor);
    lines.push(`  ${dim("Last RDB Save:".padEnd(24))} ${formatDuration(metrics.timeSinceLastSave)} ago  ${dim("status:")} ${saveStatusText}`);
  } else {
    lines.push(`  ${dim("Last RDB Save:".padEnd(24))} ${dim("N/A")}`);
  }

  if (metrics.rdbChangesSinceLastSave > 0) {
    lines.push(`  ${dim("Changes Since Save:".padEnd(24))} ${metrics.rdbChangesSinceLastSave}`);
  }

  // AOF status
  if (metrics.aofEnabled) {
    const aofStatusColor = metrics.aofLastWriteStatus === "ok" ? "ok" : "critical";
    lines.push(`  ${dim("AOF:".padEnd(24))} ${green("enabled")}  ${dim("last write:")} ${colorByStatus(metrics.aofLastWriteStatus, aofStatusColor)}`);
  } else {
    lines.push(`  ${dim("AOF:".padEnd(24))} ${dim("disabled")}`);
  }

  if (metrics.loading) {
    lines.push("");
    lines.push(`  ${yellow("⚠")}  ${yellowBright("Redis is currently loading data into memory")}`);
  }

  // Findings
  if (result.results.replication?.findings?.length > 0) {
    lines.push("");
    lines.push(`  ${bold("Findings:")}`);
    for (const finding of result.results.replication.findings) {
      const icon = result.results.replication.status === "critical" ? red("✗") : yellow("⚠");
      const colored = result.results.replication.status === "critical" ? red(finding) : yellowBright(finding);
      lines.push(`    ${icon}  ${colored}`);
    }
  }

  while (lines.length < contentRows) {
    lines.push("");
  }
  return lines.slice(0, contentRows);
}
