import {
  bgGreen,
  bgRed,
  bgYellow,
  bold,
  cyan,
  dim,
  green,
  greenBright,
  red,
  redBright,
  white,
  whiteBright,
  yellow,
  yellowBright,
} from "colorette";

const HEADER_WIDTH = 80;
const SEPARATOR = "═".repeat(HEADER_WIDTH);
const LINE = "─".repeat(HEADER_WIDTH);

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

/**
 * Strip ANSI escape codes from a string to get its visual length.
 *
 * @param {string} text
 * @returns {string}
 */
function stripAnsi(text) {
  return String(text).replace(ANSI_REGEX, "");
}

// ── Status icons ──────────────────────────────────────────────

const STATUS_ICON = {
  ok: green("✓"),
  warning: yellow("⚠"),
  critical: red("✗"),
};

// ── Formatting helpers ────────────────────────────────────────

/**
 * Format bytes into a human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(2)} ${units[index]}`;
}

/**
 * Format a number with comma separators.
 *
 * @param {number} number
 * @returns {string}
 */
export function formatNumber(number) {
  return number.toLocaleString("en-US");
}

/**
 * Format seconds into a human-readable duration.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 && days === 0) {
    parts.push(`${minutes}m`);
  }
  if (parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}

/**
 * Format a percentage value.
 *
 * @param {number} value
 * @param {number} [decimals=1]
 * @returns {string}
 */
export function formatPercent(value, decimals = 1) {
  return `${value.toFixed(decimals)}%`;
}

// ── Color helpers ─────────────────────────────────────────────

/**
 * Apply color based on status.
 *
 * @param {string} text
 * @param {"ok" | "warning" | "critical"} status
 * @returns {string}
 */
export function colorByStatus(text, status) {
  switch (status) {
    case "ok":
      return green(text);
    case "warning":
      return yellow(text);
    case "critical":
      return red(text);
    default:
      return text;
  }
}

/**
 * Get the status badge string with color.
 *
 * @param {"ok" | "warning" | "critical"} status
 * @returns {string}
 */
export function statusBadge(status) {
  switch (status) {
    case "ok":
      return bold(bgGreen(whiteBright(" OK ")));
    case "warning":
      return bold(bgYellow(whiteBright(" WARNING ")));
    case "critical":
      return bold(bgRed(whiteBright(" CRITICAL ")));
    default:
      return " UNKNOWN ";
  }
}

/**
 * Get the status icon.
 *
 * @param {"ok" | "warning" | "critical"} status
 * @returns {string}
 */
export function statusIcon(status) {
  return STATUS_ICON[status] || "?";
}

// ── Bar chart ─────────────────────────────────────────────────

/**
 * Render a horizontal bar using block characters.
 *
 * @param {number} ratio - Value between 0 and 1
 * @param {number} [width=20] - Total bar width in characters
 * @param {"ok" | "warning" | "critical"} [status="ok"] - Color scheme
 * @returns {string}
 */
export function renderBar(ratio, width = 20, status = "ok") {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const filledBar = "█".repeat(filled);
  const emptyBar = dim("░".repeat(empty));
  return colorByStatus(filledBar, status) + emptyBar;
}

// ── Table helpers ─────────────────────────────────────────────

/**
 * Print a formatted table with box-drawing borders.
 *
 * @param {object} options
 * @param {string[]} options.headers - Column header labels
 * @param {number[]} options.widths - Column widths
 * @param {("left" | "right")[]} [options.alignments] - Column alignments
 * @param {string[][]} options.rows - Table data rows
 * @param {string} [options.indent="  "] - Left indent
 */
