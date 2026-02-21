# Redis Analyzer

A production-safe CLI tool that runs comprehensive read-only diagnostics against any Redis instance to identify bottlenecks, misconfigurations, and performance issues.

Every command executed against Redis is strictly **read-only** — no data is modified, no keys are written, and no configuration is changed.

## Installation

```bash
npm install
```

Requires Node.js 22+ (ESM).

## Quick Start

```bash
# Connect with a URL
node src/cli.js redis://localhost:6379

# Connect with TLS
node src/cli.js rediss://user@your-redis-host:6380

# The CLI will prompt for credentials if not included in the URL
```

When connecting with a username in the URL but no password, the tool prompts for the password interactively (input is hidden). When no credentials are provided at all, it prompts for both username and password. If authentication fails, it re-prompts instead of exiting.

## Usage

```
redis-analyzer <redis-url | connection-name> [options]
```

### Arguments

| Argument          | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `redis-url`       | Redis connection URL (`redis://` or `rediss://` for TLS) |
| `connection-name` | Named connection from `.redis-analyzer.json` config file |

### Options

| Flag                    | Description                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| `--json`                | Output results as JSON instead of the ASCII report               |
| `--scan-count <n>`      | Number of keys to sample for big key detection (default: `1000`) |
| `--no-scan`             | Skip key pattern analysis (fastest mode)                         |
| `--insecure`            | Skip TLS certificate verification (for self-signed certificates) |
| `--watch <seconds>`     | Re-run analysis every N seconds (live monitoring mode)           |
| `--compare <file.json>` | Compare current results against a previous JSON export           |
| `--help, -h`            | Show help                                                        |

### Exit Codes

| Code | Meaning                       |
| ---- | ----------------------------- |
| `0`  | All checks passed             |
| `1`  | Warning-level issues detected |
| `2`  | Critical issues detected      |

Exit codes enable automation: `redis-analyzer redis://host:6379 || send_alert`.

## Diagnostic Checks

### 1. Memory Analysis

Analyzes memory usage, fragmentation, and eviction behavior.

**Redis commands used:** `INFO memory`

| Metric                                | Warning       | Critical |
| ------------------------------------- | ------------- | -------- |
| Memory utilization (used / maxmemory) | > 75%         | > 90%    |
| Fragmentation ratio                   | > 1.5         | > 2.0    |
| Evicted keys                          | Any evictions | —        |

Displays: used memory, peak memory, maxmemory, fragmentation ratio with bar chart, eviction policy, dataset vs overhead breakdown.

### 2. Performance Analysis

Evaluates throughput, cache efficiency, and slow commands.

**Redis commands used:** `INFO stats`, `INFO server`, `SLOWLOG GET 20`, `SLOWLOG LEN`

| Metric               | Warning     | Critical |
| -------------------- | ----------- | -------- |
| Cache hit rate       | < 90%       | < 70%    |
| Rejected connections | Any         | —        |
| Slow log entries     | > 100 total | —        |

Displays: operations/second, total commands processed, hit rate with bar chart, slow log table sorted by duration (showing command + key only, not values), uptime.

### 3. Connection Analysis

Examines client connections, utilization, and idle behavior.

**Redis commands used:** `INFO clients`, `CLIENT LIST`, `CONFIG GET maxclients`

| Metric                                      | Warning | Critical |
| ------------------------------------------- | ------- | -------- |
| Client utilization (connected / maxclients) | > 80%   | —        |
| Blocked clients                             | Any     | —        |
| Large output buffers (> 1 MB)               | Any     | —        |

Displays: connected clients vs maxclients with bar chart, blocked clients, long-idle clients (> 300s), client distribution by database.

**Safety:** Skips `CLIENT LIST` parsing when there are more than 5,000 clients. Gracefully handles `CONFIG GET` being disabled on managed Redis.

### 4. Key Pattern Analysis

Samples keys using SCAN to analyze types, sizes, TTL distribution, and key prefix patterns.

**Redis commands used:** `INFO keyspace`, `SCAN`, `TYPE`, `MEMORY USAGE key SAMPLES 0`, `TTL`, `OBJECT ENCODING`

| Metric           | Warning         | Critical |
| ---------------- | --------------- | -------- |
| Keys without TTL | > 50% of sample | —        |

Displays: total keys per database, type distribution with bar chart, top 20 largest keys, TTL distribution (no expiry, < 1h, 1h-24h, 1d-7d, > 7d), key prefix groups sorted by memory usage.

