"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AiProviderId } from "@atlas/shared";
import {
  companionBilling,
  DEFAULT_AI_PROVIDER_ID,
  getPreferredAiProvider,
  setPreferredAiProvider,
} from "@/lib/ai-provider-preference";

interface AiCompanionContextValue {
  providerId: AiProviderId;
  billing: "included" | "credits";
  setProviderId: (id: string) => void;
  ready: boolean;
}

const AiCompanionContext = createContext<AiCompanionContextValue | null>(null);

export function AiCompanionProvider({ children }: { children: ReactNode }) {
  const [providerId, setProviderIdState] = useState<AiProviderId>(
    DEFAULT_AI_PROVIDER_ID,
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setProviderIdState(getPreferredAiProvider());
    setReady(true);
  }, []);

  const setProviderId = useCallback((id: string) => {
    const next = setPreferredAiProvider(id);
    setProviderIdState(next);
  }, []);

  const value = useMemo(
    () => ({
      providerId,
      billing: companionBilling(providerId),
      setProviderId,
      ready,
    }),
    [providerId, setProviderId, ready],
  );

  return (
    <AiCompanionContext.Provider value={value}>
      {children}
    </AiCompanionContext.Provider>
  );
}

export function useAiCompanion(): AiCompanionContextValue {
  const ctx = useContext(AiCompanionContext);
  if (!ctx) {
    throw new Error("useAiCompanion must be used within AiCompanionProvider");
  }
  return ctx;
}