export function printTable({ headers, widths, alignments, rows, indent = "  " }) {
  const align = alignments || headers.map(() => "left");

  const formatCell = (text, colIndex) => {
    const width = widths[colIndex];
    const str = String(text);
    const visual = stripAnsi(str);
    const ansiOverhead = str.length - visual.length;

    if (visual.length > width) {
      // Truncate based on visual length, then re-apply would lose codes — truncate the plain text and skip coloring
      const truncated = visual.slice(0, width - 3) + "...";
      return align[colIndex] === "right" ? truncated.padStart(width) : truncated.padEnd(width);
    }

    // Pad using the visual width, but add ansiOverhead so padStart/padEnd produce correct visual alignment
    const padWidth = width + ansiOverhead;
    return align[colIndex] === "right" ? str.padStart(padWidth) : str.padEnd(padWidth);
  };

  // Top border
  const topBorder = `${indent}┌${widths.map((width) => "─".repeat(width + 2)).join("┬")}┐`;
  console.info(dim(topBorder));

  // Header row
  const headerRow = headers
    .map((header, index) => ` ${bold(formatCell(header, index))} `)
    .join(dim("│"));
  console.info(`${indent}${dim("│")}${headerRow}${dim("│")}`);

  // Header separator
  const headerSeparator = `${indent}├${widths.map((width) => "─".repeat(width + 2)).join("┼")}┤`;
  console.info(dim(headerSeparator));

  // Data rows
  for (const row of rows) {
    const dataRow = row.map((cell, index) => ` ${formatCell(cell, index)} `).join(dim("│"));
    console.info(`${indent}${dim("│")}${dataRow}${dim("│")}`);
  }

  // Bottom border
  const bottomBorder = `${indent}└${widths.map((width) => "─".repeat(width + 2)).join("┴")}┘`;
  console.info(dim(bottomBorder));
}

// ── Section output ────────────────────────────────────────────

/**
 * Print a section header with a colored status badge.
 *
 * @param {string} title
 * @param {"ok" | "warning" | "critical"} status
 */
export function printSectionHeader(title, status) {
  const badge = statusBadge(status);
  console.info(`\n  ${bold(white(title))}  ${badge}`);
  console.info(`  ${dim(LINE)}`);
}

/**
 * Print the main report header.
 *
 * @param {object} serverInfo
 * @param {string} serverInfo.url
 * @param {string} serverInfo.version
 * @param {string} serverInfo.uptime
 */
export function printReportHeader(serverInfo) {
  console.info("");
  console.info(dim(SEPARATOR));
  console.info(bold(cyan("  REDIS DIAGNOSTICS REPORT")));
  console.info(dim(SEPARATOR));
  console.info(
    `  ${dim("Server:")}      ${bold(serverInfo.url)} ${dim(`(Redis ${serverInfo.version})`)}`
  );
  console.info(`  ${dim("Uptime:")}      ${serverInfo.uptime}`);
  console.info(`  ${dim("Timestamp:")}   ${dim(new Date().toISOString())}`);
  console.info(dim(SEPARATOR));
}

/**
 * Print the key findings summary at the top of the report.
 *
 * @param {object} options
 * @param {number} options.warnings - Total warning count
 * @param {number} options.criticals - Total critical count
 * @param {{title: string, status: string, findings: string[]}[]} options.sections - All check results
 */
export function printTopSummary({ warnings, criticals, sections }) {
  const overallStatus = criticals > 0 ? "critical" : warnings > 0 ? "warning" : "ok";
  const overallIcon = statusIcon(overallStatus);

  const parts = [];
  if (criticals > 0) {
    parts.push(bold(red(`${criticals} critical`)));
  } else {
    parts.push(dim("0 critical"));
  }
  if (warnings > 0) {
    parts.push(bold(yellow(`${warnings} warning(s)`)));
  } else {
    parts.push(dim("0 warnings"));
  }

  console.info(`\n  ${overallIcon} ${bold("SUMMARY:")} ${parts.join(dim(" │ "))}`);

  // Show per-section status line
  const sectionParts = sections.map(
    (section) => `${statusIcon(section.status)} ${dim(section.title.toLowerCase())}`
  );
  console.info(`    ${sectionParts.join("  ")}`);

  // Collect all findings across sections
  const allFindings = sections.flatMap((section) =>
    section.findings.map((finding) => ({ finding, status: section.status }))
  );

  if (allFindings.length > 0) {
    console.info("");
    for (const { finding, status } of allFindings) {
      const icon = status === "critical" ? red("✗") : yellow("⚠");
      const coloredMessage = status === "critical" ? redBright(finding) : yellowBright(finding);
      console.info(`    ${icon}  ${coloredMessage}`);
    }
  }
}

