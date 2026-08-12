#!/usr/bin/env node
/**
 * Atlas 1.1 Proof golden scenario (ADR-016).
 *
 * Usage:
 *   pnpm proof:run
 *   ATLAS_GOLDEN_PROJECT_ROOT=/path/to/brokerOS-main pnpm proof:run
 *
 * Falls back to fixtures/golden-brokeros when BrokerOS is missing.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAtlasProof, findEvalsRoot } from "./proof-run.js";

const here = dirname(fileURLToPath(import.meta.url));
const report = runAtlasProof({
  evalsRoot: findEvalsRoot(resolve(here, "../../..")),
  envRoot: process.env.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
  projectSlug: process.env.ATLAS_GOLDEN_PROJECT_SLUG ?? "brokeros",
  cwd: resolve(here, "../../.."),
});

const outDir = resolve(here, "../../../atlas-evals/results");
try {
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `proof-${report.id}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
} catch {
  /* optional */
}

console.log(report.plainLanguageSummary);
console.log("");
console.log(report.evidenceReportMarkdown);
console.log("");
for (const g of report.gates) {
  console.log(`Gate ${g.id}: ${g.status} · ${g.taskId}`);
}

const ok = report.status === "PASS" && report.checklist.unauthorizedWritesZero;
process.exit(ok ? 0 : 1);
