import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Why this test exists.
 *
 * This project's own audit history keeps finding the same shape of mistake:
 * a new code path is added that *should* route through an existing safety
 * gate, but doesn't, and the gap only surfaces later via a manual review —
 * see `agent-dispatch-guard.ts`'s doc comment for the "no central
 * dispatcher" version of this same story with `enforceEntityWrite`. This
 * test targets one specific, high-value instance of that pattern: a real
 * outbound LLM call added somewhere in `apps/api` or `packages/agent-core`
 * that bypasses the layered-prompt (`buildLayeredSystemPrompt`) +
 * injection-detection (`detectInjectionPattern`) machinery those two
 * existing call sites already go through.
 *
 * `completeWithFreeFallback` and `completeStrict` (both defined in
 * `packages/agent-core/src/providers/llm.ts`) are the ONLY two functions in
 * this codebase that place a real outbound call to an LLM provider. As of
 * this writing, exactly two files call them:
 * `apps/api/src/routes/agent.ts` and `apps/api/src/routes/conversation.ts`.
 * Both build their system prompt via `buildLayeredSystemPrompt` before
 * calling either function, so untrusted content reaching the model is
 * structurally wrapped and scanned. A THIRD call site added later — in a
 * new route, a background job, a webhook handler, anywhere — would silently
 * skip that protection unless someone remembers to route it through the
 * same machinery and thinks to update this list.
 *
 * This test is a narrow, mechanical backstop, not a substitute for code
 * review or a guarantee that an allow-listed call site actually uses
 * `buildLayeredSystemPrompt` correctly — it only proves the *set* of files
 * calling `completeWithFreeFallback`/`completeStrict` hasn't silently grown
 * or gone stale. A reviewer still has to look at the diff of any new entry
 * added to `ALLOWED_CALL_SITES` and confirm it actually builds its prompt
 * through the layering module before approving it.
 */

/**
 * The exact, current, deliberately-reviewed set of files allowed to call
 * `completeWithFreeFallback(` or `completeStrict(`. Confirmed via:
 *
 *   grep -rn "completeWithFreeFallback\|completeStrict\b" apps/ packages/ \
 *     --include=*.ts | grep -v ".test.ts" | grep -v "node_modules"
 *
 * Do not add to this list casually. A new entry means a new place in this
 * codebase that places a real, billed call to an LLM provider — confirm the
 * new call site builds its system prompt via `buildLayeredSystemPrompt`
 * (packages/agent-core/src/security/prompt-layers.ts) before adding it here.
 */
const ALLOWED_CALL_SITES: readonly string[] = [
  "apps/api/src/routes/agent.ts",
  "apps/api/src/routes/conversation.ts",
  // Phase 1a proposal-first fabric. Reviewed against this list's own rule
  // before being added: `generateSpecialistProposalViaLlm` builds its system
  // prompt with `buildLayeredSystemPrompt` and puts the caller-supplied
  // `request` — the only attacker-controllable text in that prompt — in
  // `untrustedBlocks`, keeping the static specialist-catalog text as the
  // sole `instructions` content, then redacts the assembled result, exactly
  // as `agent.ts` does. It is the ONLY new file in this change that contains
  // a `completeWithFreeFallback(` call; the two specialist services that use
  // it (`code-engineer-dispatch.ts`, `research-analyst-dispatch.ts`) reach
  // the provider only through this file and are deliberately NOT listed here.
  "apps/api/src/services/llm-specialist-proposal.ts",
];

const CALL_PATTERNS = ["completeWithFreeFallback(", "completeStrict("] as const;

/**
 * The file that *defines* `completeWithFreeFallback`/`completeStrict` — the
 * export declarations themselves (and the doc comments naming them) are not
 * call sites and must be excluded from the scan, or this test would flag
 * its own function definitions as violations.
 */
const DEFINITION_FILE = "packages/agent-core/src/providers/llm.ts";

/** Directories under each scan root that never contain reviewable app/library source. */
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".git"]);

const here = fileURLToPath(new URL(".", import.meta.url));
// here = .../apps/api/src/__tests__ ; repo root is four levels up.
const repoRoot = join(here, "..", "..", "..", "..");

const SCAN_ROOTS = ["apps/api/src", "packages/agent-core/src"];

/** Recursively collect every `.ts` file under `absDir`, skipping the usual noise directories. */
function walkTsFiles(absDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(absDir)) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const abs = join(absDir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      out.push(...walkTsFiles(abs));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(abs);
    }
  }
  return out;
}

/** A repo-relative, forward-slash path, so this test's output/messages are stable across platforms. */
function toRepoRelative(absPath: string): string {
  return relative(repoRoot, absPath).split(sep).join("/");
}

