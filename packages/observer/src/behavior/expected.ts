import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  genomeFlowSchema,
  type BehaviorDifference,
  type GenomeFlow,
} from "@atlas/shared";
import { z } from "zod";
import { atlasObserverPaths } from "../paths.js";
import { diffFlows } from "./diff.js";

const expectedModelSchema = z.object({
  version: z.literal(1),
  promotedAt: z.string().datetime(),
  source: z.enum(["baseline", "manual", "promote"]),
  flows: z.array(genomeFlowSchema).max(200),
});

export type ExpectedBehaviorModel = z.infer<typeof expectedModelSchema>;

export function loadExpectedBehavior(
  workspaceRoot: string,
): ExpectedBehaviorModel | null {
  const { genomeExpected } = atlasObserverPaths(workspaceRoot);
  if (!existsSync(genomeExpected)) return null;
  try {
    return expectedModelSchema.parse(
      JSON.parse(readFileSync(genomeExpected, "utf8")),
    );
  } catch {
    return null;
  }
}

export function saveExpectedBehavior(
  workspaceRoot: string,
  model: ExpectedBehaviorModel,
): string {
  const { genomeExpected } = atlasObserverPaths(workspaceRoot);
  mkdirSync(dirname(genomeExpected), { recursive: true });
  writeFileSync(genomeExpected, JSON.stringify(model, null, 2), "utf8");
  return genomeExpected;
}

/** First observation becomes EXPECTED baseline when none exists. */
export function ensureExpectedBaseline(
  workspaceRoot: string,
  observedFlows: readonly GenomeFlow[],
): ExpectedBehaviorModel {
  const existing = loadExpectedBehavior(workspaceRoot);
  if (existing) return existing;
  const model = expectedModelSchema.parse({
    version: 1,
    promotedAt: new Date().toISOString(),
    source: "baseline",
    flows: observedFlows,
  });
  saveExpectedBehavior(workspaceRoot, model);
  return model;
}

export function promoteObservedToExpected(
  workspaceRoot: string,
  observedFlows: readonly GenomeFlow[],
): ExpectedBehaviorModel {
  const model = expectedModelSchema.parse({
    version: 1,
    promotedAt: new Date().toISOString(),
    source: "promote",
    flows: observedFlows,
  });
  saveExpectedBehavior(workspaceRoot, model);
  return model;
}

/** EXPECTED vs OBSERVED — killer behavioral verification. */
export function verifyAgainstExpected(
  expected: ExpectedBehaviorModel | null,
  observed: readonly GenomeFlow[],
): BehaviorDifference[] {
  if (!expected) return [];
  return diffFlows(expected.flows, observed);
}
