import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  compareSourceAuthority,
  conflictListItemSchema,
  resolveConflictSchema,
  uuidSchema,
  type SourceAuthorityRank,
} from "@atlas/shared";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";

function claimAuthority(rank: string | undefined): SourceAuthorityRank {
  const allowed = [
    "LIVE_PRODUCTION",
    "AUTOMATED_VERIFIED_TEST",
    "STAGING_OBSERVATION",
    "CI_ARTIFACT",
    "REPOSITORY_CODE",
    "ARCHITECTURE_DOCUMENT",
    "DEVELOPER_STATEMENT",
    "LLM_INFERENCE",
  ] as const;
  if (rank && (allowed as readonly string[]).includes(rank)) {
    return rank as SourceAuthorityRank;
  }
  return "DEVELOPER_STATEMENT";
}

export async function registerConflictRoutes(app: FastifyInstance): Promise<void> {
  osStore.ensureLoaded();

  app.get("/api/v1/conflicts", async () => {
    const items = [];
    for (const project of osStore.listProjects()) {
      const snapshot = osStore.getSnapshot(project.id);
      if (!snapshot) continue;
      for (const conflict of snapshot.conflicts) {
        const resolution =
          osStore.getConflictResolution(conflict.id) ?? conflict.resolution;
        const claimA = osStore
          .getClaims(project.id)
          .find((c) => c.id === conflict.claimAId);
        const claimB = osStore
          .getClaims(project.id)
          .find((c) => c.id === conflict.claimBId);
        let authoritySuggestion: string | null = null;
        if (claimA && claimB) {
          const cmp = compareSourceAuthority(
            claimAuthority(claimA.authorityRank),
            claimAuthority(claimB.authorityRank),
          );
          if (cmp < 0) {
            authoritySuggestion = `Prefer claimA (${claimA.authorityRank}) over claimB (${claimB.authorityRank})`;
          } else if (cmp > 0) {
            authoritySuggestion = `Prefer claimB (${claimB.authorityRank}) over claimA (${claimA.authorityRank})`;
          } else {
            authoritySuggestion =
              "Equal authority — use freshness / reproducibility";
          }
        }
        items.push(
          conflictListItemSchema.parse({
            id: conflict.id,
            projectId: project.id,
            projectName: project.name,
            sliceKey: conflict.sliceKey,
            resolution,
            detectedAt: conflict.detectedAt,
            epistemicState: "CONFLICTED",
            resolved: Boolean(resolution),
          }),
        );
        // attach suggestion outside schema for UI via parallel field in response items
        (items[items.length - 1] as { authoritySuggestion?: string | null }).authoritySuggestion =
          authoritySuggestion;
      }
    }
    return {
      items,
      total: items.length,
      open: items.filter((i) => !i.resolved).length,
    };
  });

  app.post("/api/v1/conflicts/:id/suggest", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    for (const project of osStore.listProjects()) {
      const snapshot = osStore.getSnapshot(project.id);
      if (!snapshot) continue;
      const conflict = snapshot.conflicts.find((c) => c.id === params.id);
      if (!conflict) continue;
      const claimA = osStore
        .getClaims(project.id)
        .find((c) => c.id === conflict.claimAId);
      const claimB = osStore
        .getClaims(project.id)
        .find((c) => c.id === conflict.claimBId);
      if (!claimA || !claimB) {
        throw new AtlasError("NOT_FOUND", "Conflict claims missing");
      }
      const cmp = compareSourceAuthority(
        claimAuthority(claimA.authorityRank),
        claimAuthority(claimB.authorityRank),
      );
      const winner = cmp <= 0 ? claimA : claimB;
      const loser = winner.id === claimA.id ? claimB : claimA;
      return {
        conflictId: conflict.id,
        method: "authority",
        winnerClaimId: winner.id,
        loserClaimId: loser.id,
        winnerAuthority: claimAuthority(winner.authorityRank),
        loserAuthority: claimAuthority(loser.authorityRank),
        suggestedResolution: `Resolved by Source Authority: keep "${winner.statement}" (${claimAuthority(winner.authorityRank)}); mark opposing claim CONTRADICTED.`,
      };
    }
    throw new AtlasError("NOT_FOUND", "Conflict not found");
  });

  app.post("/api/v1/conflicts/:id/resolve", async (request, reply) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const body = resolveConflictSchema.parse(request.body);

    let foundProjectId: string | null = null;
    let claimAId: string | null = null;
    let claimBId: string | null = null;
    for (const project of osStore.listProjects()) {
      const snapshot = osStore.getSnapshot(project.id);
      if (!snapshot) continue;
      const conflict = snapshot.conflicts.find((c) => c.id === params.id);
      if (conflict) {
        foundProjectId = project.id;
        claimAId = conflict.claimAId;
        claimBId = conflict.claimBId;
        break;
      }
    }
    if (!foundProjectId) {
      throw new AtlasError("NOT_FOUND", "Conflict not found");
    }

    let resolution = body.resolution;
    let winnerClaimId = body.winnerClaimId ?? null;
    if (body.method === "authority" && claimAId && claimBId) {
      const claimA = osStore.getClaims(foundProjectId).find((c) => c.id === claimAId);
      const claimB = osStore.getClaims(foundProjectId).find((c) => c.id === claimBId);
      if (claimA && claimB) {
        const cmp = compareSourceAuthority(
          claimAuthority(claimA.authorityRank),
          claimAuthority(claimB.authorityRank),
        );
        const winner = cmp <= 0 ? claimA : claimB;
        winnerClaimId = winner.id;
        resolution = `authority:${winner.id} — ${resolution}`;
      }
    }

    osStore.setConflictResolution(params.id, resolution);
    appendDomainEvent({
      type: "resolution.recorded",
      projectId: foundProjectId,
      epistemicState: "OBSERVED",
      payload: {
        conflictId: params.id,
        method: body.method,
        winnerClaimId,
        resolution,
      },
    });
    osStore.appendAudit({
      type: "conflict.resolved",
      conflictId: params.id,
      resolution,
      method: body.method,
      winnerClaimId,
      at: new Date().toISOString(),
    });

    return reply.status(200).send({
      id: params.id,
      resolution,
      method: body.method,
      winnerClaimId,
      resolved: true,
    });
  });
}
