/**
 * Read-only Control Plane projection of Portfolio Governance inventory.
 * Overlay writes and canonical audit stay on the Atlas API.
 * Does not ingest knowledge, probe sources, or mutate FABRIC_AGENT_CATALOG.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPortfolioSummary,
  emptyOverlay,
  loadSeedSnapshot,
  mergePortfolioSnapshot,
  portfolioGovernanceOverlaySchema,
  type PortfolioGovernanceOverlay,
  type PortfolioGovernanceSnapshot,
} from "@atlas/shared";

function repoRoot(): string {
  const fromEnv = process.env.ATLAS_REPO_ROOT?.trim();
  if (fromEnv) return resolve(fromEnv);
  // Bundlers that emit CJS leave import.meta.url empty, and a serverless
  // function has no repo checkout to walk up to. Degrade to cwd so the
  // caller's existsSync miss yields an empty overlay instead of throwing.
  const moduleUrl = import.meta.url;
  if (!moduleUrl?.startsWith("file:")) return process.cwd();
  return resolve(dirname(fileURLToPath(moduleUrl)), "../../../..");
}

function overlayFilePath(): string {
  const fromEnv = process.env.ATLAS_PORTFOLIO_GOVERNANCE_PATH?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(repoRoot(), ".atlas", "portfolio-governance.json");
}

function loadOverlay(): PortfolioGovernanceOverlay {
  const file = overlayFilePath();
  if (!existsSync(file)) return emptyOverlay();
  try {
    return portfolioGovernanceOverlaySchema.parse(
      JSON.parse(readFileSync(file, "utf8")),
    );
  } catch {
    return emptyOverlay();
  }
}

export function getControlPlanePortfolioView(): {
  readonly snapshot: PortfolioGovernanceSnapshot;
  readonly summary: ReturnType<typeof buildPortfolioSummary>;
  readonly writeAuthority: "ATLAS_API";
  readonly executionRegistry: "FABRIC_AGENT_CATALOG";
  readonly notAnAgentRegistry: true;
  readonly observational: true;
} {
  const snapshot = mergePortfolioSnapshot(loadSeedSnapshot(), loadOverlay());
  return {
    snapshot,
    summary: buildPortfolioSummary(snapshot),
    writeAuthority: "ATLAS_API",
    executionRegistry: "FABRIC_AGENT_CATALOG",
    notAnAgentRegistry: true,
    observational: true,
  };
}
