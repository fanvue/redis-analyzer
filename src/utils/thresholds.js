// Memory thresholds
export const FRAGMENTATION_WARNING = 1.5;
export const FRAGMENTATION_CRITICAL = 2.0;
export const MEMORY_USAGE_WARNING_PERCENT = 75;
export const MEMORY_USAGE_CRITICAL_PERCENT = 90;

// Performance thresholds
export const HIT_RATE_WARNING_PERCENT = 90;
export const HIT_RATE_CRITICAL_PERCENT = 70;

// Connection thresholds
export const CLIENT_USAGE_WARNING_PERCENT = 80;
export const IDLE_CLIENT_THRESHOLD_SECONDS = 300;
export const CLIENT_LIST_MAX_PARSE = 5000;

// Key pattern thresholds
export const NO_TTL_WARNING_PERCENT = 50;
export const DEFAULT_SCAN_COUNT = 500;
export const SCAN_BATCH_SIZE = 100;
export const PIPELINE_BATCH_SIZE = 100;
export const TOP_KEYS_COUNT = 20;

// Auto-scaling sample size
export const AUTO_SCALE_PERCENT = 5;
export const AUTO_SCALE_MIN = 200;
export const AUTO_SCALE_MAX = 2000;

// Confidence thresholds (as percentages of total keys)
export const CONFIDENCE_HIGH_PERCENT = 10;
export const CONFIDENCE_MEDIUM_PERCENT = 1;
