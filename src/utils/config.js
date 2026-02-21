import fs from "node:fs";
import path from "node:path";

const CONFIG_FILENAME = ".redis-analyzer.json";

/**
 * Search for a config file starting from the current directory and walking up.
 *
 * @returns {object|null} Parsed config or null if not found
 */
export function loadConfig() {
  let dir = process.cwd();

  while (true) {
    const configPath = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, "utf-8");
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return null;
}

/**
 * Resolve a URL-or-alias into an actual Redis URL.
 * If the input looks like a URL (starts with redis:// or rediss://), return it as-is.
 * Otherwise, look it up in the config's connections map.
 *
 * @param {string} input - URL or connection alias
 * @param {object|null} config - Loaded config
 * @returns {string|null} Resolved Redis URL or null if alias not found
 */
export function resolveConnection(input, config) {
  if (input.startsWith("redis://") || input.startsWith("rediss://")) {
    return input;
  }

  // Treat as named connection alias
  if (config?.connections?.[input]) {
    return config.connections[input];
  }

  return null;
}

/**
 * Get default options from config, merged with CLI flags.
 *
 * @param {object|null} config
 * @returns {object} Default options from config
 */
export function getConfigDefaults(config) {
  return config?.defaults || {};
}
