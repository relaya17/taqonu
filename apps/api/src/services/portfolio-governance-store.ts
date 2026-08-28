import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  emptyOverlay,
  loadSeedSnapshot,
  mergePortfolioSnapshot,
  PORTFOLIO_OVERLAY_META_KEY,
  portfolioGovernanceOverlaySchema,
  type PortfolioGovernanceOverlay,
  type PortfolioGovernanceSnapshot,
} from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { findRepoRoot } from "./repo-root.js";

function overlayFilePath(): string {
  const fromEnv = process.env.ATLAS_PORTFOLIO_GOVERNANCE_PATH?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(findRepoRoot(), ".atlas", "portfolio-governance.json");
}

function parseOverlayJson(raw: string): PortfolioGovernanceOverlay | null {
  try {
    return portfolioGovernanceOverlaySchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadPortfolioOverlay(): PortfolioGovernanceOverlay {
  osStore.ensureLoaded();
  const fromMeta = osStore.getMeta(PORTFOLIO_OVERLAY_META_KEY);
  if (fromMeta) {
    const parsed = parseOverlayJson(fromMeta);
    if (parsed) return parsed;
  }
  const file = overlayFilePath();
  if (existsSync(file)) {
    try {
      const parsed = parseOverlayJson(readFileSync(file, "utf8"));
      if (parsed) return parsed;
    } catch {
      // fall through to empty overlay
    }
  }
  return emptyOverlay();
}

export function savePortfolioOverlay(overlay: PortfolioGovernanceOverlay): void {
  const parsed = portfolioGovernanceOverlaySchema.parse(overlay);
  const serialized = JSON.stringify(parsed, null, 2);
  osStore.setMeta(PORTFOLIO_OVERLAY_META_KEY, serialized);
  if (process.env.ATLAS_SKIP_STORE_PERSIST === "1") return;
  const file = overlayFilePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serialized, "utf8");
}

export function getPortfolioSnapshot(): PortfolioGovernanceSnapshot {
  return mergePortfolioSnapshot(loadSeedSnapshot(), loadPortfolioOverlay());
}

/** Test helper — overlay only. Never mutates the static seed. */
export function resetPortfolioOverlayForTests(): void {
  const overlay = emptyOverlay("2026-08-28T00:00:00.000Z");
  osStore.setMeta(PORTFOLIO_OVERLAY_META_KEY, JSON.stringify(overlay));
}
