import { parseInfoSection } from "../utils/connection.js";
import {
  bold,
  colorByStatus,
  dim,
  formatDuration,
  formatNumber,
  formatPercent,
  printFinding,
  printMetric,
  printSectionHeader,
  printTable,
  red,
  renderBar,
  yellow,
} from "../utils/format.js";
import { HIT_RATE_CRITICAL_PERCENT, HIT_RATE_WARNING_PERCENT } from "../utils/thresholds.js";

/**
 * Number of arguments (after the command name) to display per Redis command.
 * Commands not listed default to showing 1 argument (the key).
 */
const COMMAND_DISPLAY_ARGS = {
  // Commands where we want to show 0 extra args (no key)
  EVAL: 0,
  EVALSHA: 0,
  INFO: 1,
  CONFIG: 2,
  SLOWLOG: 1,
  CLIENT: 1,
  // Multi-key commands — show up to 3 keys
  MGET: 3,
  MSET: 3,
  DEL: 3,
  UNLINK: 3,
  EXISTS: 3,
  // Commands with subcommands
  OBJECT: 2,
  MEMORY: 2,
  XINFO: 2,
};

/**
 * Format a slow log command array to show the command and key(s) only,
 * omitting value payloads that clutter the output.
 *
 * @param {string[]} commandParts - The command array from SLOWLOG GET
 * @returns {string}
 */
function formatSlowLogCommand(commandParts) {
  if (commandParts.length === 0) {
    return "";
  }

  const name = String(commandParts[0]).toUpperCase();
  const maxArgs = COMMAND_DISPLAY_ARGS[name] ?? 1;
  const displayParts = commandParts.slice(0, 1 + maxArgs);

  if (commandParts.length > displayParts.length) {
    const omitted = commandParts.length - displayParts.length;
    return `${displayParts.join(" ")} [+${omitted} args]`;
  }

  return displayParts.join(" ");
}

/**
 * Run performance analysis against a Redis instance.
 *
 * @param {import("ioredis").Redis} redis
 * @returns {Promise<{status: string, title: string, metrics: object, findings: string[]}>}
 */
export async function runPerformanceCheck(redis) {
  const title = "PERFORMANCE ANALYSIS";
  const findings = [];
  let status = "ok";

  try {
    const [statsRaw, serverRaw] = await Promise.all([redis.info("stats"), redis.info("server")]);

    const stats = parseInfoSection(statsRaw);
    const server = parseInfoSection(serverRaw);

    const opsPerSecond = parseInt(stats.instantaneous_ops_per_sec || "0", 10);
    const totalCommands = parseInt(stats.total_commands_processed || "0", 10);
    const keyspaceHits = parseInt(stats.keyspace_hits || "0", 10);
    const keyspaceMisses = parseInt(stats.keyspace_misses || "0", 10);
    const rejectedConnections = parseInt(stats.rejected_connections || "0", 10);
    const totalNetInput = parseInt(stats.total_net_input_bytes || "0", 10);
    const totalNetOutput = parseInt(stats.total_net_output_bytes || "0", 10);
    const uptimeSeconds = parseInt(server.uptime_in_seconds || "0", 10);
    const redisVersion = server.redis_version || "unknown";

    // Calculate hit rate
    const totalKeyspaceOps = keyspaceHits + keyspaceMisses;
    let hitRate = 0;
    if (totalKeyspaceOps > 0) {
      hitRate = (keyspaceHits / totalKeyspaceOps) * 100;
    }

    // Check hit rate
    if (totalKeyspaceOps > 100) {
      if (hitRate < HIT_RATE_CRITICAL_PERCENT) {
        status = "critical";
        findings.push(
          `Hit rate ${formatPercent(hitRate)} is critically low (< ${HIT_RATE_CRITICAL_PERCENT}%) - review cache strategy`
        );
      } else if (hitRate < HIT_RATE_WARNING_PERCENT) {
        status = "warning";
        findings.push(
          `Hit rate ${formatPercent(hitRate)} is below optimal (< ${HIT_RATE_WARNING_PERCENT}%) - consider reviewing cache patterns`
        );
      }
    }

    // Check rejected connections
    if (rejectedConnections > 0) {
      if (status !== "critical") {
        status = "warning";
      }
      findings.push(
        `${formatNumber(rejectedConnections)} connections rejected - maxclients may be too low`
      );
    }

    // Slow log analysis
    let slowLogEntries = [];
    let slowLogLength = 0;
    try {
      const [slowLog, slowLenResult] = await Promise.all([
        redis.slowlog("GET", 20),
        redis.slowlog("LEN"),
      ]);
      slowLogEntries = slowLog || [];
      slowLogLength = slowLenResult || 0;

      if (slowLogLength > 100) {
        if (status !== "critical") {
          status = "warning";
        }
        findings.push(
          `${formatNumber(slowLogLength)} total slow log entries - indicates systemic slow commands`
        );
      }
    } catch {
      findings.push("SLOWLOG command unavailable (may be restricted on managed Redis)");
    }

    const metrics = {
      opsPerSecond,
      totalCommands,
      keyspaceHits,
      keyspaceMisses,
      hitRate,
      rejectedConnections,
      totalNetInput,
      totalNetOutput,
      uptimeSeconds,
      redisVersion,
      slowLogEntries,
      slowLogLength,
    };

    return { status, title, metrics, findings };
  } catch (error) {
    findings.push(`Performance check failed: ${error.message}`);
    return { status: "critical", title, metrics: {}, findings };
  }
}

