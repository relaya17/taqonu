import type { FabricAgentId } from "@atlas/shared";
import {
  MODEL_PRICING_USD_PER_1M_TOKENS,
  getAllModelRollingStats,
  type ModelRollingStats,
} from "../providers/llm.js";

export interface GeniusRoute {
  readonly agentIds: FabricAgentId[];
  readonly modelHint: "cheap" | "strong" | "vision" | "local" | "multi+human";
  readonly hints: string[];
}

export interface GeniusRouteOptions {
  /**
   * Source of rolling per-model cost/latency/error stats used by the
   * cost-aware demotion rule below. Defaults to the live in-memory tracker
   * in `providers/llm.ts` (`getAllModelRollingStats`) — real spend from
   * real completed calls. Tests (or any caller that wants a pure decision
   * with no dependency on process-global state) can inject a fixed
   * snapshot here instead.
   */
  readonly getModelStats?: () => readonly ModelRollingStats[];
}

/**
 * A model id is "cheap" tier if its input price is at or below this
 * threshold (USD per 1M input tokens); anything priced above it, and
 * present in the pricing table, is "strong" tier. Unpriced models (local
 * Ollama, the free ContextEcho provider, or any id missing from
 * `MODEL_PRICING_USD_PER_1M_TOKENS`) are "unknown" tier and excluded from
 * the cost comparison entirely — we only demote based on real, priced
 * spend, never a guess.
 */
const CHEAP_TIER_MAX_INPUT_USD_PER_1M = 1;

/**
 * Cost-aware demotion rule (documented product tradeoff — see task P1):
 *
 *   If the "strong" price tier has at least MIN_SAMPLES_FOR_TREND recent
 *   calls recorded AND EITHER
 *     (a) the "cheap" tier also has at least MIN_SAMPLES_FOR_TREND recent
 *         calls, and strong's rolling average cost-per-call is more than
 *         COST_DEMOTE_MULTIPLIER (3x) cheap's rolling average cost-per-call, OR
 *     (b) strong's rolling error rate exceeds ERROR_RATE_DEMOTE_THRESHOLD
 *         (50% of its last recorded calls failed),
 *   THEN a routing decision that would have picked "strong" is demoted to
 *   "cheap" instead.
 *
 * Rationale: (a) catches genuine cost drift (e.g. a provider price hike,
 * or requests silently growing prompts) once there's enough recent signal
 * to trust it — not on a single expensive call, which could be a one-off
 * long document. (b) catches reliability drift independent of cost: a
 * flaky expensive model is worse than a cheap model that actually answers.
 * This rule intentionally does NOT apply to "multi+human" (security/
 * production-critical routing — risk-driven, not cost-driven, must never
 * be silently downgraded) or to "vision"/"local" (capability
 * requirements, not cost/quality tradeoffs — there is no cheaper
 * substitute that still sees the image or stays on-box).
 */
const COST_DEMOTE_MULTIPLIER = 3;
const MIN_SAMPLES_FOR_TREND = 3;
const ERROR_RATE_DEMOTE_THRESHOLD = 0.5;

function classifyPriceTier(model: string): "cheap" | "strong" | "unknown" {
  const rate = MODEL_PRICING_USD_PER_1M_TOKENS[model];
  if (!rate) return "unknown";
  return rate.input <= CHEAP_TIER_MAX_INPUT_USD_PER_1M ? "cheap" : "strong";
}

interface TierAggregate {
  readonly sampleSize: number;
  readonly avgCostUsd: number;
  readonly errorRate: number;
}

function aggregateTier(
  stats: readonly ModelRollingStats[],
  tier: "cheap" | "strong",
): TierAggregate {
  const matching = stats.filter((s) => classifyPriceTier(s.model) === tier);
  const sampleSize = matching.reduce((sum, s) => sum + s.sampleSize, 0);
  if (sampleSize === 0) {
    return { sampleSize: 0, avgCostUsd: 0, errorRate: 0 };
  }
  const avgCostUsd =
    matching.reduce((sum, s) => sum + s.avgCostUsd * s.sampleSize, 0) / sampleSize;
  const errorRate =
    matching.reduce((sum, s) => sum + s.errorRate * s.sampleSize, 0) / sampleSize;
  return { sampleSize, avgCostUsd, errorRate };
}

