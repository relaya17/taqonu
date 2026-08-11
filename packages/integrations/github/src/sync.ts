/** Incremental sync pipeline stages after initial repository scan. */
export const GITHUB_SYNC_STAGES = [
  "repository_metadata",
  "branches",
  "commits",
  "pull_requests",
  "issues",
  "relevant_files",
  "docs",
  "dependency_manifests",
  "ci_configuration",
  "memory_extraction",
] as const;

export type GitHubSyncStage = (typeof GITHUB_SYNC_STAGES)[number];

export const WEBHOOK_INGESTION_FLOW = [
  "validate_signature",
  "persist_webhook_event",
  "queue_job",
  "fetch_changed_resources",
  "update_repository_state",
  "generate_embeddings",
  "extract_engineering_events",
  "update_memory",
] as const;
