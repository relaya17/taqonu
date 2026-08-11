/** Current State slices — center of the Engineering OS. */
export const PROJECT_STATE_SLICES = [
  "CODE",
  "GIT",
  "ARCHITECTURE",
  "DEPENDENCIES",
  "DATABASE",
  "ENVIRONMENT",
  "DEPLOYMENT",
  "TESTS",
  "SECURITY",
  "DECISIONS",
  "TASKS",
  "RISKS",
] as const;

export type ProjectStateSliceKey = (typeof PROJECT_STATE_SLICES)[number];
