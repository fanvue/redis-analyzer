#!/usr/bin/env node

import { printConnectionCheck, runConnectionCheck } from "../checks/connectionCheck.js";
import { printKeyPatternCheck, runKeyPatternCheck } from "../checks/keyPatternCheck.js";
import { printMemoryCheck, runMemoryCheck } from "../checks/memoryCheck.js";
import { printPerformanceCheck, runPerformanceCheck } from "../checks/performanceCheck.js";
import { printReplicationCheck, runReplicationCheck } from "../checks/replicationCheck.js";
import { loadPreviousReport, printComparison } from "../utils/comparison.js";
import { getConfigDefaults, loadConfig, resolveConnection } from "../utils/config.js";
import { createConnection, parseInfoSection } from "../utils/connection.js";
import {
  createSpinner,
  dim,
  formatDuration,
  printReportHeader,
  printTopSummary,
  statusIcon,
} from "../utils/format.js";
import { askPassword, promptCredentials, waitForKeypress } from "../utils/prompt.js";
import { generateRecommendations, printRecommendations } from "../utils/recommendations.js";

// ── Config loading ────────────────────────────────────────────
const config = loadConfig();
const configDefaults = getConfigDefaults(config);

// ── Argument parsing ──────────────────────────────────────────
const args = process.argv.slice(2);
const positional = args.filter((argument) => !argument.startsWith("--"));

const rawInput = positional[0];

function getNumberFlag(flag, defaultValue) {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return defaultValue;
  }
  const value = parseInt(args[index + 1], 10);
  return isNaN(value) ? defaultValue : value;
}

function getStringAfterFlag(flag, defaultValue) {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return defaultValue;
  }
  const nextArgument = args[index + 1];
  if (nextArgument.startsWith("--")) {
    return defaultValue;
  }
  return nextArgument;
}

const OPTIONS = {
  json: args.includes("--json"),
  noScan: args.includes("--no-scan") || configDefaults.noScan,
  insecure: args.includes("--insecure") || configDefaults.insecure,
  scanCount: getNumberFlag("--scan-count", configDefaults.scanCount || 1000),
  watch: getNumberFlag("--watch", 0),
  compare: getStringAfterFlag("--compare", null),
};

// ── Help ──────────────────────────────────────────────────────

