import { bold, cyan, dim } from "colorette";
import { buildJsonOutput, runAnalysis } from "../utils/analysis.js";
import { parseInfoSection } from "../utils/connection.js";
import { formatDuration } from "../utils/format.js";
import { startInputHandler, stopInputHandler } from "./input.js";
import {
  renderBottomBorder,
  renderContentLine,
  renderEmptyLine,
  renderFooter,
  renderHeader,
  renderSeparator,
  renderTabBar,
} from "./layout.js";
import {
  enterAltScreen,
  exitAltScreen,
  getTerminalSize,
  hideCursor,
  renderFrame,
  showCursor,
} from "./screen.js";
import { renderOverviewTab } from "./tabs/overview.js";
import { renderMemoryTab } from "./tabs/memory.js";
import { renderPerformanceTab } from "./tabs/performance.js";
import { renderConnectionsTab } from "./tabs/connections.js";
import { renderKeysTab } from "./tabs/keys.js";
import { renderReplicationTab } from "./tabs/replication.js";

const MIN_COLS = 60;
const MIN_ROWS = 15;
const CHROME_ROWS = 6; // header + tab bar + separator + separator + footer + bottom border

/**
 * Start the interactive TUI dashboard.
 *
 * @param {{ redis: import("ioredis").Redis | null, parsedUrl: URL, displayHost: string, options: object, previousReport: object | null, demoLoader?: () => object }} params
 */
