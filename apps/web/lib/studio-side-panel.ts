
export type StudioSidePanel = "agent" | "chat" | "patches" | "psa";

type SidePanelStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "atlas.studio.sidePanel";

export function browserSidePanelStorage(): SidePanelStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredSidePanel(
  storage: SidePanelStorage | null,
): StudioSidePanel | null {
  try {
    const saved = storage?.getItem(STORAGE_KEY);

    if (saved === "agent" || saved === "patches" || saved === "psa") {
      return saved;
    }

    return null;
  } catch {
    return null;
  }
}

export function storeSidePanel(
  storage: SidePanelStorage | null,
  panel: StudioSidePanel,
): void {
  if (!storage || panel === "chat") {
    return;
  }

  try {
    storage.setItem(STORAGE_KEY, panel);
  } catch {
    // Storage unavailable: keep the current panel without persistence.
  }
}


