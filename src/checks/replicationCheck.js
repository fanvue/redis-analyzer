import { parseInfoSection } from "../utils/connection.js";
import {
  bold,
  colorByStatus,
  dim,
  formatDuration,
  green,
  printFinding,
  printMetric,
  printSectionHeader,
} from "../utils/format.js";

/**
 * Run replication and persistence analysis against a Redis instance.
 *
 * @param {import("ioredis").Redis} redis
 * @returns {Promise<{status: string, title: string, metrics: object, findings: string[]}>}
 */
export async function runReplicationCheck(redis) {
  const title = "REPLICATION & PERSISTENCE";
  const findings = [];
  let status = "ok";

  try {
    const [replicationRaw, persistenceRaw] = await Promise.all([
      redis.info("replication"),
      redis.info("persistence"),
    ]);

    const replication = parseInfoSection(replicationRaw);
    const persistence = parseInfoSection(persistenceRaw);

    const role = replication.role || "unknown";
    const connectedSlaves = parseInt(replication.connected_slaves || "0", 10);

    // Parse replica details
    const replicas = [];
    for (let index = 0; index < connectedSlaves; index++) {
      const slaveInfo = replication[`slave${index}`];
      if (slaveInfo) {
        const parts = {};
        for (const pair of slaveInfo.split(",")) {
          const [key, value] = pair.split("=");
          parts[key] = value;
        }
        replicas.push({
          ip: parts.ip,
          port: parts.port,
          state: parts.state,
          offset: parseInt(parts.offset || "0", 10),
          lag: parseInt(parts.lag || "0", 10),
        });

        // Check replica lag
        if (parts.lag && parseInt(parts.lag, 10) > 10) {
          if (status !== "critical") {
            status = "warning";
          }
          findings.push(`Replica ${parts.ip}:${parts.port} has lag of ${parts.lag} seconds`);
        }

        if (parts.state !== "online") {
          status = "critical";
          findings.push(`Replica ${parts.ip}:${parts.port} is in state: ${parts.state}`);
        }
      }
    }

    // If this is a replica, check master link
    if (role === "slave") {
      const masterLinkStatus = replication.master_link_status || "unknown";
      if (masterLinkStatus !== "up") {
        status = "critical";
        findings.push(`Master link status is "${masterLinkStatus}" - replication may be broken`);
      }

      const syncInProgress = replication.master_sync_in_progress || "0";
      if (syncInProgress === "1") {
        if (status !== "critical") {
          status = "warning";
        }
        findings.push("Full sync with master is in progress");
      }
    }

    // Persistence checks
    const rdbLastSaveTime = parseInt(persistence.rdb_last_save_time || "0", 10);
    const rdbChangesSinceLastSave = parseInt(persistence.rdb_changes_since_last_save || "0", 10);
    const rdbLastSaveStatus = persistence.rdb_last_bgsave_status || "unknown";
    const aofEnabled = persistence.aof_enabled === "1";
    const aofLastWriteStatus = persistence.aof_last_write_status || "unknown";
    const loading = persistence.loading === "1";

    // Calculate time since last RDB save
    let timeSinceLastSave = 0;
    if (rdbLastSaveTime > 0) {
      timeSinceLastSave = Math.floor(Date.now() / 1000) - rdbLastSaveTime;
    }

    if (rdbLastSaveStatus === "err") {
      status = "critical";
      findings.push("Last RDB background save failed");
    }

    if (aofEnabled && aofLastWriteStatus === "err") {
      status = "critical";
      findings.push("Last AOF write failed");
    }

    if (loading) {
      if (status !== "critical") {
        status = "warning";
      }
      findings.push("Redis is currently loading data into memory");
    }

    const metrics = {
      role,
      connectedSlaves,
      replicas,
      rdbLastSaveTime,
      rdbChangesSinceLastSave,
      rdbLastSaveStatus,
      timeSinceLastSave,
      aofEnabled,
      aofLastWriteStatus,
      loading,
    };

    return { status, title, metrics, findings };
  } catch (error) {
    findings.push(`Replication check failed: ${error.message}`);
    return { status: "critical", title, metrics: {}, findings };
  }
}

/**
 * Print the replication check results to the console.
 *
 * @param {{status: string, title: string, metrics: object, findings: string[]}} result
 */
export function printReplicationCheck(result) {
  printSectionHeader(result.title, result.status);
  const metrics = result.metrics;

  if (!metrics.role) {
    printFinding(result.findings[0] || "No data available", "critical");
    return;
  }

  printMetric("Role:", bold(metrics.role));
  printMetric("Connected Replicas:", String(metrics.connectedSlaves));

  // Replica details
  if (metrics.replicas && metrics.replicas.length > 0) {
    for (const replica of metrics.replicas) {
      const replicaStatus = replica.state === "online" ? "ok" : "critical";
      const lagStatus = replica.lag > 10 ? "warning" : "ok";
      printMetric("Replica IP:", bold(`${replica.ip}:${replica.port}`));
      printMetric("Status:", colorByStatus(replica.state, replicaStatus));
      printMetric("Replica Lag:", colorByStatus(`${replica.lag}s`, lagStatus));
    }
  }

  // Persistence
  if (metrics.timeSinceLastSave > 0) {
    const saveStatusColor = metrics.rdbLastSaveStatus === "ok" ? "ok" : "critical";
    const saveStatusText = colorByStatus(metrics.rdbLastSaveStatus, saveStatusColor);
    printMetric(
      "Last RDB Save:",
      `${formatDuration(metrics.timeSinceLastSave)} ago ${dim("(status:")} ${saveStatusText}${dim(")")}`
    );
  } else {
    printMetric("Last RDB Save:", dim("N/A"));
  }

  if (metrics.rdbChangesSinceLastSave > 0) {
    printMetric("Changes Since Save:", String(metrics.rdbChangesSinceLastSave));
  }

  if (metrics.aofEnabled) {
    const aofStatusColor = metrics.aofLastWriteStatus === "ok" ? "ok" : "critical";
    printMetric(
      "AOF:",
      `${green("enabled")} ${dim("(last write:")} ${colorByStatus(metrics.aofLastWriteStatus, aofStatusColor)}${dim(")")}`
    );
  } else {
    printMetric("AOF:", dim("disabled"));
  }

  for (const finding of result.findings) {
    printFinding(finding);
  }
}