/**
 * Print the summary footer.
 *
 * @param {number} warnings
 * @param {number} criticals
 */
export function printSummary(warnings, criticals) {
  console.info(`\n${dim(SEPARATOR)}`);

  const parts = [];
  if (criticals > 0) {
    parts.push(bold(red(`${criticals} critical`)));
  } else {
    parts.push(dim("0 critical"));
  }
  if (warnings > 0) {
    parts.push(bold(yellow(`${warnings} warning(s)`)));
  } else {
    parts.push(dim("0 warnings"));
  }

  const overallStatus = criticals > 0 ? "critical" : warnings > 0 ? "warning" : "ok";
  const overallIcon = statusIcon(overallStatus);

  console.info(`  ${overallIcon} ${bold("SUMMARY:")} ${parts.join(dim(" │ "))}`);
  console.info(dim(SEPARATOR));
}

/**
 * Print a labeled metric line with consistent padding.
 *
 * @param {string} label
 * @param {string} value
 * @param {number} [labelWidth=22]
 */
export function printMetric(label, value, labelWidth = 22) {
  const visualLength = stripAnsi(label).length;
  const padded = label + " ".repeat(Math.max(0, labelWidth - visualLength));
  console.info(`    ${dim(padded)} ${value}`);
}

/**
 * Print a finding/warning bullet point with a status icon.
 *
 * @param {string} message
 * @param {"warning" | "critical"} [severity="warning"]
 */
export function printFinding(message, severity = "warning") {
  const icon = severity === "critical" ? red("✗") : yellow("⚠");
  const coloredMessage = severity === "critical" ? redBright(message) : yellowBright(message);
  console.info(`    ${icon}  ${coloredMessage}`);
}

/**
 * Print a success/info bullet point.
 *
 * @param {string} message
 */
export function printInfo(message) {
  console.info(`    ${dim("ℹ")}  ${dim(message)}`);
}

// ── Spinner ───────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Create a lightweight terminal spinner.
 *
 * @param {string} text - Initial spinner text
 * @returns {{ update: (text: string) => void, succeed: (text: string) => void, fail: (text: string) => void, stop: () => void }}
 */
export function createSpinner(text) {
  let frameIndex = 0;
  let currentText = text;
  let interval = null;

  const isTTY = process.stderr.isTTY;

  const render = () => {
    if (!isTTY) {
      return;
    }
    const frame = cyan(SPINNER_FRAMES[frameIndex]);
    process.stderr.write(`\r  ${frame} ${currentText}`);
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  };

  const clearLine = () => {
    if (!isTTY) {
      return;
    }
    process.stderr.write("\r" + " ".repeat(currentText.length + 10) + "\r");
  };

  // Start spinning
  if (isTTY) {
    render();
    interval = setInterval(render, 80);
  }

  return {
    update(newText) {
      clearLine();
      currentText = newText;
    },
    succeed(successText) {
      clearInterval(interval);
      clearLine();
      if (isTTY) {
        process.stderr.write(`\r  ${green("✓")} ${successText}\n`);
      }
    },
    fail(failText) {
      clearInterval(interval);
      clearLine();
      if (isTTY) {
        process.stderr.write(`\r  ${red("✗")} ${failText}\n`);
      }
    },
    stop() {
      clearInterval(interval);
      clearLine();
    },
  };
}

// ── Re-exports for use in check modules ───────────────────────

export { bold, cyan, dim, green, greenBright, red, redBright, white, yellow, yellowBright };
