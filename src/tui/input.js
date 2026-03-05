/**
 * Raw keyboard input handler for TUI.
 * Maps raw bytes to named key events.
 */

let stdinHandler = null;
let escapeTimer = null;
let escapeBuffer = null;

const KEY_MAP = {
  0x03: "quit",    // Ctrl+C
  0x71: "quit",    // q
  0x72: "refresh", // r
  0x31: "tab1",    // 1
  0x32: "tab2",    // 2
  0x33: "tab3",    // 3
  0x34: "tab4",    // 4
  0x35: "tab5",    // 5
  0x36: "tab6",    // 6
  0x70: "pause",   // p
};

/**
 * Start listening for raw keyboard input.
 *
 * @param {{ onKey: (key: string) => void }} options
 */
export function startInputHandler({ onKey }) {
  if (!process.stdin.isTTY) {
    return;
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  stdinHandler = (data) => {
    const bytes = Buffer.from(data);

    // Handle escape sequences (arrow keys)
    if (bytes[0] === 0x1b) {
      if (bytes.length === 1) {
        // Might be standalone Escape or start of a sequence.
        // Buffer it and wait briefly.
        escapeBuffer = bytes;
        escapeTimer = setTimeout(() => {
          escapeBuffer = null;
          onKey("quit"); // standalone Escape
        }, 50);
        return;
      }

      // Multi-byte escape sequence arrived at once
      if (escapeTimer) {
        clearTimeout(escapeTimer);
        escapeTimer = null;
        escapeBuffer = null;
      }

      if (bytes.length >= 3 && bytes[1] === 0x5b) {
        if (bytes[2] === 0x44) {
          onKey("left");
          return;
        }
        if (bytes[2] === 0x43) {
          onKey("right");
          return;
        }
      }
      return;
    }

    // If we had a buffered escape and got more bytes, it is a sequence
    if (escapeBuffer) {
      clearTimeout(escapeTimer);
      escapeTimer = null;
      const combined = Buffer.concat([escapeBuffer, bytes]);
      escapeBuffer = null;

      if (combined.length >= 3 && combined[1] === 0x5b) {
        if (combined[2] === 0x44) {
          onKey("left");
          return;
        }
        if (combined[2] === 0x43) {
          onKey("right");
          return;
        }
      }
      return;
    }

    // Direct key mapping
    const mapped = KEY_MAP[bytes[0]];
    if (mapped) {
      onKey(mapped);
    }
  };

  process.stdin.on("data", stdinHandler);
}

/**
 * Stop listening for keyboard input and restore stdin.
 */
export function stopInputHandler() {
  if (escapeTimer) {
    clearTimeout(escapeTimer);
    escapeTimer = null;
  }
  escapeBuffer = null;

  if (stdinHandler) {
    process.stdin.removeListener("data", stdinHandler);
    stdinHandler = null;
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}
