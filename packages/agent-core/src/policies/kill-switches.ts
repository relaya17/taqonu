/**
 * Global emergency kill switches.
 *
 * Imported from Vantera (see `atlas-6-apps-connection-discovery-2026-09-05.md`
 * §3: Vantera's `KILL_SWITCHES = payments|webhooksInbound|webhooksOutbound|
 * voneMoney|aiWorkers`, with no Atlas equivalent). A kill switch is a
 * category-level circuit breaker: when a category is active, every
 * dispatched agent/automation action tagged with that category is DENIED
 * before policy or risk evaluation runs — regardless of how low-risk the
 * action would otherwise score.
 *
 * This is deliberately NOT a normal policy decision. It exists for the
 * moment something is actively going wrong (a runaway automation, a
 * compromised credential, a bad deploy) and an operator needs the system to
 * stop immediately, without waiting for a code change or a deploy.
 *
 * Configuration: `ATLAS_KILL_SWITCHES` — a comma- or pipe-separated list of
 * active categories (e.g. "payments|webhooksInbound"). Unknown tokens are
 * ignored rather than throwing, so a typo disables nothing silently-unsafe
 * (it simply fails to activate a switch — the caller should alert on that
 * separately, e.g. by comparing against `KILL_SWITCH_CATEGORIES`).
 *
 * State is read from `process.env` on every call, not cached at import
 * time, so an operator can flip a switch by changing the environment
 * (platform-dependent: some deployment targets apply this live, others
 * need a restart) without a code deploy either way.
 */

/** The set of categories a caller may gate on. Extend deliberately — this is a global, cross-tenant control. */
export const KILL_SWITCH_CATEGORIES = [
  /** Master switch: stops every agent/automation dispatch, regardless of entity/action. */
  "agentDispatch",
  /** Anything that moves money: commission payouts, invoices, ledger postings. */
  "payments",
  /** Inbound webhooks from managed systems (Civio, BrokerOS, ...) into Atlas. */
  "webhooksInbound",
  /** Outbound webhooks/pushes from Atlas into managed systems. */
  "webhooksOutbound",
  /** Background AI workers / schedulers, as opposed to a live, in-session agent. */
  "aiWorkers",
] as const;

export type KillSwitchCategory = (typeof KILL_SWITCH_CATEGORIES)[number];

const ENV_VAR = "ATLAS_KILL_SWITCHES";

function isKnownCategory(token: string): token is KillSwitchCategory {
  return (KILL_SWITCH_CATEGORIES as readonly string[]).includes(token);
}

function activeCategoriesFromEnv(
  raw: string | undefined,
): ReadonlySet<KillSwitchCategory> {
  if (!raw) return new Set();
  const active = new Set<KillSwitchCategory>();
  for (const token of raw.split(/[|,]/).map((t) => t.trim()).filter(Boolean)) {
    if (isKnownCategory(token)) active.add(token);
  }
  return active;
}

export interface KillSwitchCheck {
  readonly category: KillSwitchCategory;
  readonly active: boolean;
}

/** Whether a single category is currently active. Never cached. */
export function isKillSwitchActive(
  category: KillSwitchCategory,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return activeCategoriesFromEnv(env[ENV_VAR]).has(category);
}

/** Same check, returned as a record for logging/audit rather than a bare boolean. */
export function checkKillSwitch(
  category: KillSwitchCategory,
  env: NodeJS.ProcessEnv = process.env,
): KillSwitchCheck {
  return { category, active: isKillSwitchActive(category, env) };
}

/** All categories currently active, for status/health endpoints. */
export function listActiveKillSwitches(
  env: NodeJS.ProcessEnv = process.env,
): readonly KillSwitchCategory[] {
  return Array.from(activeCategoriesFromEnv(env[ENV_VAR]));
}

/**
 * Checks `agentDispatch` (always) plus any additional categories the caller
 * declares (e.g. a payments-tagged action also checks `payments`). Returns
 * the first active match, or `null` if none of the checked categories are
 * active.
 */
export function firstActiveKillSwitch(
  additionalCategories: readonly KillSwitchCategory[] = [],
  env: NodeJS.ProcessEnv = process.env,
): KillSwitchCheck | null {
  const active = activeCategoriesFromEnv(env[ENV_VAR]);
  const ordered: readonly KillSwitchCategory[] = [
    "agentDispatch",
    ...additionalCategories,
  ];
  for (const category of ordered) {
    if (active.has(category)) return { category, active: true };
  }
  return null;
}
