/**
 * Heuristic detector for likely prompt-injection attempts inside text that
 * will be interpolated into an LLM call as untrusted/external content — a
 * GitHub issue body, a fetched README, web-research results, an ingested
 * memory record, or anything else that originated outside our own system
 * prompts and tool output. It is modeled directly on `../secrets/detector.ts`
 * (`detectSecrets` / `assertNoSecrets`): a flat list of `{name, pattern}`
 * regexes, a pure `detect*` function that returns every match, and an
 * `assert*` wrapper that throws for callers who want a hard fail rather
 * than a signal to route around.
 *
 * Three things to understand before using this module:
 *
 *   1. This is defense-in-depth, not THE defense. Regex matching over raw
 *      text can only catch injection attempts that resemble known phrasing.
 *      A sufficiently novel, paraphrased, translated, or otherwise obfuscated
 *      injection will evade every pattern here — that is expected, not a
 *      bug to chase by adding ever-more-specific regexes. Treat this the
 *      same way `detectSecrets` treats secret-shaped strings: a cheap,
 *      fast, zero-dependency first-pass signal, not a proof of safety.
 *
 *   2. The real structural defense lives elsewhere in this Phase 0 hardening
 *      round: the central dispatcher's untrusted-content risk floor (which
 *      forces any request touching external/untrusted content down to a
 *      conservative trust tier regardless of what it "looks like") and the
 *      prompt-layering module that keeps untrusted content in a clearly
 *      demarcated, non-instruction-bearing region of the prompt so the
 *      model is structurally less likely to treat it as directives in the
 *      first place. Both of those are being built alongside this module by
 *      other engineers in this same effort; this detector's findings are
 *      meant to feed *into* that risk-floor decision (e.g. "downgrade trust
 *      further" or "flag for review"), not to stand in for it.
 *
 *   3. False positives are an acceptable, even desirable, cost here — a
 *      benign document that happens to contain phrasing like "ignore
 *      previous instructions" (e.g. because it is itself *about* prompt
 *      injection) getting flagged and routed through a more conservative
 *      path is a much cheaper mistake than a false negative letting a real
 *      injection through unflagged. False negatives are expected and
 *      tolerated precisely because this module is not the primary control;
 *      callers must not treat an empty finding list as "this content is
 *      safe", only as "this content did not match our known bad patterns".
 *
 * Unlike `detectSecrets` (which only needs the first occurrence of a secret
 * to know a document is contaminated), `detectInjectionPattern` collects
 * *every* match per pattern: injection text frequently repeats the same
 * directive in several places (e.g. once near the top of a document, again
 * near the bottom, hoping one survives truncation or scanning), and the
 * number of hits is itself a useful signal for how aggressively to react.
 */

const INJECTION_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  {
    name: "instruction_override",
    pattern:
      /\b(?:ignore|disregard|forget)\s+(?:all\s+|everything\s+)?(?:the\s+)?(?:above|prior|previous|preceding)\s+(?:instructions?|prompts?|directions?|context)?\b/i,
  },
  {
    name: "role_hijack",
    pattern:
      /\b(?:you\s+are\s+now\b|act\s+as\s+if\s+you\s+are\b|you\s+are\s+no\s+longer\b|new\s+instructions?\s*:|system\s+prompt\s*:)/i,
  },
  {
    name: "fake_role_delimiter",
    pattern: /^\s*(?:system|assistant|user)\s*:|^\s*#{2,3}\s*instruction\b/im,
  },
  {
    name: "exfiltration_request",
    pattern:
      /\b(?:reveal|print|show|output|dump)\s+(?:your\s+)?(?:system\s+prompt|(?:the\s+)?instructions?|everything\s+above(?:\s+this\s+line)?)\b/i,
  },
  {
    name: "authority_override",
    pattern:
      /\b(?:as\s+(?:the\s+)?(?:developer|admin|administrator)\s*,?\s*i\s*(?:am|'m)\s+instructing\s+you\s+to|this\s+is\s+an\s+override\s+command)\b/i,
  },
  {
    name: "encoded_payload_hint",
    pattern:
      /\b(?:decode|execute|run|follow)\s+(?:this|the\s+following)\b[^\n]{0,40}(?:base64|encoded)?[^\n]{0,20}[:\s]+(?:[A-Za-z0-9+/]{24,}={0,2})/i,
  },
];

/**
 * A single pattern match found by {@link detectInjectionPattern}. Mirrors
 * `SecretFinding`'s shape (`name` of the matched pattern plus the character
 * `index` of that match within the scanned text) so callers already handling
 * secret findings can reuse the same downstream plumbing — logging,
 * telemetry, evidence attachment — for injection findings with minimal
 * branching.
 */
export interface InjectionFinding {
  readonly name: string;
  readonly index: number;
}

/**
 * Scans `text` against every pattern in {@link INJECTION_PATTERNS} and
 * returns one {@link InjectionFinding} per match, across *all* patterns and
 * *all* occurrences of each pattern (not just the first, unlike
 * `detectSecrets`) — see the module doc comment for why repeated matches
 * matter for injection text specifically. Callers that only care whether
 * the text is clean at all can check `findings.length === 0`; callers that
 * want to react proportionally (e.g. feed the count into a risk score) can
 * use the full list.
 *
 * This function is intentionally pure and side-effect free: it does not
 * throw, log, or mutate `text`. Use {@link assertNoInjectionPatterns} at
 * call sites that want a hard failure instead of a signal.
 */
export function detectInjectionPattern(text: string): readonly InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const { name, pattern } of INJECTION_PATTERNS) {
    // Each pattern may need to be scanned globally even though its
    // definition above is not itself declared with the `g` flag (several
    // patterns rely on `^`/multiline anchors or lookarounds that are
    // easier to read without `g` baked in), so a fresh global copy is
    // constructed per call to safely drive `RegExp#exec` in a loop
    // without mutating the shared pattern's `lastIndex` across calls.
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      findings.push({ name, index: match.index });
      // Guard against zero-width matches looping forever.
      if (match[0].length === 0) {
        globalPattern.lastIndex += 1;
      }
    }
  }
  return findings;
}

/**
 * Throws if {@link detectInjectionPattern} finds anything in `text`, naming
 * every distinct pattern that matched in the error message so the failure
 * is actionable from logs alone. Mirrors `assertNoSecrets`'s contract
 * exactly: a convenience for call sites that have decided a hit here should
 * hard-stop the current operation (e.g. refuse to ingest a document into
 * memory) rather than merely downgrade trust and continue, which is the
 * more common reaction and belongs in the dispatcher's risk-floor logic
 * instead of here.
 */
export function assertNoInjectionPatterns(text: string, context: string): void {
  const findings = detectInjectionPattern(text);
  if (findings.length > 0) {
    const uniqueNames = [...new Set(findings.map((f) => f.name))];
    throw new Error(`Prompt-injection pattern detected before ${context}: ${uniqueNames.join(", ")}`);
  }
}
