import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const [civioRoot, sourceCommit, outputArg] = process.argv.slice(2);

if (!civioRoot || !/^[0-9a-f]{40}$/i.test(sourceCommit ?? "")) {
  throw new Error("Usage: node scripts/snapshot-civio-knowledge.mjs <civio-root> <40-char-commit> [output]");
}

const sourcePath = resolve(civioRoot, "packages/logic/src/rights/database.data.js");
const legalFoundationsPath = resolve(
  civioRoot,
  "packages/logic/dist/housing-agent/legalFoundations.js",
);
const outputPath = resolve(
  outputArg ?? "packages/knowledge/src/fabric/civio-rights.snapshot.ts",
);
const { RIGHTS_ITEMS } = await import(pathToFileURL(sourcePath).href);
const { LEGAL_FOUNDATIONS } = await import(pathToFileURL(legalFoundationsPath).href);

const documents = [...RIGHTS_ITEMS, ...LEGAL_FOUNDATIONS].map((item) => {
  const primarySource = item.sources?.[0] ?? null;
  const excerpt = [
    item.summary,
    item.aiContext,
    item.notes,
    item.steps?.length ? `צעדים: ${item.steps.join(" ")}` : null,
    item.keywords?.length ? `מילות מפתח: ${item.keywords.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const contentHash = createHash("sha256")
    .update(`${item.title}|${excerpt}`)
    .digest("hex")
    .slice(0, 16);

  return {
    id: `civio_${item.id}`,
    title: item.title,
    sourceClass: "REPOSITORY_SOURCE",
    url: primarySource?.url ?? null,
    excerpt,
    sourceUpdatedAt: item.lastReviewedISO ? `${item.lastReviewedISO}T00:00:00.000Z` : null,
    projectScoped: false,
    contentHash,
    allowedAgentIds: ["RESEARCHER", "LEGAL_MEDIA_COMMS"],
  };
});

const header = `// Generated from relaya17/civio@${sourceCommit}. Do not edit by hand.\n`;
const body = `export const CIVIO_RIGHTS_SNAPSHOT = ${JSON.stringify(documents, null, 2)} as const;\n`;
writeFileSync(outputPath, header + body, "utf8");
console.log(`Wrote ${documents.length} Civio knowledge documents to ${outputPath}`);