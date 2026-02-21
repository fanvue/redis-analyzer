import { bold, cyan, dim, green, yellow } from "colorette";

/**
 * Each recommendation maps a finding pattern (regex) to actionable advice.
 * Patterns are tested against finding strings from all checks.
 */
const RECOMMENDATION_MAP = [
  // Memory
  {
    pattern: /fragmentation ratio.*is high/i,
    title: "Reduce memory fragmentation",
    actions: [
      "Run MEMORY PURGE (Redis 4.0+) to release allocator pages",
      "If persistent, schedule a controlled restart during low-traffic window",
      "Consider switching to jemalloc allocator if using libc malloc",
    ],
  },
  {
    pattern: /memory usage at .* of maxmemory/i,
    title: "Free up memory or increase maxmemory",
    actions: [
      "Review keys with no TTL — add expiration where possible",
      "Check for oversized keys with the Key Pattern Analysis section",
      "If expected growth, increase maxmemory or scale the instance",
    ],
  },
  {
    pattern: /evicted keys detected/i,
    title: "Address key evictions",
    actions: [
      "Evictions mean Redis is dropping data to stay within limits",
      "Increase maxmemory or reduce data volume",
      "Review eviction policy — volatile-lru is safest for cache workloads",
    ],
  },
  {
    pattern: /fragmentation ratio.*is critically high/i,
    title: "Critical memory fragmentation",
    actions: [
      "Immediate MEMORY PURGE recommended",
      "If ratio exceeds 3.0, plan a restart — allocator is severely fragmented",
      "Monitor after fix to confirm it does not re-fragment quickly",
    ],
  },

  // Performance
  {
    pattern: /hit rate .* is below optimal/i,
    title: "Improve cache hit rate",
    actions: [
      "Review application cache key patterns for consistency",
      "Check if TTLs are too short, causing premature expiration",
      "Verify cache warming on deployment if using lazy population",
    ],
  },
  {
    pattern: /hit rate .* is critically low/i,
    title: "Critical cache hit rate",
    actions: [
      "Audit application code for cache key mismatches or typos",
      "Check if a recent deployment changed key naming conventions",
      "Consider preloading hot keys on startup",
    ],
  },
  {
    pattern: /slow log entries.*indicates systemic slow commands/i,
    title: "Address slow commands",
    actions: [
      "Review the Slow Log table above for recurring command patterns",
      "Replace O(N) commands (KEYS, SMEMBERS on large sets) with SCAN variants",
      "Check for Lua scripts that block the event loop",
    ],
  },
  {
    pattern: /connections rejected/i,
    title: "Increase maxclients or reduce connections",
    actions: [
      "Increase maxclients in Redis config if the instance has capacity",
      "Implement connection pooling in application clients",
      "Audit for connection leaks (clients not calling QUIT)",
    ],
  },

  // Connections
  {
    pattern: /client usage at .* of maxclients/i,
    title: "Client pool nearing capacity",
    actions: [
      "Increase maxclients if the server has available file descriptors",
      "Review application connection pool sizes across all services",
      "Close idle connections — see idle client count above",
    ],
  },
  {
    pattern: /clients idle for more than/i,
    title: "Clean up idle connections",
    actions: [
      "Configure client timeout in Redis (CONFIG SET timeout 300)",
      "Review application connection pool idle settings",
      "Idle clients consume memory and file descriptors",
    ],
  },
  {
    pattern: /clients with output buffers exceeding/i,
    title: "Investigate large output buffers",
    actions: [
      "Large buffers indicate slow consumers or massive responses",
      "Check for SUBSCRIBE clients that are not reading fast enough",
      "Review commands returning large datasets (LRANGE on long lists, etc.)",
    ],
  },
  {
    pattern: /blocked clients detected/i,
    title: "Investigate blocked clients",
    actions: [
      "Blocked clients are waiting on BLPOP, BRPOP, or similar commands",
      "High counts may indicate stalled consumers or long-running blocking operations",
      "Check if blocking commands have appropriate timeouts",
    ],
  },

  // Key patterns
  {
    pattern: /keys have no TTL.*memory growth risk/i,
    title: "Add TTLs to reduce memory leak risk",
    actions: [
      "Identify key prefixes without expiration in the Key Pattern section",
      "Add TTL to cache keys that don't need permanent storage",
      "Use EXPIRE or SETEX instead of plain SET for cache entries",
    ],
  },

  // Replication
  {
    pattern: /replica .* has lag of/i,
    title: "Reduce replication lag",
    actions: [
      "Check network latency between master and replica",
      "Reduce write volume if replica cannot keep up",
      "Consider increasing repl-backlog-size to avoid full resyncs",
    ],
  },
  {
    pattern: /master link status is/i,
    title: "Fix broken replication link",
    actions: [
      "Check network connectivity between master and replica",
      "Review replica logs for authentication or timeout errors",
      "A full resync may be needed if the backlog has been exhausted",
    ],
  },
  {
    pattern: /last RDB background save failed/i,
    title: "Fix RDB persistence",
    actions: [
      "Check disk space on the Redis server",
      "Review Redis logs for the specific save error",
      "Ensure the Redis process has write permissions to the RDB directory",
    ],
  },
  {
    pattern: /last AOF write failed/i,
    title: "Fix AOF persistence",
    actions: [
      "Check disk space and I/O performance",
      "Review appendfsync setting — everysec is recommended for most workloads",
      "If disk is full, clear space and run BGREWRITEAOF",
    ],
  },
];

/**
 * Generate recommendations based on findings from all checks.
 *
 * @param {{status: string, findings: string[]}[]} sections - All check results
 * @returns {{title: string, actions: string[]}[]}
 */
export function generateRecommendations(sections) {
  const allFindings = sections.flatMap((section) => section.findings);
  const recommendations = [];
  const seen = new Set();

  for (const finding of allFindings) {
    for (const rec of RECOMMENDATION_MAP) {
      if (rec.pattern.test(finding) && !seen.has(rec.title)) {
        seen.add(rec.title);
        recommendations.push({ title: rec.title, actions: rec.actions });
      }
    }
  }

  return recommendations;
}

/**
 * Print recommendations to the console.
 *
 * @param {{title: string, actions: string[]}[]} recommendations
 */
export function printRecommendations(recommendations) {
  if (recommendations.length === 0) {
    console.info(`\n  ${green(bold("No issues found — no recommendations needed."))}`);
    return;
  }

  console.info(`\n  ${bold(cyan("RECOMMENDED ACTIONS"))}`);
  console.info(`  ${dim("─".repeat(80))}`);

  for (let index = 0; index < recommendations.length; index++) {
    const rec = recommendations[index];
    console.info(`\n    ${bold(yellow(`${index + 1}. ${rec.title}`))}`);
    for (const action of rec.actions) {
      console.info(`       ${dim("→")} ${action}`);
    }
  }

  console.info("");
}
