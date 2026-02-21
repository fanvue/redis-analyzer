import Redis from "ioredis";

/**
 * Create an ioredis connection from a Redis URL.
 * Supports both redis:// and rediss:// (TLS) protocols.
 *
 * @param {string} url - Redis connection URL
 * @param {object} [connectionOptions]
 * @param {boolean} [connectionOptions.insecure] - Skip TLS certificate verification
 * @param {string} [connectionOptions.username] - Override username from URL
 * @param {string} [connectionOptions.password] - Override password from URL
 * @param {boolean} [connectionOptions.keepAlive] - Enable auto-reconnect (for watch mode)
 * @returns {Redis} ioredis client instance
 */
export function createConnection(url, connectionOptions = {}) {
  const parsedUrl = new URL(url);
  const useTls = parsedUrl.protocol === "rediss:";
  const rejectUnauthorized =
    parsedUrl.searchParams.get("rejectUnauthorized") !== "false" && !connectionOptions.insecure;

  const username =
    connectionOptions.username || decodeURIComponent(parsedUrl.username) || undefined;
  const password =
    connectionOptions.password || decodeURIComponent(parsedUrl.password) || undefined;

  const options = {
    host: parsedUrl.hostname,
    port: parseInt(parsedUrl.port || "6379", 10),
    username,
    password,
    db: parseInt(parsedUrl.pathname.slice(1) || "0", 10),
    connectTimeout: 10_000,
    commandTimeout: 5_000,
    maxRetriesPerRequest: connectionOptions.keepAlive ? 3 : 1,
    enableOfflineQueue: connectionOptions.keepAlive || false,
    lazyConnect: true,
    ...(useTls ? { tls: { rejectUnauthorized } } : {}),
  };

  const redis = new Redis(options);

  // Suppress unhandled error events (errors are caught at the call site)
  redis.on("error", () => {});

  return redis;
}

/**
 * Parse a Redis INFO section response into a key-value object.
 *
 * @param {string} infoString - Raw INFO response string
 * @returns {Record<string, string>} Parsed key-value pairs
 */
export function parseInfoSection(infoString) {
  const result = {};
  const lines = infoString.split("\r\n");

  for (const line of lines) {
    if (line.startsWith("#") || line.trim() === "") {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    result[key] = value;
  }

  return result;
}
