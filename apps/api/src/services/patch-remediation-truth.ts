import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  findingRemediationVerdictSchema,
  patchRemediationTargetSchema,
  type FindingRemediationVerdict,
  type PatchRemediationTarget,
  type RemediationFindingType,
} from "@atlas/shared";
import type { ProposedFileChange } from "@atlas/code-intelligence";
import {
  commentOnlySecretChange,
  evaluateSecretRemediation,
  proposeSecretLiteralRemoval,
} from "@atlas/observer";

function canonicalFindingId(raw: string, rest: string): string {
  if (raw.startsWith("sentinel:")) return raw;
  if (rest.startsWith("secret:")) return `sentinel:${raw}`;
  return raw;
}

/** Bind a Patch to the Finding it intends to remediate. Does not invent findings. */
export function parsePatchRemediationTarget(input: {
  readonly findingId?: string | null;
  readonly projectId?: string | null;
  readonly focusPath?: string | null;
  readonly riskBand?: string | null;
}): PatchRemediationTarget | null {
  const raw = input.findingId?.trim();
  if (!raw) return null;
  let rest = raw;
  while (rest.startsWith("sentinel:")) rest = rest.slice("sentinel:".length);

  let findingType: RemediationFindingType = "observer";
  let detector = "observer";
  let path: string | null = input.focusPath?.replace(/\\/g, "/") ?? null;
  let line: number | null = null;

  if (rest.startsWith("secret:")) {
    findingType = "sentinel-secret";
    detector = "sentinel-secrets";
    const body = rest.slice("secret:".length);
    const lastColon = body.lastIndexOf(":");
    const prevColon = lastColon > 0 ? body.lastIndexOf(":", lastColon - 1) : -1;
    if (prevColon >= 0) {
      path = body.slice(0, prevColon).replace(/\\/g, "/");
      const kind = body.slice(prevColon + 1, lastColon);
      detector = kind || detector;
      const parsed = Number.parseInt(body.slice(lastColon + 1), 10);
      line = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
  } else if (rest.length > 0) {
    findingType = "sentinel-other";
    detector = "sentinel";
  }

  return patchRemediationTargetSchema.parse({
    findingId: canonicalFindingId(raw, rest),
    projectId: input.projectId ?? null,
    findingType,
    detector,
    path,
    line,
    originalRiskBand: input.riskBand ?? "CRITICAL",
  });
}

export function executionOnlyRemediationVerdict(): FindingRemediationVerdict {
  return findingRemediationVerdictSchema.parse({
    result: "NOT_ATTEMPTED",
    verifyStatus: "NOT_RUN",
    findingPresence: "UNKNOWN",
    findingId: null,
    path: null,
    summary:
      "Patch is not bound to a finding. PATCH_VERIFY is independent of finding remediation.",
  });
}

export function evaluateFindingRemediation(input: {
  readonly workspaceRoot: string;
  readonly target?: PatchRemediationTarget | undefined;
  readonly executionOk: boolean;
}): FindingRemediationVerdict {
  if (!input.target) return executionOnlyRemediationVerdict();
  if (input.target.findingType === "sentinel-secret") {
    return evaluateSecretRemediation({
      workspaceRoot: input.workspaceRoot,
      target: input.target,
      executionOk: input.executionOk,
    });
  }
  return findingRemediationVerdictSchema.parse({
    result: "NOT_ATTEMPTED",
    verifyStatus: "NOT_RUN",
    findingPresence: "UNKNOWN",
    findingId: input.target.findingId,
    path: input.target.path,
    summary: `No finding-remediation detector for type ${input.target.findingType}. PATCH_VERIFY PASS does not imply the finding is gone.`,
  });
}

export function applySecretRemediationToProposal(input: {
  readonly workspaceRoot: string;
  readonly filesChanged: ProposedFileChange[];
  readonly target: PatchRemediationTarget | null;
  readonly mode: string;
  readonly focusPath?: string | null;
}): {
  readonly filesChanged: ProposedFileChange[];
  readonly unsupported: FindingRemediationVerdict | null;
} {
  const rel = (input.target?.path ?? input.focusPath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  const isSecretIntent =
    input.target?.findingType === "sentinel-secret" ||
    (input.mode === "secure" && rel.length > 0);
  if (!isSecretIntent || !rel || rel.includes("..")) {
    return rejectCommentOnlyIfSecret({
      workspaceRoot: input.workspaceRoot,
      filesChanged: input.filesChanged,
      target: input.target,
      mode: input.mode,
    });
  }

  const full = join(resolve(input.workspaceRoot), rel);
  if (!existsSync(full)) {
    return {
      filesChanged: [],
      unsupported: findingRemediationVerdictSchema.parse({
        result: "UNSUPPORTED",
        verifyStatus: "UNSUPPORTED",
        findingPresence: "UNKNOWN",
        findingId: input.target?.findingId ?? null,
        path: rel,
        summary:
          "REMEDIATION_UNSUPPORTED — secret finding has no readable file to transform.",
      }),
    };
  }

  let previous: string;
  try {
    previous = readFileSync(full, "utf8");
  } catch {
    return {
      filesChanged: [],
      unsupported: findingRemediationVerdictSchema.parse({
        result: "UNSUPPORTED",
        verifyStatus: "UNSUPPORTED",
        findingPresence: "UNKNOWN",
        findingId: input.target?.findingId ?? null,
        path: rel,
        summary: `REMEDIATION_UNSUPPORTED — could not read ${rel} for a safe secret rewrite.`,
      }),
    };
  }

  const proposed = proposeSecretLiteralRemoval(rel, previous);
  if (proposed.status === "NOT_NEEDED") {
    return { filesChanged: input.filesChanged, unsupported: null };
  }
  if (proposed.status === "UNSUPPORTED") {
    return {
      filesChanged: [],
      unsupported: findingRemediationVerdictSchema.parse({
        result: "UNSUPPORTED",
        verifyStatus: "UNSUPPORTED",
        findingPresence: "STILL_PRESENT",
        findingId: input.target?.findingId ?? null,
        path: rel,
        summary: `REMEDIATION_UNSUPPORTED — ${proposed.reason} An ATLAS-PATCH comment is not secret remediation.`,
      }),
    };
  }

  return {
    filesChanged: [
      {
        path: rel,
        action: "modify",
        summary:
          "Replace quoted secret literal with env read. Detector must be silent after apply.",
        afterContent: proposed.afterContent,
        previousContent: previous,
        unifiedDiff: proposed.unifiedDiff,
      },
    ],
    unsupported: null,
  };
}

function rejectCommentOnlyIfSecret(input: {
  readonly workspaceRoot: string;
  readonly filesChanged: ProposedFileChange[];
  readonly target: PatchRemediationTarget | null;
  readonly mode: string;
}): {
  readonly filesChanged: ProposedFileChange[];
  readonly unsupported: FindingRemediationVerdict | null;
} {
  if (input.mode !== "secure" && input.target?.findingType !== "sentinel-secret") {
    return { filesChanged: input.filesChanged, unsupported: null };
  }
  const root = resolve(input.workspaceRoot);
  for (const file of input.filesChanged) {
    if (!file.afterContent) continue;
    const full = join(root, file.path);
    let previous = file.previousContent ?? null;
    if (previous === null && existsSync(full)) {
      try {
        previous = readFileSync(full, "utf8");
      } catch {
        previous = null;
      }
    }
    if (previous === null) continue;
    if (commentOnlySecretChange(previous, file.afterContent)) {
      return {
        filesChanged: [],
        unsupported: findingRemediationVerdictSchema.parse({
          result: "UNSUPPORTED",
          verifyStatus: "UNSUPPORTED",
          findingPresence: "STILL_PRESENT",
          findingId: input.target?.findingId ?? null,
          path: file.path,
          summary:
            "REMEDIATION_UNSUPPORTED — ATLAS-PATCH comments are not secret remediation. Finding remains STILL_PRESENT.",
        }),
      };
    }
  }
  return { filesChanged: input.filesChanged, unsupported: null };
}