function printHelp() {
  console.info(`
Usage: redis-analyzer <redis-url | connection-name> [options]

Analyze a Redis instance for bottlenecks and performance issues.
All commands are strictly read-only and safe for production use.

Arguments:
  redis-url              Redis connection URL (redis:// or rediss://)
  connection-name        Named connection from .redis-analyzer.json

Options:
  --json                 Output results as JSON instead of ASCII report
  --scan-count <n>       Number of keys to sample for big key detection (default: 1000)
  --no-scan              Skip key pattern analysis (fastest mode)
  --insecure             Skip TLS certificate verification (self-signed certificates)
  --watch <seconds>      Re-run analysis every N seconds (live monitoring)
  --compare <file.json>  Compare results against a previous JSON export
  --help, -h             Show help

Exit codes:
  0                      All checks passed
  1                      Warning-level issues detected
  2                      Critical issues detected

Examples:
  pnpm -F @pandora/redis-analyzer start redis://localhost:6379
  pnpm -F @pandora/redis-analyzer start rediss://user@host:6380
  pnpm -F @pandora/redis-analyzer start redis://host:6379 --json --scan-count 5000
  pnpm -F @pandora/redis-analyzer start redis://host:6379 --watch 10
  pnpm -F @pandora/redis-analyzer start redis://host:6379 --compare previous.json
  pnpm -F @pandora/redis-analyzer start prod
`);

  if (config?.connections) {
    const names = Object.keys(config.connections);
    if (names.length > 0) {
      console.info(`Named connections (from .redis-analyzer.json):`);
      for (const name of names) {
        console.info(`  ${name}`);
      }
      console.info("");
    }
  }
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (!rawInput) {
  printHelp();
  process.exit(1);
}

// Resolve named connection or use URL directly
const REDIS_URL = resolveConnection(rawInput, config);

if (!REDIS_URL) {
  console.error(`  Unknown connection: "${rawInput}"`);
  if (config?.connections) {
    const names = Object.keys(config.connections);
    if (names.length > 0) {
      console.error(`  Available connections: ${names.join(", ")}`);
    }
  }
  console.error(`  Provide a redis:// or rediss:// URL, or a name from .redis-analyzer.json`);
  process.exit(1);
}

// ── Analysis core ─────────────────────────────────────────────

/**
 * Run all checks and return structured results.
 *
 * @param {import("ioredis").Redis} redis
 * @param {boolean} showSpinners
 * @returns {Promise<{results: object, serverInfo: object, warnings: number, criticals: number}>}
 */
async function runAnalysis(redis, showSpinners) {
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

  if (!OPTIONS.noScan) {
    const scanSpinner = showSpinners
      ? createSpinner(`Scanning key patterns (sampling ${OPTIONS.scanCount} keys)...`)
      : null;
    results.keyPatterns = await runKeyPatternCheck(redis, { scanCount: OPTIONS.scanCount });
    scanSpinner?.succeed(
      `Key pattern analysis complete  ${statusIcon(results.keyPatterns.status)} keys`
    );
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
 */
function buildJsonOutput(parsedUrl, displayHost, analysis) {
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
 * Print the full ASCII report.
 */
function printReport(parsedUrl, displayHost, analysis, previousReport) {
  printReportHeader({
    url: `${parsedUrl.protocol}//${displayHost}`,
    version: analysis.serverInfo.redisVersion,
    uptime: formatDuration(analysis.serverInfo.uptimeSeconds),
  });

  const allSections = [
    analysis.results.memory,
    analysis.results.performance,
    analysis.results.connections,
    analysis.results.keyPatterns,
    analysis.results.replication,
  ].filter(Boolean);

  printTopSummary({
    warnings: analysis.warnings,
    criticals: analysis.criticals,
    sections: allSections,
  });

  // Comparison (if provided)
  if (previousReport) {
    const currentJson = buildJsonOutput(parsedUrl, displayHost, analysis);
    printComparison(currentJson, previousReport);
  }

  // Recommendations
  const recommendations = generateRecommendations(allSections);
  if (recommendations.length > 0) {
    printRecommendations(recommendations);
  }

  return allSections;
}

// ── Main ──────────────────────────────────────────────────────

async function run() {
  const parsedUrl = new URL(REDIS_URL);
  const displayHost = parsedUrl.host || `${parsedUrl.hostname}:6379`;
  const hasUsername = Boolean(parsedUrl.username);
  const hasPassword = Boolean(parsedUrl.password);

  let credentials = {};
  if (!hasUsername && !hasPassword) {
    console.info(`Connecting to ${displayHost}...\n`);
    credentials = await promptCredentials();
    console.info("");
  } else if (hasUsername && !hasPassword) {
    console.info(`Connecting to ${displayHost} as ${decodeURIComponent(parsedUrl.username)}...\n`);
    credentials = { password: await askPassword("Redis password: ") };
    console.info("");
  }

  const showSpinners = !OPTIONS.json;

  const tryConnect = async (connectionCredentials) => {
    const redis = createConnection(REDIS_URL, {
      insecure: OPTIONS.insecure,
      keepAlive: OPTIONS.watch > 0,
      ...connectionCredentials,
    });

    const connectSpinner = showSpinners ? createSpinner(`Connecting to ${displayHost}...`) : null;

    try {
      await redis.connect();
      connectSpinner?.succeed(`Connected to ${displayHost}`);
      return redis;
    } catch (error) {
      connectSpinner?.fail(`Failed to connect to ${displayHost}`);

      // Force close the connection to prevent background reconnect attempts
      redis.removeAllListeners();
      try {
        redis.disconnect();
      } catch {
        /* ignore */
      }

      const isAuthError = /WRONGPASS|NOAUTH|ERR invalid password|authentication failed/i.test(
        error.message
      );

      if (isAuthError) {
        console.error(`\n  Authentication failed. Please try again.\n`);
        return null;
      }

      // Non-recoverable error — print and exit
      console.error(`\n  ${error.message}`);
      return process.exit(1);
    }
  };

  let redis = await tryConnect(credentials);

  while (!redis) {
    credentials = await promptCredentials();
    console.info("");
    redis = await tryConnect(credentials);
  }

  // Load comparison file if provided
  const previousReport = OPTIONS.compare ? loadPreviousReport(OPTIONS.compare) : null;

  if (OPTIONS.watch > 0) {
    // ── Watch mode ──────────────────────────────────────────
    let iteration = 0;
    let previousAnalysis = null;

    const runWatchIteration = async () => {
      iteration++;

      if (iteration > 1) {
        // Clear screen for fresh output
        process.stdout.write("\x1b[2J\x1b[H");
      }

      console.info(
        dim(`  [Watch mode: refreshing every ${OPTIONS.watch}s — press Ctrl+C to stop]`)
      );

      try {
        // Check connection health and reconnect if needed
        try {
          await redis.ping();
        } catch {
          console.info(dim("  Reconnecting..."));
          try {
            redis.disconnect();
          } catch {
            /* ignore */
          }
          await redis.connect();
        }

        const analysis = await runAnalysis(redis, false);

        if (OPTIONS.json) {
          const jsonOutput = buildJsonOutput(parsedUrl, displayHost, analysis);
          console.info(JSON.stringify(jsonOutput, null, 2));
        } else {
          // For watch mode, use previous iteration as comparison
          const compareWith = previousAnalysis
            ? buildJsonOutput(parsedUrl, displayHost, previousAnalysis)
            : previousReport;
          printReport(parsedUrl, displayHost, analysis, compareWith);

          // Print detail sections inline (no keypress pause in watch mode)
          printMemoryCheck(analysis.results.memory);
          printPerformanceCheck(analysis.results.performance);
          printConnectionCheck(analysis.results.connections);

          if (analysis.results.keyPatterns) {
            printKeyPatternCheck(analysis.results.keyPatterns);
          }

          printReplicationCheck(analysis.results.replication);
        }

        previousAnalysis = analysis;
      } catch (error) {
        console.error(`  Watch iteration failed: ${error.message}`);
      }
    };

    await runWatchIteration();

    const watchInterval = setInterval(runWatchIteration, OPTIONS.watch * 1000);

    const stopWatch = async () => {
      clearInterval(watchInterval);
      console.info("\n  Watch mode stopped.");
      await redis.quit();
      process.exit(0);
    };

    // Clean exit on Ctrl+C
    process.on("SIGINT", stopWatch);

    // Exit on Escape key
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", (key) => {
        // Escape = 0x1b, Ctrl+C = 0x03
        if (key[0] === 0x1b || key[0] === 0x03) {
          stopWatch();
        }
      });
    }

    // Keep process alive
    await new Promise(() => {});
  } else {
    // ── Single run mode ───────────────────────────────────
    try {
      const analysis = await runAnalysis(redis, showSpinners);

      if (OPTIONS.json) {
        const jsonOutput = buildJsonOutput(parsedUrl, displayHost, analysis);
        console.info(JSON.stringify(jsonOutput, null, 2));
      } else {
        printReport(parsedUrl, displayHost, analysis, previousReport);

        await waitForKeypress();

        printMemoryCheck(analysis.results.memory);
        printPerformanceCheck(analysis.results.performance);
        printConnectionCheck(analysis.results.connections);

        if (analysis.results.keyPatterns) {
          printKeyPatternCheck(analysis.results.keyPatterns);
        }

        printReplicationCheck(analysis.results.replication);
      }

      // Exit codes based on severity
      const exitCode = analysis.criticals > 0 ? 2 : analysis.warnings > 0 ? 1 : 0;
      await redis.quit();
      process.exit(exitCode);
    } catch (error) {
      await redis.quit();
      throw error;
    }
  }
}

run().catch((error) => {
  console.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
