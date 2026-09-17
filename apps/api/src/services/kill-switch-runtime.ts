/**
 * Task 7 -- Runtime Kill Switch Control: effective-state resolution.
 *
 * `packages/agent-core`'s `kill-switches.ts` is the sole enforcement
 * primitive (`firstActiveKillSwitch` / `isKillSwitchActive` /
 * `listActiveKillSwitches`) and is intentionally left unmodified: every one
 * of its functions already accepts an optional `env: NodeJS.ProcessEnv`
 * override for testability. This module exploits exactly that seam: it
 * builds a synthetic env object whose `ATLAS_KILL_SWITCHES` value is the
 * UNION of the real process env baseline and the durable runtime overrides
 * held in `osStore`, then passes that synthetic env to the unmodified
 * primitives.
 *
 * This is the only place the union/merge happens. Enforcement call sites
 * (`agent-dispatch-guard.ts`, `remediation.ts`) call `firstActiveKillSwitch`
 * exactly as before, just with `effectiveKillSwitchEnv()` as the second
 * argument instead of the implicit `process.env` default -- so a runtime
 * override reaches enforcement through the exact same code path env-based
 * kill switches already used, with no new enforcement branch.
 *
 * Invariant (non-negotiable, see Task 7 spec): runtime "deactivate" clears
 * ONLY the override entry. It can never remove a category the real env
 * baseline still lists -- this module never subtracts from the env value,
 * only adds to it.
 */
import {
  KILL_SWITCH_CATEGORIES,
  firstActiveKillSwitch,
  listActiveKillSwitches,
  type KillSwitchCategory,
  type KillSwitchCheck,
} from "@atlas/agent-core";
import { osStore, type KillSwitchOverrideRecord } from "../store/os-store.js";

const ENV_VAR = "ATLAS_KILL_SWITCHES";

function isKnownCategory(token: string): token is KillSwitchCategory {
  return (KILL_SWITCH_CATEGORIES as readonly string[]).includes(token);
}

/**
 * The real env-baseline categories only (no runtime overrides). Exposed
 * so status responses can tell an operator "this is active because of the
 * environment, clearing the runtime override will not help."
 */
export function envBaselineCategories(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlySet<KillSwitchCategory> {
  const raw = env[ENV_VAR];
  const active = new Set<KillSwitchCategory>();
  if (!raw) return active;
  for (const token of raw.split(/[|,]/).map((t) => t.trim()).filter(Boolean)) {
    if (isKnownCategory(token)) active.add(token);
  }
  return active;
}

/** The durable runtime-override categories only (no env baseline). */
export function runtimeOverrideCategories(): ReadonlySet<KillSwitchCategory> {
  const overrides = osStore.getKillSwitchOverrides();
  const active = new Set<KillSwitchCategory>();
  for (const key of Object.keys(overrides)) {
    if (isKnownCategory(key)) active.add(key);
  }
  return active;
}

/**
 * Builds a synthetic env object combining the real process env with the
 * durable runtime overrides (union), for passing into the unmodified
 * `@atlas/agent-core` kill-switch primitives as their `env` argument. Only
 * `ATLAS_KILL_SWITCHES` is touched; every other env var passes through
 * untouched (so nothing else about process env resolution is affected).
 */
export function effectiveKillSwitchEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const envCategories = envBaselineCategories(baseEnv);
  const overrideCategories = runtimeOverrideCategories();
  if (overrideCategories.size === 0) {
    // No overrides at all -- return the real env unchanged (no synthetic
    // object needed, and no risk of losing an env var we didn't know about).
    return baseEnv;
  }
  const union = new Set<string>([...envCategories, ...overrideCategories]);
  return {
    ...baseEnv,
    [ENV_VAR]: Array.from(union).join(","),
  };
}

/** `firstActiveKillSwitch`, resolved against the effective (env ∪ runtime) state. */
export function firstActiveEffectiveKillSwitch(
  additionalCategories: readonly KillSwitchCategory[] = [],
): KillSwitchCheck | null {
  return firstActiveKillSwitch(additionalCategories, effectiveKillSwitchEnv());
}

/** `listActiveKillSwitches`, resolved against the effective (env ∪ runtime) state. */
export function listActiveEffectiveKillSwitches(): readonly KillSwitchCategory[] {
  return listActiveKillSwitches(effectiveKillSwitchEnv());
}

export interface KillSwitchStatusEntry {
  readonly category: KillSwitchCategory;
  readonly envActive: boolean;
  readonly runtimeOverrideActive: boolean;
  readonly effectiveActive: boolean;
  readonly override: KillSwitchOverrideRecord | null;
}

/**
 * Full per-category status for the Control UI / status API: env baseline,
 * runtime override, the resolved effective state, and the override record
 * (reason/setBy/setAt) when one exists -- enough for an operator to see
 * *why* a category is active (env vs. runtime vs. both) and whether
 * clearing the runtime override would actually change anything.
 */
export function getKillSwitchStatus(): readonly KillSwitchStatusEntry[] {
  const envCategories = envBaselineCategories();
  const overrides = osStore.getKillSwitchOverrides();
  return KILL_SWITCH_CATEGORIES.map((category) => {
    const envActive = envCategories.has(category);
    const override = overrides[category] ?? null;
    const runtimeOverrideActive = override !== null;
    return {
      category,
      envActive,
      runtimeOverrideActive,
      effectiveActive: envActive || runtimeOverrideActive,
      override,
    };
  });
}