/**
 * Print the performance check results to the console.
 *
 * @param {{status: string, title: string, metrics: object, findings: string[]}} result
 */
export function printPerformanceCheck(result) {
  printSectionHeader(result.title, result.status);
  const metrics = result.metrics;

  if (!metrics.opsPerSecond && metrics.opsPerSecond !== 0) {
    printFinding(result.findings[0] || "No data available", "critical");
    return;
  }

  printMetric("Operations/sec:", bold(formatNumber(metrics.opsPerSecond)));
  printMetric("Total Commands:", formatNumber(metrics.totalCommands));

  const totalOps = metrics.keyspaceHits + metrics.keyspaceMisses;
  if (totalOps > 0) {
    const hitStatus =
      metrics.hitRate < HIT_RATE_CRITICAL_PERCENT
        ? "critical"
        : metrics.hitRate < HIT_RATE_WARNING_PERCENT
          ? "warning"
          : "ok";
    const bar = renderBar(metrics.hitRate / 100, 20, hitStatus);
    const percentText = colorByStatus(bold(formatPercent(metrics.hitRate)), hitStatus);
    printMetric("Hit Rate:", `${percentText}  ${bar}`);
    console.info(
      `${" ".repeat(27)}${dim(`hits: ${formatNumber(metrics.keyspaceHits)}  misses: ${formatNumber(metrics.keyspaceMisses)}`)}`
    );
  } else {
    printMetric("Hit Rate:", dim("N/A (no keyspace operations recorded)"));
  }

  printMetric(
    "Rejected Connections:",
    metrics.rejectedConnections > 0
      ? colorByStatus(bold(formatNumber(metrics.rejectedConnections)), "warning")
      : dim("0")
  );
  printMetric("Uptime:", formatDuration(metrics.uptimeSeconds));

  // Print slow log entries as a table
  if (metrics.slowLogEntries && metrics.slowLogEntries.length > 0) {
    console.info("");
    console.info(
      `    ${bold("Slow Log")} ${dim(`(${metrics.slowLogLength} total, showing last ${metrics.slowLogEntries.length})`)}`
    );

    // Build plain-text cells first to measure column widths, sorted by duration descending
    const sortedEntries = [...metrics.slowLogEntries].sort((a, b) => b[2] - a[2]);
    const plainRows = sortedEntries.map((entry) => {
      const duration = entry[2];
      const command = entry[3];
      const timestamp = entry[1];
      const durationText = `${(duration / 1000).toFixed(2)}ms`;
      const dateText = new Date(timestamp * 1000).toISOString().slice(0, 19);
      // Show command name + key(s) only, omit value payloads
      const commandText = Array.isArray(command) ? formatSlowLogCommand(command) : String(command);
      return { duration, durationText, commandText, dateText };
    });

    const headers = ["Duration", "Command", "Timestamp"];
    const widths = [
      Math.max(headers[0].length, ...plainRows.map((r) => r.durationText.length)),
      Math.max(headers[1].length, ...plainRows.map((r) => r.commandText.length)),
      Math.max(headers[2].length, ...plainRows.map((r) => r.dateText.length)),
    ];

    const rows = plainRows.map((r) => {
      const durationColor = r.duration > 100000 ? red : r.duration > 10000 ? yellow : dim;
      return [durationColor(r.durationText), r.commandText, dim(r.dateText)];
    });

    printTable({
      headers,
      widths,
      alignments: ["right", "left", "left"],
      rows,
      indent: "    ",
    });
  }

  for (const finding of result.findings) {
    printFinding(finding);
  }
}
