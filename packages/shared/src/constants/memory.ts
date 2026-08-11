export const MEMORY_TYPES = [
  "FACT",
  "DECISION",
  "PREFERENCE",
  "EVENT",
  "LESSON",
  "TASK",
  "GOAL",
  "ARCHITECTURE",
  "BUG",
  "SOLUTION",
  "PROJECT_STATE",
  "EXTERNAL_KNOWLEDGE",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_STATUSES = [
  "ACTIVE",
  "SUPERSEDED",
  "ARCHIVED",
  "INVALIDATED",
] as const;

export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const OBSERVATION_MODES = ["OBSERVED", "INFERRED", "CONFIRMED"] as const;

export type ObservationMode = (typeof OBSERVATION_MODES)[number];
