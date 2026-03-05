#!/usr/bin/env node

import { printConnectionCheck } from "../checks/connectionCheck.js";
import { printKeyPatternCheck } from "../checks/keyPatternCheck.js";
import { printMemoryCheck } from "../checks/memoryCheck.js";
import { printPerformanceCheck } from "../checks/performanceCheck.js";
import { printReplicationCheck } from "../checks/replicationCheck.js";
import { buildJsonOutput, createDemoLoader, runAnalysis } from "../utils/analysis.js";
import { loadPreviousReport, printComparison } from "../utils/comparison.js";
import { getConfigDefaults, loadConfig, resolveConnection } from "../utils/config.js";
import { createConnection } from "../utils/connection.js";
import {
  createSpinner,
  dim,
  formatDuration,
  printReportHeader,
  printTopSummary,
} from "../utils/format.js";
import { askPassword, promptCredentials } from "../utils/prompt.js";
import { generateRecommendations, printRecommendations } from "../utils/recommendations.js";
import { startDashboard } from "../tui/dashboard.js";

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
  scanCount: getNumberFlag("--scan-count", configDefaults.scanCount || 500),
  scanCountExplicit: args.includes("--scan-count"),
  watch: getNumberFlag("--watch", 0),
  compare: getStringAfterFlag("--compare", null),
  demo: getStringAfterFlag("--demo", null),
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
  --watch <seconds>      TUI refresh interval in seconds (default: 10)
  --compare <file.json>  Compare results against a previous JSON export
  --demo <file.json>     Run with fake data from a fixture file (no Redis connection)
  --help, -h             Show help

Exit codes:
  0                      All checks passed
  1                      Warning-level issues detected
  2                      Critical issues detected

Examples:
  node src/cli.js redis://localhost:6379
  node src/cli.js rediss://user@host:6380
  node src/cli.js redis://host:6379 --json --scan-count 5000
  node src/cli.js redis://host:6379 --watch 10
  node src/cli.js redis://host:6379 --compare previous.json
  node src/cli.js prod
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

if (!rawInput && !OPTIONS.demo) {
  printHelp();
  process.exit(1);
}

// Resolve named connection or use URL directly
const REDIS_URL = OPTIONS.demo ? null : resolveConnection(rawInput, config);

if (!REDIS_URL && !OPTIONS.demo) {
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
  // ── Demo mode ────────────────────────────────────────────────
  if (OPTIONS.demo) {
    const demoLoader = createDemoLoader(OPTIONS.demo);
    const parsedUrl = new URL("redis://demo:6379");
    const displayHost = "demo:6379";

    if (!OPTIONS.json && process.stdout.isTTY) {
      await startDashboard({
        redis: null,
        parsedUrl,
        displayHost,
        options: OPTIONS,
        previousReport: null,
        demoLoader,
      });
    } else {
      const analysis = demoLoader();
      if (OPTIONS.json) {
        const jsonOutput = buildJsonOutput(parsedUrl, displayHost, analysis);
        console.info(JSON.stringify(jsonOutput, null, 2));
      } else {
        printReport(parsedUrl, displayHost, analysis, null);
        printMemoryCheck(analysis.results.memory);
        printPerformanceCheck(analysis.results.performance);
        printConnectionCheck(analysis.results.connections);
        if (analysis.results.keyPatterns) {
          printKeyPatternCheck(analysis.results.keyPatterns);
        }
        printReplicationCheck(analysis.results.replication);
      }
      process.exit(0);
    }
    return;
  }

  // ── Normal mode ──────────────────────────────────────────────
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
      keepAlive: OPTIONS.watch > 0 || (process.stdout.isTTY && !OPTIONS.json),
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

  if (!OPTIONS.json && process.stdout.isTTY) {
    // ── TTY: interactive TUI dashboard (handles its own refresh) ─
    await startDashboard({ redis, parsedUrl, displayHost, options: OPTIONS, previousReport });
  } else {
    // ── Non-interactive mode (JSON or piped output) ──────
    try {
      const analysis = await runAnalysis(redis, showSpinners, OPTIONS);

      if (OPTIONS.json) {
        const jsonOutput = buildJsonOutput(parsedUrl, displayHost, analysis);
        console.info(JSON.stringify(jsonOutput, null, 2));
      } else {
        // Non-TTY: scrolling report for piped output and CI
        printReport(parsedUrl, displayHost, analysis, previousReport);

        printMemoryCheck(analysis.results.memory);
        printPerformanceCheck(analysis.results.performance);
        printConnectionCheck(analysis.results.connections);

        if (analysis.results.keyPatterns) {
          printKeyPatternCheck(analysis.results.keyPatterns);
        }

        printReplicationCheck(analysis.results.replication);
      }

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
