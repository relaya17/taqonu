import { readTextFile, analyzeRepository } from "@atlas/code-intelligence";

export interface ProductionSignal {
  id: string;
  title: string;
  detail: string;
  present: boolean;
  claim: "OBSERVED" | "INFERRED" | "UNKNOWN";
}

/** Repo-level production intelligence seed (not live APM yet). */
export function detectProductionSignals(workspaceRoot: string): ProductionSignal[] {
  const analysis = analyzeRepository(workspaceRoot);
  const sample = analysis.sampleFiles.slice(0, 80);
  let logging = false;
  let tracing = false;
  let metrics = false;
  let health = false;
  let deployConfig = false;

  for (const rel of sample) {
    const text = readTextFile(workspaceRoot, rel);
    if (!text) continue;
    const lower = text.toLowerCase();
    if (/pino|winston|structured.?log|logger\./i.test(text)) logging = true;
    if (/opentelemetry|@opentelemetry|startspan|dd-trace|sentry/i.test(text)) {
      tracing = true;
    }
    if (/prometheus|statsd|meter\.|metrics\.|\/metrics/i.test(text)) metrics = true;
    if (/\/health|healthz|readiness|liveness/i.test(text)) health = true;
    if (
      /vercel\.json|render\.yaml|dockerfile|fly\.toml|kubernetes|\.github\/workflows/i.test(
        rel,
      ) ||
      /vercel\.json|render\.yaml|dockerfile/i.test(lower)
    ) {
      deployConfig = true;
    }
  }

  // Also check top-level names
  for (const name of analysis.topLevel) {
    if (/dockerfile|vercel\.json|render\.yaml|fly\.toml/i.test(name)) {
      deployConfig = true;
    }
  }

  return [
    {
      id: "prod-logging",
      title: "Structured logging",
      detail: logging
        ? "Logging/observability libraries detected in repo."
        : "No structured logger signal found.",
      present: logging,
      claim: logging ? "OBSERVED" : "UNKNOWN",
    },
    {
      id: "prod-tracing",
      title: "Distributed tracing",
      detail: tracing
        ? "OTel/Sentry/Datadog-style tracing signal detected."
        : "No tracing instrumentation signal found.",
      present: tracing,
      claim: tracing ? "OBSERVED" : "UNKNOWN",
    },
    {
      id: "prod-metrics",
      title: "Metrics endpoint/instrumentation",
      detail: metrics
        ? "Metrics instrumentation or /metrics path detected."
        : "No metrics signal found.",
      present: metrics,
      claim: metrics ? "OBSERVED" : "UNKNOWN",
    },
    {
      id: "prod-health",
      title: "Health/readiness probes",
      detail: health
        ? "Health/readiness route signal detected."
        : "No health probe signal found.",
      present: health,
      claim: health ? "OBSERVED" : "UNKNOWN",
    },
    {
      id: "prod-deploy",
      title: "Deploy configuration",
      detail: deployConfig
        ? "Deploy config (Vercel/Render/Docker/K8s/CI) detected."
        : "No deploy config signal found.",
      present: deployConfig,
      claim: deployConfig ? "OBSERVED" : "UNKNOWN",
    },
  ];
}