describe("LLM call-site guard (static source scan, no mocking)", () => {
  it("no file outside ALLOWED_CALL_SITES calls completeWithFreeFallback(...) or completeStrict(...)", () => {
    const foundCallSites = new Set<string>();

    for (const root of SCAN_ROOTS) {
      const absRoot = join(repoRoot, root);
      for (const absFile of walkTsFiles(absRoot)) {
        const relFile = toRepoRelative(absFile);
        if (relFile === DEFINITION_FILE) continue; // where they're defined, not called

        const content = readFileSync(absFile, "utf8");
        const callsHere = CALL_PATTERNS.some((pattern) => content.includes(pattern));
        if (callsHere) {
          foundCallSites.add(relFile);
        }
      }
    }

    const unexpected = [...foundCallSites].filter((f) => !ALLOWED_CALL_SITES.includes(f));

    expect(
      unexpected,
      unexpected.length === 0
        ? undefined
        : [
            `Found a call to completeWithFreeFallback(...)/completeStrict(...) in a file NOT on`,
            `the ALLOWED_CALL_SITES allow-list: ${unexpected.join(", ")}.`,
            ``,
            `This is a real outbound LLM call site — before it can be added to the`,
            `allow-list, make sure it builds its system prompt via`,
            `buildLayeredSystemPrompt() (packages/agent-core/src/security/prompt-layers.ts)`,
            `so untrusted content is structurally wrapped and scanned for injection`,
            `attempts, the same way apps/api/src/routes/agent.ts and`,
            `apps/api/src/routes/conversation.ts already do. Once that's confirmed,`,
            `add the file's repo-relative path to ALLOWED_CALL_SITES in`,
            `apps/api/src/__tests__/llm-call-site-guard.test.ts deliberately.`,
          ].join("\n"),
    ).toEqual([]);
  });

  it("every file in ALLOWED_CALL_SITES still actually calls completeWithFreeFallback(...) or completeStrict(...)", () => {
    const stale: string[] = [];

    for (const relFile of ALLOWED_CALL_SITES) {
      const absFile = join(repoRoot, relFile);
      const content = readFileSync(absFile, "utf8");
      const callsHere = CALL_PATTERNS.some((pattern) => content.includes(pattern));
      if (!callsHere) {
        stale.push(relFile);
      }
    }

    expect(
      stale,
      stale.length === 0
        ? undefined
        : [
            `ALLOWED_CALL_SITES in apps/api/src/__tests__/llm-call-site-guard.test.ts lists`,
            `${stale.join(", ")} as a real LLM call site, but it no longer contains a call`,
            `to completeWithFreeFallback(...) or completeStrict(...). The allow-list has`,
            `gone stale — if this file genuinely stopped calling the LLM gateway,`,
            `remove it from ALLOWED_CALL_SITES deliberately rather than leaving a dead`,
            `entry in place.`,
          ].join("\n"),
    ).toEqual([]);
  });
});

/**
 * Known LLM provider endpoints. A raw `fetch` to one of these IS an outbound
 * model call, regardless of which helper it does or does not use.
 */
const PROVIDER_HOSTS: readonly string[] = [
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "api.deepseek.com",
];

/**
 * Files allowed to reach a provider without going through
 * `completeStrict`/`completeWithFreeFallback`.
 *
 * Each entry MUST still apply the Phase 0 defences itself —
 * `buildLayeredSystemPrompt` for structural isolation of untrusted content,
 * and `redactSecrets` on what leaves. Verify both before adding one.
 */
const ALLOWED_RAW_PROVIDER_CALLS: readonly string[] = [
  // Vision/image assist: builds a multimodal request body the text-only
  // gateway cannot express, so it calls the provider directly. It DOES
  // build its prompt via buildLayeredSystemPrompt and redact both
  // directions — asserted below, not merely asserted here.
  "apps/api/src/services/artifacts-assists.ts",
  // The gateway itself: this is where provider calls are supposed to live.
  "packages/agent-core/src/providers/llm.ts",
];

describe("LLM provider-endpoint guard (catches raw fetch bypasses)", () => {
  it("no file reaches an LLM provider by raw fetch outside the allow-list", () => {
    // The original guard above scans for two FUNCTION NAMES. A call site
    // using `fetch("https://api.openai.com/...")` was invisible to it — and
    // one really existed (artifacts-assists.ts), shipping without the
    // structural injection defence every other call site received. Matching
    // on the endpoint instead of the helper closes that blind spot.
    const offenders: string[] = [];

    for (const root of SCAN_ROOTS) {
      for (const absFile of walkTsFiles(join(repoRoot, root))) {
        const relFile = toRepoRelative(absFile);
        if (ALLOWED_RAW_PROVIDER_CALLS.includes(relFile)) continue;

        const content = readFileSync(absFile, "utf8");
        if (PROVIDER_HOSTS.some((host) => content.includes(host))) {
          offenders.push(relFile);
        }
      }
    }

    expect(
      offenders,
      offenders.length === 0
        ? undefined
        : [
            `These files reference an LLM provider endpoint directly:`,
            `  ${offenders.join("\n  ")}`,
            ``,
            `A raw provider call skips completeStrict/completeWithFreeFallback,`,
            `and therefore skips buildLayeredSystemPrompt — untrusted content`,
            `reaches the model unseparated and uninspected. Route it through`,
            `the gateway, or apply the Phase 0 defences at the call site and`,
            `add it to ALLOWED_RAW_PROVIDER_CALLS deliberately.`,
          ].join("\n"),
    ).toEqual([]);
  });

  it("every allow-listed raw call site actually applies the Phase 0 defences", () => {
    // An allow-list entry that stopped defending itself would be worse than
    // no allow-list, so the exemption is conditional on the evidence.
    const undefended: string[] = [];

    for (const relFile of ALLOWED_RAW_PROVIDER_CALLS) {
      if (relFile.endsWith("providers/llm.ts")) continue; // the gateway itself
      const content = readFileSync(join(repoRoot, relFile), "utf8");
      if (
        !content.includes("buildLayeredSystemPrompt") ||
        !content.includes("redactSecrets")
      ) {
        undefended.push(relFile);
      }
    }

    expect(undefended).toEqual([]);
  });
});
