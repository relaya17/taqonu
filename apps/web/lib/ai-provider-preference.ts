import {
  AI_PROVIDER_CATALOG,
  AI_PROVIDER_IDS,
  type AiProviderId,
} from "@atlas/shared";

const STORAGE_KEY = "atlas.aiProviderId";
export const DEFAULT_AI_PROVIDER_ID: AiProviderId = "arletos-included";

/** Agent-capable catalog ids (excludes assist-only vision/checklist). */
export const COMPANION_PROVIDER_IDS = AI_PROVIDER_IDS.filter((id) => {
  const def = AI_PROVIDER_CATALOG[id];
  return def && def.kind !== "assist";
}) as AiProviderId[];

export function isCompanionProviderId(value: string): value is AiProviderId {
  return (COMPANION_PROVIDER_IDS as readonly string[]).includes(value);
}

export function getPreferredAiProvider(): AiProviderId {
  if (typeof window === "undefined") return DEFAULT_AI_PROVIDER_ID;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && isCompanionProviderId(raw)) return raw;
  } catch {
    // ignore storage errors
  }
  return DEFAULT_AI_PROVIDER_ID;
}

export function setPreferredAiProvider(id: string): AiProviderId {
  const next = isCompanionProviderId(id) ? id : DEFAULT_AI_PROVIDER_ID;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }
  return next;
}

export function companionBilling(
  id: AiProviderId,
): "included" | "credits" {
  return AI_PROVIDER_CATALOG[id]?.billing ?? "included";
}