export async function startDashboard({ redis, parsedUrl, displayHost, options, previousReport, demoLoader }) {
  let activeTab = 0;
  let lastRefreshed = Date.now();
  let analysis = null;
  let isRefreshing = false;
  let errorMessage = null;
  let refreshTimer = null;
  let renderInterval = null;
  let exiting = false;
  let paused = false;
  const hitRateHistory = [];
  let previousHits = null;
  let previousMisses = null;

  const refreshSeconds = options.watch > 0 ? options.watch : 15;

  const cleanup = async (exitCode = 0) => {
    if (exiting) {
      return;
    }
    exiting = true;

    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    if (renderInterval) {
      clearInterval(renderInterval);
    }

    stopInputHandler();
    showCursor();
    exitAltScreen();

    if (redis) {
      try {
        await redis.quit();
      } catch {
        /* ignore */
      }
    }

    process.exit(exitCode);
  };

  const getExitCode = () => {
    if (!analysis) {
      return 0;
    }
    return analysis.criticals > 0 ? 2 : analysis.warnings > 0 ? 1 : 0;
  };

  const render = () => {
    const { cols, rows } = getTerminalSize();

    // Minimum size check
    if (cols < MIN_COLS || rows < MIN_ROWS) {
      const lines = [];
      for (let i = 0; i < rows; i++) {
        lines.push("");
      }
      const msg = `Please resize terminal to at least ${MIN_COLS}x${MIN_ROWS}`;
      const midRow = Math.floor(rows / 2);
      lines[midRow] = " ".repeat(Math.max(0, Math.floor((cols - msg.length) / 2))) + msg;
      renderFrame(lines);
      return;
    }

    const contentRows = rows - CHROME_ROWS;
    const uptime = analysis ? formatDuration(analysis.serverInfo.uptimeSeconds) : "...";
    const version = analysis ? analysis.serverInfo.redisVersion : "...";
    const url = `${parsedUrl.protocol}//${displayHost}`;

    // Calculate time until next refresh
    const elapsed = Math.floor((Date.now() - lastRefreshed) / 1000);
    const secondsUntilRefresh = Math.max(0, refreshSeconds - elapsed);
    const refreshCountdown = paused ? "paused" : secondsUntilRefresh <= 0 ? "now" : `${secondsUntilRefresh}s`;

    const frameLines = [];

    // Header
    frameLines.push(renderHeader({ url, version, uptime, cols }));
    // Tab bar
    frameLines.push(renderTabBar({ activeTab, cols }));
    // Separator
    frameLines.push(renderSeparator(cols));

    // Content area
    let contentLines;
    if (!analysis) {
      contentLines = [];
      contentLines.push("");
      contentLines.push(`  ${dim("Loading...")}`);
      while (contentLines.length < contentRows) {
        contentLines.push("");
      }
    } else {
      const tabOptions = { result: analysis, cols: cols - 4, contentRows };
      switch (activeTab) {
        case 0:
          contentLines = renderOverviewTab({
            ...tabOptions,
            previousReport,
            parsedUrl,
            displayHost,
          });
          break;
        case 1:
          contentLines = renderMemoryTab(tabOptions);
          break;
        case 2:
          contentLines = renderPerformanceTab({ ...tabOptions, hitRateHistory });
          break;
        case 3:
          contentLines = renderConnectionsTab(tabOptions);
          break;
        case 4:
          contentLines = renderKeysTab({ ...tabOptions, noScan: options.noScan });
          break;
        case 5:
          contentLines = renderReplicationTab(tabOptions);
          break;
        default:
          contentLines = [];
          while (contentLines.length < contentRows) {
            contentLines.push("");
          }
      }
    }

    for (const line of contentLines) {
      frameLines.push(renderContentLine(line, cols));
    }

    // Footer separator
    frameLines.push(renderSeparator(cols));
    // Footer
    frameLines.push(renderFooter({ cols, refreshCountdown, isRefreshing, errorMessage }));
    // Bottom border
    frameLines.push(renderBottomBorder(cols));

    renderFrame(frameLines);
  };

  const doRefresh = async () => {
    if (isRefreshing || exiting) {
      return;
    }
    isRefreshing = true;
    errorMessage = null;
    render();

    try {
      if (demoLoader) {
        analysis = demoLoader();
      } else {
        // Check connection health
        try {
          await redis.ping();
        } catch {
          try {
            redis.disconnect();
          } catch {
            /* ignore */
          }
          await redis.connect();
        }

        // Reuse key pattern results on refreshes — key scanning is expensive
        const refreshOptions = analysis?.results?.keyPatterns
          ? { ...options, previousKeyPatterns: analysis.results.keyPatterns }
          : options;
        analysis = await runAnalysis(redis, false, refreshOptions);
      }
      lastRefreshed = Date.now();
      errorMessage = null;

      // Track per-period hit rate history for the performance tab chart
      const perfMetrics = analysis.results.performance?.metrics;
      if (perfMetrics) {
        const currentHits = perfMetrics.keyspaceHits;
        const currentMisses = perfMetrics.keyspaceMisses;

        if (previousHits !== null && previousMisses !== null) {
          const deltaHits = currentHits - previousHits;
          const deltaMisses = currentMisses - previousMisses;
          const deltaTotal = deltaHits + deltaMisses;
          const periodHitRate = deltaTotal > 0 ? (deltaHits / deltaTotal) * 100 : 0;
          hitRateHistory.push(periodHitRate);
          if (hitRateHistory.length > 10) {
            hitRateHistory.shift();
          }
        } else if (redis && !demoLoader) {
          // First refresh: take a 1-second snapshot to seed the chart
          // without using the lifetime cumulative rate
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const statsRaw = await redis.info("stats");
          const stats = parseInfoSection(statsRaw);
          const snapshotHits = parseInt(stats.keyspace_hits || "0", 10);
          const snapshotMisses = parseInt(stats.keyspace_misses || "0", 10);
          const deltaHits = snapshotHits - currentHits;
          const deltaMisses = snapshotMisses - currentMisses;
          const deltaTotal = deltaHits + deltaMisses;
          if (deltaTotal > 0) {
            hitRateHistory.push((deltaHits / deltaTotal) * 100);
          }
        }

        previousHits = currentHits;
        previousMisses = currentMisses;
      }
    } catch (error) {
      // Keep last good data, show error in footer
      errorMessage = `Error: ${error.message.slice(0, 40)}`;
    }

    isRefreshing = false;
    render();

    // Schedule next refresh
    if (!exiting && !paused) {
      refreshTimer = setTimeout(doRefresh, refreshSeconds * 1000);
    }
  };

  // Handle keyboard input
  const handleKey = (key) => {
    switch (key) {
      case "quit":
        cleanup(getExitCode());
        break;
      case "refresh":
        if (refreshTimer) {
          clearTimeout(refreshTimer);
        }
        paused = false;
        doRefresh();
        break;
      case "pause":
        paused = !paused;
        if (paused) {
          if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
          }
        } else {
          lastRefreshed = Date.now();
          refreshTimer = setTimeout(doRefresh, refreshSeconds * 1000);
        }
        render();
        break;
      case "left":
        activeTab = (activeTab - 1 + 6) % 6;
        render();
        break;
      case "right":
        activeTab = (activeTab + 1) % 6;
        render();
        break;
      case "tab1":
        activeTab = 0;
        render();
        break;
      case "tab2":
        activeTab = 1;
        render();
        break;
      case "tab3":
        activeTab = 2;
        render();
        break;
      case "tab4":
        activeTab = 3;
        render();
        break;
      case "tab5":
        activeTab = 4;
        render();
        break;
      case "tab6":
        activeTab = 5;
        render();
        break;
    }
  };

  // Set up
  enterAltScreen();
  hideCursor();
  render();

  startInputHandler({ onKey: handleKey });

  // Handle SIGWINCH (terminal resize)
  process.on("SIGWINCH", render);

  // Handle SIGINT
  process.on("SIGINT", () => cleanup(getExitCode()));

  // Initial analysis
  await doRefresh();

  // Re-render periodically to update the "refreshed X ago" timer
  renderInterval = setInterval(render, 1000);

  // Keep process alive
  await new Promise(() => {});
}
