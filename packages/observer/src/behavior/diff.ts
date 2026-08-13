import type {
  BehaviorDifference,
  GenomeFlow,
  ObserverClaimKind,
  BugSeverity,
} from "@atlas/shared";

const PAYMENT = /charge|payment|billing|stripe/i;
const CONFIRM = /confirm|confirmation|receipt|notify/i;

function stepLabels(flow: GenomeFlow): string[] {
  return flow.steps.map((s) => s.label);
}

function riskForOrderRegression(): {
  claim: ObserverClaimKind;
  riskBand: BugSeverity;
  title: string;
  detail: string;
} {
  return {
    claim: "INFERRED",
    riskBand: "HIGH",
    title: "Behavioral regression: payment ordering",
    detail:
      "Payment/charge moved relative to confirmation/notify. Compiler and unit tests may still pass — customer may receive confirmation before a successful charge.",
  };
}

function isPaymentAfterConfirm(labels: string[]): boolean {
  const payIdx = labels.findIndex((l) => PAYMENT.test(l));
  const confIdx = labels.findIndex((l) => CONFIRM.test(l));
  if (payIdx < 0 || confIdx < 0) return false;
  return payIdx > confIdx;
}

export function diffFlows(
  before: readonly GenomeFlow[],
  after: readonly GenomeFlow[],
): BehaviorDifference[] {
  const beforeMap = new Map(before.map((f) => [f.id, f]));
  const afterMap = new Map(after.map((f) => [f.id, f]));
  const diffs: BehaviorDifference[] = [];

  for (const [id, prev] of beforeMap) {
    const next = afterMap.get(id);
    if (!next) {
      diffs.push({
        flowId: id,
        method: prev.method,
        path: prev.path,
        beforeSteps: stepLabels(prev),
        afterSteps: [],
        kind: "FLOW_REMOVED",
        title: `Flow removed: ${id}`,
        detail: "A previously observed API flow is no longer present in the genome.",
        claim: "OBSERVED",
        riskBand: "MEDIUM",
      });
      continue;
    }

    const beforeSteps = stepLabels(prev);
    const afterSteps = stepLabels(next);
    const beforeKey = beforeSteps.join(">");
    const afterKey = afterSteps.join(">");
    if (beforeKey === afterKey) continue;

    const beforeSet = new Set(beforeSteps);
    const afterSet = new Set(afterSteps);
    const added = afterSteps.filter((s) => !beforeSet.has(s));
    const removed = beforeSteps.filter((s) => !afterSet.has(s));

    let kind: BehaviorDifference["kind"] = "STEP_ORDER_CHANGED";
    if (added.length && !removed.length && beforeSteps.length < afterSteps.length) {
      kind = "STEP_ADDED";
    } else if (removed.length && !added.length) {
      kind = "STEP_REMOVED";
    }

    const paymentRegression =
      isPaymentAfterConfirm(afterSteps) && !isPaymentAfterConfirm(beforeSteps);
    const meta = paymentRegression
      ? riskForOrderRegression()
      : {
          claim: "OBSERVED" as const,
          riskBand: "MEDIUM" as const,
          title: `Behavior changed: ${id}`,
          detail: `Step sequence changed from [${beforeSteps.join(" → ")}] to [${afterSteps.join(" → ")}].`,
        };

    diffs.push({
      flowId: id,
      method: next.method,
      path: next.path,
      beforeSteps,
      afterSteps,
      kind,
      title: meta.title,
      detail: meta.detail,
      claim: meta.claim,
      riskBand: meta.riskBand,
    });
  }

  for (const [id, next] of afterMap) {
    if (beforeMap.has(id)) continue;
    diffs.push({
      flowId: id,
      method: next.method,
      path: next.path,
      beforeSteps: [],
      afterSteps: stepLabels(next),
      kind: "FLOW_ADDED",
      title: `Flow added: ${id}`,
      detail: "New API flow observed in the genome.",
      claim: "OBSERVED",
      riskBand: "LOW",
    });
  }

  return diffs;
}
