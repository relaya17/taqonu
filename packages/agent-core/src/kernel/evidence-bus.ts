import { createHash } from "node:crypto";
import {
  evidenceBusEventSchema,
  evidenceBusItemSchema,
  type EvidenceBusEvent,
  type EvidenceBusItem,
  type FabricAgentId,
} from "@atlas/shared";

export class EvidenceBus {
  private readonly events: EvidenceBusEvent[] = [];
  private readonly items = new Map<string, EvidenceBusItem>();

  constructor(readonly traceId: string) {}

  publish(input: {
    type: EvidenceBusEvent["type"];
    taskPlanId?: string | null;
    agentId?: FabricAgentId | null;
    evidence?: EvidenceBusItem[];
    payload?: Record<string, unknown>;
  }): EvidenceBusEvent {
    const evidence = input.evidence ?? [];
    for (const item of evidence) {
      this.items.set(item.id, item);
    }
    const event = evidenceBusEventSchema.parse({
      id: crypto.randomUUID(),
      type: input.type,
      traceId: this.traceId,
      taskPlanId: input.taskPlanId ?? null,
      agentId: input.agentId ?? null,
      evidence,
      payload: input.payload ?? {},
      createdAt: new Date().toISOString(),
    });
    this.events.push(event);
    return event;
  }

  publishClaim(input: {
    claim: string;
    source: string;
    sourceType: EvidenceBusItem["sourceType"];
    authorityScore: number;
    confidence: number;
    agentId: FabricAgentId | null;
    projectId?: string | null;
    supports?: string[];
    sourceUpdatedAt?: string | null;
    epistemicState?: EvidenceBusItem["epistemicState"];
    taskPlanId?: string | null;
  }): EvidenceBusItem {
    const now = new Date().toISOString();
    const contentHash = createHash("sha256")
      .update(`${input.claim}|${input.source}|${now}`)
      .digest("hex")
      .slice(0, 24);

    const insufficient =
      input.authorityScore < 0.2 || input.confidence < 0.25;

    const item = evidenceBusItemSchema.parse({
      id: crypto.randomUUID(),
      claim: input.claim,
      source: input.source,
      sourceType: input.sourceType,
      authorityScore: input.authorityScore,
      retrievedAt: now,
      sourceUpdatedAt: input.sourceUpdatedAt ?? null,
      contentHash,
      confidence: input.confidence,
      supports: input.supports ?? [],
      epistemicState: insufficient
        ? "INSUFFICIENT_EVIDENCE"
        : (input.epistemicState ?? "INFERRED"),
      agentId: input.agentId,
      projectId: input.projectId ?? null,
    });

    this.publish({
      type: insufficient ? "evidence.insufficient" : "evidence.published",
      ...(input.taskPlanId !== undefined
        ? { taskPlanId: input.taskPlanId }
        : {}),
      agentId: input.agentId,
      evidence: [item],
    });
    return item;
  }

  listEvents(): readonly EvidenceBusEvent[] {
    return this.events;
  }

  listItems(): EvidenceBusItem[] {
    return [...this.items.values()];
  }

  hasSufficientEvidence(minAuthority = 0.4, minCount = 1): boolean {
    const ok = this.listItems().filter(
      (i) =>
        i.epistemicState !== "INSUFFICIENT_EVIDENCE" &&
        i.authorityScore >= minAuthority &&
        i.sourceType !== "LLM_INFERENCE",
    );
    return ok.length >= minCount;
  }
}
