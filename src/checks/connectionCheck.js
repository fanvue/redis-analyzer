import { parseInfoSection } from "../utils/connection.js";
import {
  bold,
  colorByStatus,
  dim,
  formatNumber,
  formatPercent,
  printFinding,
  printMetric,
  printSectionHeader,
  renderBar,
} from "../utils/format.js";
import {
  CLIENT_LIST_MAX_PARSE,
  CLIENT_USAGE_WARNING_PERCENT,
  IDLE_CLIENT_THRESHOLD_SECONDS,
} from "../utils/thresholds.js";

/**
 * Parse a CLIENT LIST response line into a key-value object.
 *
 * @param {string} line
 * @returns {Record<string, string>}
 */
function parseClientLine(line) {
  const result = {};
  const pairs = line.split(" ");
  for (const pair of pairs) {
    const equalsIndex = pair.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }
    result[pair.slice(0, equalsIndex)] = pair.slice(equalsIndex + 1);
  }
  return result;
}

/**
 * Run connection analysis against a Redis instance.
 *
 * @param {import("ioredis").Redis} redis
 * @returns {Promise<{status: string, title: string, metrics: object, findings: string[]}>}
 */
export async function runConnectionCheck(redis) {
  const title = "CONNECTION ANALYSIS";
  const findings = [];
  let status = "ok";

  try {
    const clientsInfoRaw = await redis.info("clients");
    const clientsInfo = parseInfoSection(clientsInfoRaw);

    const connectedClients = parseInt(clientsInfo.connected_clients || "0", 10);
    const blockedClients = parseInt(clientsInfo.blocked_clients || "0", 10);

    // Try to get maxclients from CONFIG
    let maxClients = 10000; // default fallback
    let maxClientsSource = "default";
    try {
      const configResult = await redis.config("GET", "maxclients");
      if (configResult && configResult.length >= 2) {
        maxClients = parseInt(configResult[1], 10);
        maxClientsSource = "config";
      }
    } catch {
      findings.push(
        "CONFIG GET maxclients unavailable (managed Redis restrictions) - using default 10000"
      );
    }

    // Check client utilization
    const clientUtilization = (connectedClients / maxClients) * 100;
    if (clientUtilization >= CLIENT_USAGE_WARNING_PERCENT) {
      status = "warning";
      findings.push(
        `Client usage at ${formatPercent(clientUtilization)} of maxclients - approaching limit`
      );
    }

    // Check blocked clients
    if (blockedClients > 0) {
      if (status !== "critical") {
        status = "warning";
      }
      findings.push(`${formatNumber(blockedClients)} blocked clients detected`);
    }

    // Parse CLIENT LIST for detailed analysis
    let longIdleClients = 0;
    let largeBufferClients = 0;
    const databaseDistribution = {};
    let clientListSkipped = false;

    if (connectedClients <= CLIENT_LIST_MAX_PARSE) {
      try {
        const clientListRaw = await redis.client("LIST");
        const clientLines = clientListRaw.split("\n").filter((line) => line.trim() !== "");

        for (const line of clientLines) {
          const client = parseClientLine(line);

          // Count long-idle clients
          const idle = parseInt(client.idle || "0", 10);
          if (idle > IDLE_CLIENT_THRESHOLD_SECONDS) {
            longIdleClients++;
          }

          // Count clients with large output buffers
          const outputMemory = parseInt(client.omem || "0", 10);
          if (outputMemory > 1024 * 1024) {
            largeBufferClients++;
          }

          // Database distribution
          const database = client.db || "0";
          databaseDistribution[database] = (databaseDistribution[database] || 0) + 1;
        }
      } catch {
        findings.push("CLIENT LIST command unavailable");
      }
    } else {
      clientListSkipped = true;
      findings.push(
        `CLIENT LIST parsing skipped (${formatNumber(connectedClients)} clients exceeds ${formatNumber(CLIENT_LIST_MAX_PARSE)} threshold)`
      );
    }

    if (longIdleClients > 0) {
      findings.push(
        `${formatNumber(longIdleClients)} clients idle for more than ${IDLE_CLIENT_THRESHOLD_SECONDS} seconds`
      );
    }

    if (largeBufferClients > 0) {
      if (status !== "critical") {
        status = "warning";
      }
      findings.push(
        `${formatNumber(largeBufferClients)} clients with output buffers exceeding 1 MB`
      );
    }

    const metrics = {
      connectedClients,
      blockedClients,
      maxClients,
      maxClientsSource,
      clientUtilization,
      longIdleClients,
      largeBufferClients,
      databaseDistribution,
      clientListSkipped,
    };

    return { status, title, metrics, findings };
  } catch (error) {
    findings.push(`Connection check failed: ${error.message}`);
    return { status: "critical", title, metrics: {}, findings };
  }
}

/**
 * Print the connection check results to the console.
 *
 * @param {{status: string, title: string, metrics: object, findings: string[]}} result
 */
export function printConnectionCheck(result) {
  printSectionHeader(result.title, result.status);
  const metrics = result.metrics;

  if (!metrics.connectedClients && metrics.connectedClients !== 0) {
    printFinding(result.findings[0] || "No data available", "critical");
    return;
  }

  const clientStatus = metrics.clientUtilization >= CLIENT_USAGE_WARNING_PERCENT ? "warning" : "ok";
  const bar = renderBar(metrics.clientUtilization / 100, 20, clientStatus);
  const percentText = colorByStatus(bold(formatPercent(metrics.clientUtilization)), clientStatus);
  printMetric(
    "Connected Clients:",
    `${bold(formatNumber(metrics.connectedClients))} ${dim("/")} ${formatNumber(metrics.maxClients)}  ${bar}  ${percentText}`
  );

  printMetric(
    "Blocked Clients:",
    metrics.blockedClients > 0
      ? colorByStatus(bold(formatNumber(metrics.blockedClients)), "warning")
      : dim("0")
  );

  if (!metrics.clientListSkipped) {
    printMetric(
      "Long-idle Clients:",
      metrics.longIdleClients > 0
        ? `${bold(formatNumber(metrics.longIdleClients))} ${dim(`(idle > ${IDLE_CLIENT_THRESHOLD_SECONDS}s)`)}`
        : dim(`0 (idle > ${IDLE_CLIENT_THRESHOLD_SECONDS}s)`)
    );

    printMetric(
      "Large Buffer Clients:",
      metrics.largeBufferClients > 0
        ? colorByStatus(bold(formatNumber(metrics.largeBufferClients)), "warning")
        : dim("0")
    );

    // Database distribution with mini bar chart
    const databaseEntries = Object.entries(metrics.databaseDistribution);
    if (databaseEntries.length > 0) {
      const sorted = databaseEntries.sort((a, b) => b[1] - a[1]);
      const maxCount = sorted[0][1];

      console.info("");
      console.info(`    ${bold("Client Distribution by Database:")}`);
      for (const [database, count] of sorted) {
        const ratio = count / maxCount;
        const bar = renderBar(ratio, 15, "ok");
        console.info(
          `      ${dim(`db${database}:`.padEnd(6))} ${String(count).padStart(5)}  ${bar}`
        );
      }
    }
  }

  for (const finding of result.findings) {
    printFinding(finding);
  }
}