**Safety:** Uses cursor-based `SCAN` (non-blocking). Pipelines commands in batches of 50. Default sample size is 1,000 keys. Skippable with `--no-scan`.

### 5. Replication and Persistence

Checks replication health and data persistence status.

**Redis commands used:** `INFO replication`, `INFO persistence`

| Metric                          | Warning      | Critical     |
| ------------------------------- | ------------ | ------------ |
| Replica lag                     | > 10 seconds | —            |
| Replica state                   | —            | Not "online" |
| Master link status (if replica) | —            | Not "up"     |
| Last RDB save                   | —            | Failed       |
| Last AOF write (if enabled)     | —            | Failed       |

Displays: role (master/slave), replica IP, status, lag, last RDB save time and status, changes since last save, AOF status.

## Report Structure

The report is divided into two parts:

### Summary (shown first)

The top summary displays:

- Overall status with warning/critical counts
- Per-section status icons on one line
- All findings listed upfront
- **Recommended Actions** — actionable fix suggestions for each finding

The tool pauses after the summary and waits for Enter before showing the detailed sections. This lets you focus on the key findings first.

### Detailed Sections (shown after pressing Enter)

Each section displays metrics with colored bar charts, formatted tables with box-drawing borders, and status-colored findings.

## Watch Mode

Live monitoring that re-runs the analysis on an interval:

```bash
node src/cli.js redis://host:6379 --watch 10
```

- Clears the screen between iterations
- Automatically compares against the previous iteration to show deltas
- Auto-reconnects if the Redis connection drops
- Press **Escape** or **Ctrl+C** to stop

## Comparison Mode

Compare current state against a previously saved JSON export:

```bash
# Save a baseline
node src/cli.js redis://host:6379 --json > before.json

# Make changes, then compare
node src/cli.js redis://host:6379 --compare before.json
```

The comparison table shows each metric with its previous value, current value, and a colored delta arrow (green for improvements, red for regressions).

Compared metrics: memory used, fragmentation ratio, memory utilization, hit rate, operations/second, slow log entries, connected clients, warning count, critical count.

## Named Connections

Create a `.redis-analyzer.json` file in your project root:

```json
{
  "connections": {
    "prod": "rediss://user@prod-redis-host:6380",
    "staging": "redis://staging-redis-host:6379",
    "local": "redis://localhost:6379"
  },
  "defaults": {
    "scanCount": 5000,
    "insecure": false,
    "noScan": false
  }
}
```

Then connect by name:

```bash
node src/cli.js prod
node src/cli.js staging --json
node src/cli.js local --watch 5
```

The config file is resolved by walking up from the current directory (similar to `.eslintrc`). CLI flags always override config defaults.

## JSON Output

Use `--json` for machine-readable output:

```bash
node src/cli.js redis://host:6379 --json > report.json
```

The JSON output contains all metrics, findings, and status for every check. Spinners and interactive prompts are suppressed in JSON mode.

## Project Structure

```
src/
  cli.js                         Entry point
  commands/
    analyze.js                   Orchestrator: connection, checks, output
  checks/
    memoryCheck.js               Memory usage, fragmentation, evictions
    performanceCheck.js          Ops/sec, hit rate, slow log
    connectionCheck.js           Client list, blocked clients, utilization
    keyPatternCheck.js           Key sampling, types, TTL, big keys
    replicationCheck.js          Replication lag, persistence status
  utils/
    connection.js                ioredis connection factory with TLS support
    format.js                    Colors, bar charts, tables, spinners
    thresholds.js                Warning/critical threshold constants
    prompt.js                    Interactive credential prompts
    recommendations.js           Finding-to-action mapping engine
    comparison.js                Delta comparison between reports
    config.js                    Named connection config loader
```

## Dependencies

- **ioredis** — Redis client with TLS, cluster, and pipeline support
- **colorette** — Lightweight terminal colors (no dependencies)

## Examples

```bash
# Basic analysis
node src/cli.js redis://localhost:6379

# Production with TLS and more key sampling
node src/cli.js rediss://user@prod-host:6380 --scan-count 5000

# Fast mode (skip key scanning)
node src/cli.js redis://host:6379 --no-scan

# JSON export for CI/automation
node src/cli.js redis://host:6379 --json > report.json

# Live monitoring every 30 seconds
node src/cli.js redis://host:6379 --watch 30

# Compare before and after a change
node src/cli.js redis://host:6379 --json > before.json
# ... make changes ...
node src/cli.js redis://host:6379 --compare before.json

# Use a named connection
node src/cli.js prod
```
