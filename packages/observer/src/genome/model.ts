import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  projectGenomeSchema,
  type GenomeFlow,
  type ProjectGenome,
} from "@atlas/shared";
import { analyzeRepository, readTextFile } from "@atlas/code-intelligence";
import { atlasObserverPaths } from "../paths.js";

const FLOW_HEADER =
  /@atlas-flow\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i;

function slugStep(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/** Parse annotated flows from source text (`@atlas-flow` / `@atlas-step`). */
export function parseAnnotatedFlows(
  text: string,
  sourceFile: string | null,
): GenomeFlow[] {
  const lines = text.split(/\r?\n/);
  const flows: GenomeFlow[] = [];
  let current: GenomeFlow | null = null;

  for (const line of lines) {
    const header = line.match(FLOW_HEADER);
    if (header) {
      if (current && current.steps.length > 0) flows.push(current);
      const method = (header[1] ?? "POST").toUpperCase();
      const path = header[2] ?? "/";
      current = {
        id: `${method} ${path}`,
        method,
        path,
        steps: [],
        sourceFile,
      };
      continue;
    }
    if (!current) continue;
    const stepMatch = /@atlas-step\s+(.+)$/i.exec(line);
    if (stepMatch?.[1]) {
      const label = stepMatch[1].trim();
      current.steps.push({ id: slugStep(label), label });
    }
  }
  if (current && current.steps.length > 0) flows.push(current);
  return flows;
}

/** Heuristic: payment/confirm call order inside a handler-ish file. */
export function inferPaymentConfirmFlows(
  text: string,
  sourceFile: string,
): GenomeFlow[] {
  const lower = text.toLowerCase();
  const hasPayment = /charge|payment|stripe|billing/.test(lower);
  const hasConfirm = /confirm|confirmation|receipt|notify|email\.send|sendconfirmation/.test(
    lower,
  );
  if (!hasPayment || !hasConfirm) return [];

  const paymentIdx = lower.search(/charge|payment|stripe\.|createpayment/);
  const confirmIdx = lower.search(
    /sendconfirmation|confirmation|sendemail|notify|receipt/,
  );
  if (paymentIdx < 0 || confirmIdx < 0) return [];

  const steps =
    paymentIdx < confirmIdx
      ? [
          { id: "validate-guest", label: "validate guest" },
          { id: "create-booking", label: "create booking" },
          { id: "charge-payment", label: "charge payment" },
          { id: "send-confirmation", label: "send confirmation" },
        ]
      : [
          { id: "validate-guest", label: "validate guest" },
          { id: "create-booking", label: "create booking" },
          { id: "send-confirmation", label: "send confirmation" },
          { id: "charge-payment", label: "charge payment" },
        ];

  const pathMatch = text.match(/["'`](\/api\/[a-z0-9/_-]+)["'`]/i);
  const path = pathMatch?.[1] ?? "/api/unknown";
  return [
    {
      id: `POST ${path}`,
      method: "POST",
      path,
      steps,
      sourceFile,
    },
  ];
}

function readPackageNames(root: string): string[] {
  try {
    const raw = readTextFile(root, "package.json");
    if (!raw) return [];
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ].slice(0, 300);
  } catch {
    return [];
  }
}

export function buildProjectGenome(input: {
  workspaceRoot: string;
  projectId?: string | null;
  projectSlug?: string | null;
  flows?: readonly GenomeFlow[];
  capturedAt?: string;
}): ProjectGenome {
  const analysis = analyzeRepository(input.workspaceRoot);
  const annotated: GenomeFlow[] = [];

  if (input.flows?.length) {
    annotated.push(...input.flows);
  } else {
    for (const file of analysis.sampleFiles.slice(0, 60)) {
      const text = readTextFile(input.workspaceRoot, file);
      if (!text) continue;
      const parsed = parseAnnotatedFlows(text, file);
      if (parsed.length > 0) {
        annotated.push(...parsed);
      } else {
        annotated.push(...inferPaymentConfirmFlows(text, file));
      }
    }
  }

  const byId = new Map<string, GenomeFlow>();
  for (const flow of annotated) {
    byId.set(flow.id, flow);
  }

  return projectGenomeSchema.parse({
    version: 1,
    projectId: input.projectId ?? null,
    projectSlug: input.projectSlug ?? null,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    workspaceRoot: input.workspaceRoot,
    architecture: {
      apps: analysis.apps,
      packages: analysis.packages,
      topLevel: analysis.topLevel,
      fileCount: analysis.fileCount,
    },
    apis: [...byId.values()],
    services: analysis.apps,
    dependencies: readPackageNames(input.workspaceRoot),
    knownBehaviorIds: [...byId.keys()],
  });
}

export function loadGenome(workspaceRoot: string): ProjectGenome | null {
  const { genomeCurrent } = atlasObserverPaths(workspaceRoot);
  if (!existsSync(genomeCurrent)) return null;
  try {
    const raw = JSON.parse(readFileSync(genomeCurrent, "utf8")) as unknown;
    return projectGenomeSchema.parse(raw);
  } catch {
    return null;
  }
}

export function saveGenome(genome: ProjectGenome): string {
  const paths = atlasObserverPaths(genome.workspaceRoot);
  mkdirSync(dirname(paths.genomeCurrent), { recursive: true });
  writeFileSync(paths.genomeCurrent, JSON.stringify(genome, null, 2), "utf8");
  return paths.genomeCurrent;
}

export function saveGenomeSnapshot(genome: ProjectGenome): string {
  const paths = atlasObserverPaths(genome.workspaceRoot);
  mkdirSync(paths.snapshots, { recursive: true });
  const stamp = genome.capturedAt.replace(/[:.]/g, "-");
  const file = `${paths.snapshots}/${stamp}.json`;
  writeFileSync(file, JSON.stringify(genome, null, 2), "utf8");
  return file;
}
