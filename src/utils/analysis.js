import { readFileSync } from "node:fs";
import { runConnectionCheck } from "../checks/connectionCheck.js";
import { runKeyPatternCheck } from "../checks/keyPatternCheck.js";
import { runMemoryCheck } from "../checks/memoryCheck.js";
import { runPerformanceCheck } from "../checks/performanceCheck.js";
import { runReplicationCheck } from "../checks/replicationCheck.js";
import { parseInfoSection } from "./connection.js";
import { createSpinner, statusIcon } from "./format.js";

/**
 * Run all checks and return structured results.
 *
 * @param {import("ioredis").Redis} redis
 * @param {boolean} showSpinners
 * @param {object} options
 * @param {boolean} options.noScan
 * @param {number} options.scanCount
 * @param {boolean} [options.scanCountExplicit]
 * @param {object} [options.previousKeyPatterns] - Reuse previous key pattern results instead of re-scanning
 * @returns {Promise<{results: object, serverInfo: object, warnings: number, criticals: number}>}
 */
export async function runAnalysis(redis, showSpinners, options = {}) {
  const serverRaw = await redis.info("server");
  const serverInfo = parseInfoSection(serverRaw);
  const redisVersion = serverInfo.redis_version || "unknown";
  const uptimeSeconds = parseInt(serverInfo.uptime_in_seconds || "0", 10);

  const results = {};

  const analysisSpinner = showSpinners ? createSpinner("Running core analysis checks...") : null;

  const [memoryResult, performanceResult, connectionResult, replicationResult] = await Promise.all([
    runMemoryCheck(redis),
    runPerformanceCheck(redis),
    runConnectionCheck(redis),
    runReplicationCheck(redis),
  ]);

  results.memory = memoryResult;
  results.performance = performanceResult;
  results.connections = connectionResult;
  results.replication = replicationResult;
  analysisSpinner?.succeed(
    `Core checks complete  ${statusIcon(memoryResult.status)} memory  ${statusIcon(performanceResult.status)} performance  ${statusIcon(connectionResult.status)} connections  ${statusIcon(replicationResult.status)} replication`
  );

  if (!options.noScan) {
    if (options.previousKeyPatterns) {
      // Reuse previous results to avoid expensive re-scan
      results.keyPatterns = options.previousKeyPatterns;
    } else {
      const scanLabel = options.scanCountExplicit
        ? `sampling ${options.scanCount} keys`
        : "auto-scaling sample size";
      const scanSpinner = showSpinners
        ? createSpinner(`Scanning key patterns (${scanLabel})...`)
        : null;
      results.keyPatterns = await runKeyPatternCheck(redis, {
        scanCount: options.scanCount || 500,
        scanCountExplicit: options.scanCountExplicit,
      });
      const sampled = results.keyPatterns.metrics.sampledCount;
      scanSpinner?.succeed(
        `Key pattern analysis complete  ${statusIcon(results.keyPatterns.status)} keys  ${sampled} sampled`
      );
    }
  }

  let warnings = 0;
  let criticals = 0;
  for (const result of Object.values(results)) {
    if (result.status === "warning") {
      warnings++;
    }
    if (result.status === "critical") {
      criticals++;
    }
  }

  return { results, serverInfo: { redisVersion, uptimeSeconds }, warnings, criticals };
}

/**
 * Build a JSON output object from analysis results.
 *
 * @param {URL} parsedUrl
 * @param {string} displayHost
 * @param {object} analysis
 * @returns {object}
 */
export function buildJsonOutput(parsedUrl, displayHost, analysis) {
  return {
    timestamp: new Date().toISOString(),
    server: {
      url: `${parsedUrl.protocol}//${displayHost}`,
      version: analysis.serverInfo.redisVersion,
      uptimeSeconds: analysis.serverInfo.uptimeSeconds,
    },
    memory: analysis.results.memory || null,
    performance: analysis.results.performance || null,
    connections: analysis.results.connections || null,
    keyPatterns: analysis.results.keyPatterns || null,
    replication: analysis.results.replication || null,
    summary: { warnings: analysis.warnings, critical: analysis.criticals },
  };
}

/**
 * Load a demo analysis from a JSON fixture file.
 * Returns the parsed fixture on the first call. On subsequent calls,
 * applies small random variations to numeric counters so the TUI
 * behaves like a live instance.
 *
 * @param {string} filePath
 * @returns {() => object}
 */
export function createDemoLoader(filePath) {
  const base = JSON.parse(readFileSync(filePath, "utf-8"));
  let cumulativeHits = 0;
  let cumulativeMisses = 0;
  let cumulativeCommands = 0;
  let callCount = 0;

  return function loadDemoAnalysis() {
    // Deep clone so mutations don't affect the base
    const data = JSON.parse(JSON.stringify(base));
    callCount++;

    const perf = data.results.performance?.metrics;
    if (perf) {
      // Add monotonically increasing deltas to cumulative counters
      cumulativeHits += Math.floor(800 + Math.random() * 400);
      cumulativeMisses += Math.floor(200 + Math.random() * 600);
      cumulativeCommands += cumulativeHits + cumulativeMisses;

      perf.keyspaceHits += cumulativeHits;
      perf.keyspaceMisses += cumulativeMisses;
      perf.totalCommands += cumulativeCommands;

      // Recalculate cumulative hit rate
      const totalOps = perf.keyspaceHits + perf.keyspaceMisses;
      perf.hitRate = totalOps > 0 ? (perf.keyspaceHits / totalOps) * 100 : 0;

      // Vary ops/sec
      perf.opsPerSecond = Math.floor(perf.opsPerSecond * (0.9 + Math.random() * 0.2));
    }

    const mem = data.results.memory?.metrics;
    if (mem) {
      // Small memory fluctuation
      const memDrift = Math.floor((Math.random() - 0.5) * 2 * 1048576);
      mem.usedMemory = Math.max(0, mem.usedMemory + memDrift);
      mem.memoryUtilization = mem.maxMemory > 0 ? (mem.usedMemory / mem.maxMemory) * 100 : 0;
    }

    const conn = data.results.connections?.metrics;
    if (conn) {
      conn.connectedClients = Math.max(1, conn.connectedClients + Math.floor((Math.random() - 0.5) * 6));
    }

    // Increment uptime
    data.serverInfo.uptimeSeconds += callCount * 10;

    return data;
  };
}
