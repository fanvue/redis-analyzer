import readline from "node:readline";
import { Writable } from "node:stream";

/**
 * Prompt the user for text input.
 *
 * @param {string} question - The prompt text to display
 * @returns {Promise<string>} The user's input
 */
export function askQuestion(question) {
  const readlineInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    readlineInterface.question(question, (answer) => {
      readlineInterface.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt the user for a password with hidden input.
 * Uses a muted output stream so the password is not echoed,
 * but readline still handles paste and line editing normally.
 *
 * @param {string} question - The prompt text to display
 * @returns {Promise<string>} The user's password input
 */
export function askPassword(question) {
  return new Promise((resolve) => {
    // Create a writable stream that suppresses all output.
    // This prevents readline from echoing typed/pasted characters.
    const muted = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    // Write the prompt ourselves before readline takes over
    process.stdout.write(question);

    const readlineInterface = readline.createInterface({
      input: process.stdin,
      output: muted,
      terminal: true,
    });

    readlineInterface.question("", (answer) => {
      readlineInterface.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

/**
 * Wait for the user to press Enter before continuing.
 *
 * @param {string} [message="  Press Enter to view detailed report..."]
 * @returns {Promise<void>}
 */
export function waitForKeypress(message = "  Press Enter to view detailed report...") {
  return new Promise((resolve) => {
    process.stdout.write(`\n${message}`);
    const readlineInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    readlineInterface.once("line", () => {
      readlineInterface.close();
      resolve();
    });
  });
}

/**
 * Prompt for Redis credentials interactively.
 *
 * @returns {Promise<{username: string, password: string}>}
 */
export async function promptCredentials() {
  const username = await askQuestion("Redis username: ");
  const password = await askPassword("Redis password: ");
  return { username, password };
}
