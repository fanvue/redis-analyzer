import { bold, cyan, dim, white } from "colorette";
import { stripAnsi } from "../utils/format.js";
import { padToWidth } from "./screen.js";

const TAB_NAMES = ["Overview", "Memory", "Performance", "Connections", "Keys", "Replication"];

/**
 * Render the top header bar.
 *
 * @param {{ url: string, version: string, uptime: string, cols: number }} options
 * @returns {string}
 */
export function renderHeader({ url, version, uptime, cols }) {
  const title = " REDIS DIAGNOSTICS ";
  const info = ` ${url} ─ v${version} ─ Up ${uptime} `;
  // Build the actual line content, then measure it
  const inner = "─" + title + "─ " + info;
  const innerVisual = inner.length;
  const innerWidth = cols - 2; // account for ┌ and ┐
  const remaining = Math.max(0, innerWidth - innerVisual);
  return dim("┌") + dim("─") + bold(cyan(title)) + dim("─ ") + dim(info) + dim("─".repeat(remaining)) + dim("┐");
}

/**
 * Render the tab bar.
 *
 * @param {{ activeTab: number, cols: number }} options
 * @returns {string}
 */
export function renderTabBar({ activeTab, cols }) {
  const innerWidth = cols - 4;
  const tabs = TAB_NAMES.map((name, index) => {
    const label = `${index + 1}:${name}`;
    if (index === activeTab) {
      return bold(white(`[${label}]`));
    }
    return dim(`[${label}]`);
  });
  const joined = tabs.join(" ");
  const visual = stripAnsi(joined).length;
  const padding = Math.max(0, innerWidth - visual);
  return dim("│") + " " + joined + " ".repeat(padding) + " " + dim("│");
}

/**
 * Render a horizontal separator line.
 *
 * @param {number} cols
 * @returns {string}
 */
export function renderSeparator(cols) {
  return dim("├" + "─".repeat(cols - 2) + "┤");
}

/**
 * Render a blank bordered line.
 *
 * @param {number} cols
 * @returns {string}
 */
export function renderEmptyLine(cols) {
  return dim("│") + " ".repeat(cols - 2) + dim("│");
}

/**
 * Wrap a content line with left and right borders.
 *
 * @param {string} content
 * @param {number} cols
 * @returns {string}
 */
export function renderContentLine(content, cols) {
  const innerWidth = cols - 4;
  const visual = stripAnsi(content).length;
  if (visual > innerWidth) {
    const plain = stripAnsi(content);
    return dim("│") + " " + plain.slice(0, innerWidth) + " " + dim("│");
  }
  const padding = innerWidth - visual;
  return dim("│") + " " + content + " ".repeat(padding) + " " + dim("│");
}

/**
 * Render the footer bar with key hints and refresh status.
 *
 * @param {{ cols: number, refreshCountdown: string, isRefreshing: boolean, errorMessage: string | null }} options
 * @returns {string}
 */
export function renderFooter({ cols, refreshCountdown, isRefreshing, errorMessage }) {
  const innerWidth = cols - 4;
  const keys = "←/→ switch tabs │ r refresh │ p pause │ q quit";
  let status;
  if (errorMessage) {
    status = errorMessage;
  } else if (isRefreshing) {
    status = "Refreshing...";
  } else {
    status = refreshCountdown === "paused" ? "Paused" : `Next refresh in ${refreshCountdown}`;
  }
  const left = dim(keys);
  const leftVisual = stripAnsi(left).length;
  const gap = Math.max(1, innerWidth - leftVisual - status.length);
  const content = left + " ".repeat(gap) + dim(status);
  const contentVisual = stripAnsi(content).length;
  const rightPad = Math.max(0, innerWidth - contentVisual);
  return dim("│") + " " + content + " ".repeat(rightPad) + " " + dim("│");
}

/**
 * Render the bottom border.
 *
 * @param {number} cols
 * @returns {string}
 */
export function renderBottomBorder(cols) {
  return dim("└" + "─".repeat(cols - 2) + "┘");
}