/** Returns a demotion explanation hint if the strong tier should be demoted, else undefined. */
function strongTierDemotionReason(
  getModelStats: () => readonly ModelRollingStats[],
): string | undefined {
  const stats = getModelStats();
  const strong = aggregateTier(stats, "strong");
  if (strong.sampleSize < MIN_SAMPLES_FOR_TREND) {
    return undefined;
  }

  const cheap = aggregateTier(stats, "cheap");
  if (
    cheap.sampleSize >= MIN_SAMPLES_FOR_TREND &&
    cheap.avgCostUsd > 0 &&
    strong.avgCostUsd > COST_DEMOTE_MULTIPLIER * cheap.avgCostUsd
  ) {
    return `Cost-aware demotion: strong-tier avg cost/call ($${strong.avgCostUsd.toFixed(4)}) is over ${COST_DEMOTE_MULTIPLIER}x cheap-tier avg ($${cheap.avgCostUsd.toFixed(4)}) across the last ${strong.sampleSize} strong-tier calls → falling back to cheap`;
  }

  if (strong.errorRate > ERROR_RATE_DEMOTE_THRESHOLD) {
    return `Cost-aware demotion: strong-tier error rate ${(strong.errorRate * 100).toFixed(0)}% over the last ${strong.sampleSize} calls exceeds ${ERROR_RATE_DEMOTE_THRESHOLD * 100}% → falling back to cheap`;
  }

  return undefined;
}

/** Route by task fit — not “best LLM”. */
export function geniusRoute(request: string, options?: GeniusRouteOptions): GeniusRoute {
  const q = request.toLowerCase();
  const hints: string[] = [];
  const agents = new Set<FabricAgentId>(["ORCHESTRATOR"]);

  const add = (id: FabricAgentId, hint: string) => {
    agents.add(id);
    hints.push(hint);
  };

  if (/secur|auth|secret|inject|rls|cve|owasp/.test(q)) {
    add("SECURITY", "Security-critical → specialist + judge");
  }
  if (/a11y|accessib|wcag|screen reader|rtl|contrast/.test(q)) {
    add("ACCESSIBILITY", "Accessibility surface");
  }
  if (/ui|ux|flow|usability|responsive|design/.test(q)) {
    add("UI_UX", "UI/UX review");
  }
  if (/test|qa|regression|coverage|e2e/.test(q)) {
    add("QA", "QA strategy");
    add("TEST_ENGINEER", "Test authorship");
  }
  if (/bug|crash|stack|repro|debug|error|fail/.test(q)) {
    add("DEBUGGER", "Debugger path");
  }
  if (/architect|module|dependenc|refactor|debt|scalab/.test(q)) {
    add("ARCHITECT", "Architecture analysis");
  }
  if (/deploy|ci|cd|docker|vercel|migrat|backup|observ/.test(q)) {
    add("DEVOPS", "DevOps / infra");
  }
  if (
    /legal|lawyer|counsel|משפט|עו״ד|עורך\s*דין|media\s*law|תקשורת|מדיה|defamation|שידור|broadcast|gdpr|פרטיות\s*חוק|محام|قانون/.test(
      q,
    )
  ) {
    add("LEGAL_MEDIA_COMMS", "Legal media/comms counsel-prep IL/US/EU (not a lawyer)");
    add("RESEARCHER", "Verified gov/university sources only");
    add("JUDGE", "Legal claims need belief gate");
  }
  if (/research|docs|standard|api spec|advisory|how does/.test(q)) {
    add("RESEARCHER", "External research package");
  }
  if (
    /omission|forgot|missing|constitution|checklist|what.?did.?we.?miss|שכחנו|חסר/.test(
      q,
    )
  ) {
    add("OMISSION_DETECTOR", "Omission Detector — what nobody asked for");
  }
  if (
    /build|תבנה|create app|new (site|app|system)|booking|הזמנות|payments?|saas/.test(
      q,
    )
  ) {
    add("OMISSION_DETECTOR", "Build intent → Constitution omissions");
    add("ARCHITECT", "Build intent → architecture baseline");
    add("SECURITY", "Build intent → security baseline");
  }
  if (/fix|patch|implement|code|generat|migrat/.test(q)) {
    add("CODE_ENGINEER", "Code change via Patch Artifact");
  }

  // Always finish with Judge for multi-specialist or high-risk intents
  if (agents.size > 2 || agents.has("SECURITY") || agents.has("CODE_ENGINEER")) {
    add("JUDGE", "Judge required for belief decision");
  }

  let modelHint: GeniusRoute["modelHint"] = "cheap";
  if (agents.has("SECURITY") || /production|critical|release/.test(q)) {
    modelHint = "multi+human";
    hints.push("Critical path → multi-agent + human escalation ready");
  } else if (agents.has("ARCHITECT") || agents.has("DEBUGGER")) {
    modelHint = "strong";
  } else if (/image|screenshot|visual|figma/.test(q)) {
    modelHint = "vision";
  } else if (/confidential|local only|air.?gap/.test(q)) {
    modelHint = "local";
  }

  if (modelHint === "strong") {
    const getModelStats = options?.getModelStats ?? getAllModelRollingStats;
    const demotionReason = strongTierDemotionReason(getModelStats);
    if (demotionReason) {
      modelHint = "cheap";
      hints.push(demotionReason);
    }
  }

  if (agents.size === 1) {
    add("QA", "Default: at least one specialist beyond orchestrator");
  }

  return {
    agentIds: [...agents],
    modelHint,
    hints,
  };
}
