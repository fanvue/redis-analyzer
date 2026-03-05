import { stripAnsi } from "../utils/format.js";

const ESC = "\x1b";

export function enterAltScreen() {
  process.stdout.write(`${ESC}[?1049h`);
}

export function exitAltScreen() {
  process.stdout.write(`${ESC}[?1049l`);
}

export function hideCursor() {
  process.stdout.write(`${ESC}[?25l`);
}

export function showCursor() {
  process.stdout.write(`${ESC}[?25h`);
}

/**
 * Return terminal dimensions.
 *
 * @returns {{ cols: number, rows: number }}
 */
export function getTerminalSize() {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

/**
 * Pad a string (which may contain ANSI escapes) to a given visual width.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
export function padToWidth(text, width) {
  const visual = stripAnsi(text).length;
  if (visual >= width) {
    return text;
  }
  return text + " ".repeat(width - visual);
}

/**
 * Truncate a string (which may contain ANSI codes) to a max visual width.
 * Strips ANSI codes if truncation is needed for simplicity.
 *
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string}
 */
export function truncateToWidth(text, maxWidth) {
  const plain = stripAnsi(text);
  if (plain.length <= maxWidth) {
    return text;
  }
  return plain.slice(0, maxWidth);
}

/**
 * Render a full frame to stdout without flicker.
 * Uses cursor-home instead of clear-screen to avoid flash.
 *
 * @param {string[]} lines - Array of pre-formatted lines to render.
 */
export function renderFrame(lines) {
  const { cols } = getTerminalSize();
  const output = lines.map((line) => padToWidth(line, cols)).join("\n");
  process.stdout.write(`${ESC}[H${output}`);
}
