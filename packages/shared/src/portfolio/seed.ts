/**
 * Static portfolio inventory (Phase 11.2–11.4 seed).
 * Phase 3: Capability extraction with semantic description.
 * Observational only — no sibling execution, no Fabric mutation, no knowledge ingest.
 */
import { FABRIC_AGENT_IDS, FABRIC_AGENT_CATALOG } from "../constants/agents.js";
import { PORTFOLIO_GOVERNANCE_VERSION } from "../constants/portfolio-governance.js";
import {
  portfolioGovernanceSnapshotSchema,
  type PortfolioApplication,
  type PortfolioAuditEvent,
  type PortfolioCanonicalCapability,
  type portfolioConflictSchema,
  type portfolioDedupRelationSchema,
  type portfolioEvidenceSchema,
  type PortfolioCapability,
  type PortfolioGovernanceDecision,
  type PortfolioGovernanceSnapshot,
  type PortfolioKnowledgeRecord,
  type PortfolioPermission,
  type PortfolioProvenance,
  type PortfolioSourceAgent,
} from "../schemas/portfolio-governance.schema.js";
import type { z } from "zod";

const EXTRACTED_AT = "2026-08-28T13:42:00.000Z";

const COMMITS = {
  atlas: "7ba11d5e0abfbd9c4bf05b084e6cea7eaf80992e",
  vantera: "3313bb52852f04e4e96aa5279f2870e631956418",
  hotelos: "66ea0cdd25757902d228110d24a15d913f6618b5",
  caseflow: "62bca234e4e8da03deeddc54c3869ef5651bcd7b",
  brokeros: "a7638bb0298293ddd3432d0db65806975e21c5d2",
  lexstudy: "0d005a430d95313d27c24133a75001e9f09cdaae",
  civio: "0f79e86dfae62f4ce3ef7fff041a2957ddbdafdb",
} as const;

const RUNTIME_UNKNOWN = {
  state: "UNKNOWN" as const,
  probeKind: "NONE" as const,
  probedAt: null,
};

function uid(seq: number): string {
  return `a11c0000-0000-4000-a000-${seq.toString(16).padStart(12, "0")}`;
}

function prov(input: {
  applicationId?: string | null;
  repo: string;
  branch: string;
  commit: string;
  path: string;
  pkg: string | null;
  symbol: string | null;
  sourceType: PortfolioProvenance["sourceType"];
  originalStatus?: PortfolioProvenance["originalStatus"];
  atlasClassification?: string;
}): PortfolioProvenance {
  return {
    sourceApplicationId: input.applicationId ?? null,
    sourceRepository: input.repo,
    sourceBranch: input.branch,
    sourceCommit: input.commit,
    sourcePath: input.path,
    sourcePackage: input.pkg,
    sourceSymbol: input.symbol,
    sourceType: input.sourceType,
    extractedAt: EXTRACTED_AT,
    extractor: "atlas-portfolio-discovery",
    originalStatus: input.originalStatus ?? "UNKNOWN",
    atlasClassification: input.atlasClassification ?? "",
    evidenceIds: [],
  };
}

const APP = {
  atlas: uid(1),
  vantera: uid(2),
  hotelos: uid(3),
  caseflow: uid(4),
  brokeros: uid(5),
  lexstudy: uid(6),
  civio: uid(7),
} as const;

function application(
  id: string,
  slug: string,
  name: string,
  role: "TARGET" | "SOURCE",
  repo: string,
  branch: string,
  commit: string,
  notes: string,
): PortfolioApplication {
  return {
    id,
    slug,
    name,
    role,
    sourceRepository: repo,
    sourceBranch: branch,
    sourceCommit: commit,
    managedSystemId: null,
    notes,
  };
}

function agent(input: {
  seq: number;
  applicationId: string;
  sourceKey: string;
  displayName: string;
  implementationClass: PortfolioSourceAgent["implementationClass"];
  verificationStatus: PortfolioSourceAgent["verificationStatus"];
  provenance: PortfolioProvenance;
  purpose: string;
  domain: string;
  notes: string;
}): PortfolioSourceAgent {
  return {
    id: uid(input.seq),
    applicationId: input.applicationId,
    sourceKey: input.sourceKey,
    displayName: input.displayName,
    implementationClass: input.implementationClass,
    verificationStatus: input.verificationStatus,
    runtimeStatus: RUNTIME_UNKNOWN,
    provenance: input.provenance,
    purpose: input.purpose,
    domain: input.domain,
    atlasPromotionBlocked: true,
    notes: input.notes,
  };
}

export function buildPortfolioSeedSnapshot(): PortfolioGovernanceSnapshot {
  const applications: PortfolioApplication[] = [
    application(
      APP.atlas,
      "atlas",
      "Atlas / ArletOS",
      "TARGET",
      "github/taqonu-main",
      "main",
      COMMITS.atlas,
      "Destination. Fabric catalog is the only Atlas execution registry.",
    ),
    application(
      APP.vantera,
      "vantera",
      "Vantera",
      "SOURCE",
      "github/vantera",
      "feature/separate-landing-apps",
      COMMITS.vantera,
      "Sibling source. Runtime UNKNOWN / NOT_PROBED.",
    ),
    application(
      APP.hotelos,
      "hotelos",
      "HotelOS",
      "SOURCE",
      "github/hotelOS-AI-main",
      "feat/separate-hotel-doors",
      COMMITS.hotelos,
      "Sibling source. Catalog Impl. tags are source claims, not live verification.",
    ),
    application(
      APP.caseflow,
      "caseflow",
      "CaseFlow",
      "SOURCE",
      "github/CaseFlow-AI-main",
      "main",
      COMMITS.caseflow,
      "984 identity cards are not 984 implementations.",
    ),
    application(
      APP.brokeros,
      "brokeros",
      "BrokerOS",
      "SOURCE",
      "github/brokerOS",
      "main",
      COMMITS.brokeros,
      "Four registry labels on one orchestrator. Fixture golden-brokeros is not this app.",
    ),
    application(
      APP.lexstudy,
      "lexstudy",
      "LexStudy",
      "SOURCE",
      "github/LexStudy-main",
      "main",
      COMMITS.lexstudy,
      "28 registry IDs; LEX-AG-027 is mock; 003/005 overlap 002 phases.",
    ),
    application(
      APP.civio,
      "civio",
      "Civio / Michtavia",
      "SOURCE",
      "github.com/relaya17/civio",
      "main",
      COMMITS.civio,
      "Civic-rights application. Knowledge snapshot is scoped to RESEARCHER and LEGAL_MEDIA_COMMS; runtime UNKNOWN / NOT_PROBED.",
    ),
  ];

  const sourceAgents: PortfolioSourceAgent[] = [
    agent({
      seq: 101,
      applicationId: APP.vantera,
      sourceKey: "VAN-AG-001",
      displayName: "V-One",
      implementationClass: "IMPLEMENTED",
      verificationStatus: "PARTIALLY_VERIFIED",
      provenance: prov({
        applicationId: APP.vantera,
        repo: "github/vantera",
        branch: "feature/separate-landing-apps",
        commit: COMMITS.vantera,
        path: "packages/vone-agent/src/index.ts",
        pkg: "@vantera/vone-agent",
        symbol: "VONE_TOOLS",
        sourceType: "AGENT",
        originalStatus: "ACTIVE",
        atlasClassification: "property-ops-write-source",
      }),
      purpose: "Building secretary chat + optional LLM tool loop for residents/committee.",
      domain: "property-ops",
      notes: "WRITE exists in source (tickets/reminders). Must not inherit into Atlas. Money movement not in tools.",
    }),
    agent({
      seq: 102,
      applicationId: APP.vantera,
      sourceKey: "VAN-AG-002",
      displayName: "Ventos",
      implementationClass: "PARTIAL",
      verificationStatus: "PARTIALLY_VERIFIED",
      provenance: prov({
        applicationId: APP.vantera,
        repo: "github/vantera",
        branch: "feature/separate-landing-apps",
        commit: COMMITS.vantera,
        path: "apps/api/src/services/ventosService.ts",
        pkg: "api",
        symbol: "collectTenantSnapshot",
        sourceType: "AGENT",
        originalStatus: "ACTIVE",
        atlasClassification: "executive-snapshot",
      }),
      purpose: "Tenant executive snapshot + lexical knowledge concat. Not an LLM tool loop.",
      domain: "executive",
      notes: "Blocks money-movement phrases. Naming collision with Atlas product is a conflict, not identity.",
    }),
    agent({
      seq: 103,
      applicationId: APP.vantera,
      sourceKey: "VAN-AG-003",
      displayName: "Vantera central knowledge (named Atlas)",
      implementationClass: "IMPLEMENTED",
      verificationStatus: "PARTIALLY_VERIFIED",
      provenance: prov({
        applicationId: APP.vantera,
        repo: "github/vantera",
        branch: "feature/separate-landing-apps",
        commit: COMMITS.vantera,
        path: "apps/api/src/services/knowledgeService.ts",
        pkg: "api",
        symbol: "queryKnowledge",
        sourceType: "KNOWLEDGE",
        originalStatus: "ACTIVE",
        atlasClassification: "knowledge-lexical-conflicting-name",
      }),
      purpose: "Lexical non-PII knowledge retrieval. Product-named Atlas. Not an LLM agent.",
      domain: "knowledge",
      notes: "CONFLICTING name with taqonu Atlas. DO NOT IMPORT as an Atlas runtime agent.",
    }),
    agent({
      seq: 111,
      applicationId: APP.brokeros,
      sourceKey: "MEDIATOR_AGENT",
      displayName: "BrokerOS Mediator",
      implementationClass: "IMPLEMENTED",
      verificationStatus: "VERIFIED",
      provenance: prov({
        applicationId: APP.brokeros,
        repo: "github/brokerOS",
        branch: "main",
        commit: COMMITS.brokeros,
        path: "packages/api/src/agent/orchestrator.ts",
        pkg: "@brokeros/api",
        symbol: "orchestrateDeskRequest",
        sourceType: "AGENT",
        originalStatus: "ACTIVE",
        atlasClassification: "orchestrator-context-specific",
      }),
      purpose: "Hebrew intent routing over deals/accounting/comms. Never mutates the store.",
      domain: "orchestration",
      notes: "Label on a single function. CONTEXT_SPECIFIC vs Atlas ORCHESTRATOR. Tests in orchestrator.test.ts.",
    }),
    agent({
      seq: 112,
      applicationId: APP.brokeros,
      sourceKey: "TRANSACTION_AGENT",
      displayName: "BrokerOS Transaction",
      implementationClass: "IMPLEMENTED",
      verificationStatus: "VERIFIED",
      provenance: prov({
        applicationId: APP.brokeros,
        repo: "github/brokerOS",
        branch: "main",
        commit: COMMITS.brokeros,
        path: "packages/api/src/agent/orchestrator.ts",
        pkg: "@brokeros/api",
        symbol: "resolveDeals",
        sourceType: "AGENT",
        originalStatus: "ACTIVE",
        atlasClassification: "deals-application-specific",
      }),
      purpose: "Find/open/continue deals from office store. Does not invent IDs.",
      domain: "deals",
      notes: "APPLICATION_SPECIFIC Deal/Client schemas.",
    }),
    agent({
      seq: 113,
      applicationId: APP.brokeros,
      sourceKey: "ACCOUNTING_AGENT",
      displayName: "BrokerOS Accounting",
      implementationClass: "IMPLEMENTED",
      verificationStatus: "VERIFIED",
      provenance: prov({
        applicationId: APP.brokeros,
        repo: "github/brokerOS",
        branch: "main",
        commit: COMMITS.brokeros,
        path: "packages/api/src/agent/orchestrator.ts",
        pkg: "@brokeros/api",
        symbol: "accountingDraft",
        sourceType: "AGENT",
        originalStatus: "ACTIVE",
        atlasClassification: "finance-no-invent",
      }),
      purpose: "Invoice/receipt drafts from authoritative deal data only. No store write.",
      domain: "finance",
      notes: "Never invent amounts. Receipt requires paid stage. WRITE is invoices.create outside this agent.",
    }),
    agent({
      seq: 114,
      applicationId: APP.brokeros,
      sourceKey: "COMMUNICATION_AGENT",
      displayName: "BrokerOS Communication",
      implementationClass: "IMPLEMENTED",
      verificationStatus: "VERIFIED",
      provenance: prov({
        applicationId: APP.brokeros,
        repo: "github/brokerOS",
        branch: "main",
        commit: COMMITS.brokeros,
        path: "packages/api/src/agent/orchestrator.ts",
        pkg: "@brokeros/api",
        symbol: "whatsappPreview",
        sourceType: "AGENT",
        originalStatus: "ACTIVE",
        atlasClassification: "messaging-preview-no-send",
      }),
      purpose: "Accountant letter and WhatsApp previews. Never sends.",
      domain: "messaging",
      notes: "DISTINCT from LEGAL_MEDIA_COMMS. Copilot applyCopilotPending is a separate WRITE path — REJECTED for Atlas authority.",
    }),
  ];

  const hos: ReadonlyArray<{
    key: string;
    name: string;
    impl: PortfolioSourceAgent["implementationClass"];
    domain: string;
    ver: PortfolioSourceAgent["verificationStatus"];
  }> = [
    { key: "agent.cio", name: "CIO Orchestrator", impl: "IMPLEMENTED", domain: "intelligence", ver: "PARTIALLY_VERIFIED" },
    { key: "agent.kashrut", name: "Kashrut Supervisor", impl: "IMPLEMENTED", domain: "compliance", ver: "PARTIALLY_VERIFIED" },
    { key: "agent.ceo", name: "CEO Agent", impl: "PARTIAL", domain: "executive", ver: "NOT_VERIFIED" },
    { key: "agent.cfo", name: "CFO Agent", impl: "IMPLEMENTED", domain: "finance", ver: "PARTIALLY_VERIFIED" },
    { key: "agent.revenue", name: "Revenue Agent", impl: "PARTIAL", domain: "revenue", ver: "NOT_VERIFIED" },
    { key: "agent.housekeeping", name: "Housekeeping Agent", impl: "IMPLEMENTED", domain: "operations", ver: "PARTIALLY_VERIFIED" },
    { key: "agent.reception", name: "Reception Agent", impl: "PARTIAL", domain: "operations", ver: "NOT_VERIFIED" },
    { key: "agent.hr", name: "HR Agent", impl: "PARTIAL", domain: "people", ver: "NOT_VERIFIED" },
    { key: "agent.procurement", name: "Procurement Agent", impl: "IMPLEMENTED", domain: "supply", ver: "PARTIALLY_VERIFIED" },
    { key: "agent.marketing", name: "Marketing Agent", impl: "CATALOG_ONLY", domain: "growth", ver: "NOT_VERIFIED" },
    { key: "agent.guest", name: "Guest Agent", impl: "IMPLEMENTED", domain: "guest", ver: "PARTIALLY_VERIFIED" },
    { key: "agent.concierge", name: "Concierge Agent", impl: "CATALOG_ONLY", domain: "guest", ver: "NOT_VERIFIED" },
    { key: "agent.restaurant", name: "Restaurant Agent", impl: "CATALOG_ONLY", domain: "fb", ver: "NOT_VERIFIED" },
    { key: "agent.spa", name: "Spa Agent", impl: "CATALOG_ONLY", domain: "wellness", ver: "NOT_VERIFIED" },
    { key: "agent.security", name: "Hotel facility security", impl: "PARTIAL", domain: "physical-security", ver: "NOT_VERIFIED" },
    { key: "agent.maintenance", name: "Maintenance Agent", impl: "IMPLEMENTED", domain: "operations", ver: "PARTIALLY_VERIFIED" },
    { key: "agent.legal", name: "Hotel legal/compliance", impl: "PARTIAL", domain: "compliance", ver: "NOT_VERIFIED" },
    { key: "agent.analytics", name: "Analytics Agent", impl: "CATALOG_ONLY", domain: "intelligence", ver: "NOT_VERIFIED" },
    { key: "agent.sales", name: "Sales Agent", impl: "CATALOG_ONLY", domain: "growth", ver: "NOT_VERIFIED" },
    { key: "agent.correspondence", name: "Correspondence Agent", impl: "IMPLEMENTED", domain: "communications", ver: "PARTIALLY_VERIFIED" },
    { key: "agent.meeting_secretary", name: "Meeting Secretary", impl: "IMPLEMENTED", domain: "meetings", ver: "PARTIALLY_VERIFIED" },
    { key: "agent.site", name: "HotelOS Sentinel (site)", impl: "IMPLEMENTED", domain: "platform-security", ver: "PARTIALLY_VERIFIED" },
  ];

  hos.forEach((row, i) => {
    sourceAgents.push(
      agent({
        seq: 200 + i,
        applicationId: APP.hotelos,
        sourceKey: row.key,
        displayName: row.name,
        implementationClass: row.impl,
        verificationStatus: row.ver,
        provenance: prov({
          applicationId: APP.hotelos,
          repo: "github/hotelOS-AI-main",
          branch: "feat/separate-hotel-doors",
          commit: COMMITS.hotelos,
          path: "packages/database/src/catalog/agent-catalog.ts",
          pkg: "@hotelos/database",
          symbol: row.key,
          sourceType: row.impl === "CATALOG_ONLY" ? "CATALOG" : "AGENT",
          originalStatus: row.impl === "CATALOG_ONLY" ? "PLANNED" : "ACTIVE",
          atlasClassification: `hotelos-${row.domain}`,
        }),
        purpose: `HotelOS specialist ${row.key}. Source Impl. tag is a claim, not live runtime proof.`,
        domain: row.domain,
        notes: "APPLICATION_SPECIFIC PMS/HITL. atlasPromotionBlocked.",
      }),
    );
  });

  sourceAgents.push(
    agent({
      seq: 300,
      applicationId: APP.caseflow,
      sourceKey: "CF-IDENTITY-CATALOG",
      displayName: "CaseFlow identity catalog (984 cards)",
      implementationClass: "IDENTITY_CARD",
      verificationStatus: "VERIFIED",
      provenance: prov({
        applicationId: APP.caseflow,
        repo: "github/CaseFlow-AI-main",
        branch: "main",
        commit: COMMITS.caseflow,
        path: "apps/server/src/services/agentCatalog.js",
        pkg: "caseflow-ai-server",
        symbol: "buildCatalog",
        sourceType: "IDENTITY_CARD",
        originalStatus: "ACTIVE",
        atlasClassification: "identity-catalog-not-agents",
      }),
      purpose: "Identity cards across personal/tool/law/drafter/simCourt/simArb/platform. Not 984 codebases.",
      domain: "catalog",
      notes: "DO_NOT_IMPORT as Atlas agents.",
    }),
  );

  const cfTools: ReadonlyArray<{ key: string; name: string; impl: PortfolioSourceAgent["implementationClass"]; path: string; symbol: string }> = [
    { key: "CF-AG-001", name: "Office personal agent", impl: "IMPLEMENTED", path: "apps/server/src/services/jurisdiction/personalAgentService.js", symbol: "personalAgentService" },
    { key: "CF-AG-004", name: "Legal chat", impl: "IMPLEMENTED", path: "apps/server/src/services/ai/governedAgentCall.js", symbol: "governedAgentCall" },
    { key: "CF-AG-007", name: "Legal draft", impl: "IMPLEMENTED", path: "apps/server/src/legal/agentToolPolicy.js", symbol: "assertAgentToolAllowed" },
    { key: "CF-AG-009", name: "Hallucination validator hook", impl: "STUB", path: "apps/server/src/services/ai/governedAgentCall.js", symbol: "hallucinationDetector" },
    { key: "CF-AG-010", name: "Wargame adversary", impl: "IMPLEMENTED", path: "apps/server/src/services/agentCatalog.js", symbol: "wargame" },
    { key: "CF-AG-011", name: "Autonomous secretary", impl: "IMPLEMENTED", path: "apps/server/src/services/agentCatalog.js", symbol: "autonomousSecretary" },
    { key: "CF-AG-015", name: "Jurisdiction research factory", impl: "IMPLEMENTED", path: "apps/server/src/services/jurisdiction/jurisdictionAgentService.js", symbol: "jurisdictionAgentService" },
    { key: "CF-AG-016", name: "Drafter factory", impl: "IMPLEMENTED", path: "apps/server/src/services/virtualCourt/createJurisdictionAgentService.js", symbol: "createJurisdictionAgentService" },
    { key: "CF-AG-033", name: "Collaboration stubs (033–038)", impl: "STUB", path: "apps/server/src/services/agentCatalog.js", symbol: "PLATFORM_AGENTS" },
    { key: "CF-AG-042", name: "Ops cyber doctor", impl: "IMPLEMENTED", path: "apps/server/src/services/agentCatalog.js", symbol: "cyberDoctorService" },
    { key: "CF-AG-043", name: "Supervisor", impl: "IMPLEMENTED", path: "apps/server/src/services/agentCatalog.js", symbol: "supervisorService" },
  ];

  cfTools.forEach((row, i) => {
    sourceAgents.push(
      agent({
        seq: 301 + i,
        applicationId: APP.caseflow,
        sourceKey: row.key,
        displayName: row.name,
        implementationClass: row.impl,
        verificationStatus: row.impl === "STUB" ? "NOT_VERIFIED" : "PARTIALLY_VERIFIED",
        provenance: prov({
          applicationId: APP.caseflow,
          repo: "github/CaseFlow-AI-main",
          branch: "main",
          commit: COMMITS.caseflow,
          path: row.path,
          pkg: "caseflow-ai-server",
          symbol: row.symbol,
          sourceType: row.impl === "STUB" ? "PROMPT" : "AGENT",
          originalStatus: row.impl === "STUB" ? "PLANNED" : "ACTIVE",
          atlasClassification: "caseflow-legal-ops",
        }),
        purpose: row.name,
        domain: "legal-ops",
        notes: "Fail-open if agents table missing is a policy conflict with Atlas fail-closed. Do not import that policy.",
      }),
    );
  });

  const lex: ReadonlyArray<{ key: string; name: string; impl: PortfolioSourceAgent["implementationClass"] }> = [
    { key: "LEX-AG-001", name: "Personal Learning Agent", impl: "IMPLEMENTED" },
    { key: "LEX-AG-002", name: "Virtual court orchestrator", impl: "IMPLEMENTED" },
    { key: "LEX-AG-003", name: "Opponent (standalone)", impl: "PARTIAL" },
    { key: "LEX-AG-004", name: "Scoring Agent", impl: "IMPLEMENTED" },
    { key: "LEX-AG-011", name: "Legal Genius (non-US)", impl: "IMPLEMENTED" },
    { key: "LEX-AG-012", name: "US Law Genius", impl: "IMPLEMENTED" },
    { key: "LEX-AG-016", name: "Legal RAG Q&A", impl: "IMPLEMENTED" },
    { key: "LEX-AG-017", name: "Question factory generator", impl: "IMPLEMENTED" },
    { key: "LEX-AG-018", name: "Question factory validator", impl: "IMPLEMENTED" },
    { key: "LEX-AG-027", name: "AI Quiz Generator UI", impl: "STUB" },
    { key: "LEX-AG-028", name: "CI PR Review Agents", impl: "IMPLEMENTED" },
  ];

  lex.forEach((row, i) => {
    sourceAgents.push(
      agent({
        seq: 400 + i,
        applicationId: APP.lexstudy,
        sourceKey: row.key,
        displayName: row.name,
        implementationClass: row.impl,
        verificationStatus: row.impl === "STUB" ? "NOT_VERIFIED" : "PARTIALLY_VERIFIED",
        provenance: prov({
          applicationId: APP.lexstudy,
          repo: "github/LexStudy-main",
          branch: "main",
          commit: COMMITS.lexstudy,
          path: "docs/agents/LEXSTUDY_AGENT_MASTER_REGISTRY.md",
          pkg: "lexstudy",
          symbol: row.key,
          sourceType: row.impl === "STUB" ? "PROMPT" : "AGENT",
          originalStatus: row.impl === "STUB" ? "PLANNED" : "ACTIVE",
          atlasClassification: "lexstudy-legal-education",
        }),
        purpose: row.name,
        domain: "legal-education",
        notes: row.key === "LEX-AG-003" ? "FUNCTIONALLY_DUPLICATE of a LEX-AG-002 phase." : "APPLICATION_SPECIFIC exams/court sim.",
      }),
    );
  });

  sourceAgents.push(
    agent({
      seq: 450,
      applicationId: APP.civio,
      sourceKey: "CIV-AG-001",
      displayName: "Civio Civic Rights Agent",
      implementationClass: "IMPLEMENTED",
      verificationStatus: "VERIFIED",
      provenance: prov({
        applicationId: APP.civio,
        repo: "github.com/relaya17/civio",
        branch: "main",
        commit: COMMITS.civio,
        path: "packages/logic/src/housing-agent/answerEngine.ts",
        pkg: "@repo/logic",
        symbol: "answerHousingQuestion",
        sourceType: "AGENT",
        originalStatus: "ACTIVE",
        atlasClassification: "civic-rights-grounded-answer",
      }),
      purpose: "Answer civic and public-housing questions from a reviewed rights catalog with cited sources and a fixed disclaimer.",
      domain: "civic-rights",
      notes: "KB-first with optional Gemini phrasing. Source runtime remains external and is never executed by portfolio governance.",
    }),
    agent({
      seq: 451,
      applicationId: APP.civio,
      sourceKey: "CIV-AG-002",
      displayName: "Civio Legal AI Services",
      implementationClass: "IMPLEMENTED",
      verificationStatus: "PARTIALLY_VERIFIED",
      provenance: prov({
        applicationId: APP.civio,
        repo: "github.com/relaya17/civio",
        branch: "main",
        commit: COMMITS.civio,
        path: "apps/server/src/routes/ai.ts",
        pkg: "server",
        symbol: "aiRouter",
        sourceType: "AGENT",
        originalStatus: "ACTIVE",
        atlasClassification: "legal-ai-source-routes",
      }),
      purpose: "Authenticated legal Q&A, contract review, and text improvement backed by Civio knowledge and Gemini.",
      domain: "legal-services",
      notes: "External provider calls and Civio authentication stay source-specific. No source authority is inherited by Atlas.",
    }),
  );

  const canonicalCapabilities: PortfolioCanonicalCapability[] = FABRIC_AGENT_IDS.map((id, i) => ({
    id: uid(800 + i),
    key: id,
    title: FABRIC_AGENT_CATALOG[id].title,
    kind: "FABRIC_RUNTIME",
    fabricAgentId: id,
    notes: "Existing Atlas fabric specialist. Catalog status LAB. Not a source import.",
  }));

  canonicalCapabilities.push(
    {
      id: uid(830),
      key: "KNOWLEDGE_NO_INVENT_FINANCIALS",
      title: "Do not invent financial amounts or tax identifiers",
      kind: "KNOWLEDGE_ONLY",
      fabricAgentId: null,
      notes: "Candidate knowledge. Not ingested. Not a Finance Agent.",
    },
    {
      id: uid(831),
      key: "KNOWLEDGE_CONFIRM_BEFORE_SEND",
      title: "Do not send communications without explicit UI confirmation",
      kind: "KNOWLEDGE_ONLY",
      fabricAgentId: null,
      notes: "Context-specific workflows remain source-specific.",
    },
    {
      id: uid(832),
      key: "KNOWLEDGE_NO_SELF_VALIDATE",
      title: "Generator must not self-approve",
      kind: "KNOWLEDGE_ONLY",
      fabricAgentId: null,
      notes: "Complements Atlas cannotSelfValidate / JUDGE.",
    },
    {
      id: uid(833),
      key: "KNOWLEDGE_OFFICIAL_LEGAL_HOSTS",
      title: "Cite official legal hosts only",
      kind: "KNOWLEDGE_ONLY",
      fabricAgentId: null,
      notes: "URL lists differ across repos — CONFLICT until diff. Do not merge silently.",
    },
  );

  const canonByKey = Object.fromEntries(
    canonicalCapabilities.map((c) => [c.key, c.id]),
  ) as Record<string, string>;

  const capabilities: PortfolioCapability[] = [];
  const permissions: PortfolioPermission[] = [];
  let capSeq = 500;
  let permSeq = 900;

  function addCap(input: {
    sourceAgentId: string;
    name: string;
    purpose: string;
    domain: string;
    inputs?: string;
    outputs?: string;
    tools?: string[];
    sideEffects?: PortfolioCapability["sideEffects"];
    readAccess?: string[];
    writeAccess?: string[];
    externalCommunication?: PortfolioCapability["externalCommunication"];
    externalAuthority?: boolean;
    dependencies?: string[];
    applicationContext?: string;
    authority: PortfolioCapability["sourceAuthority"];
    applicationSpecific: boolean;
    canonicalKey: string | null;
  }): string {
    const id = uid(capSeq++);
    capabilities.push({
      id,
      sourceAgentId: input.sourceAgentId,
      name: input.name,
      purpose: input.purpose,
      domain: input.domain,
      inputs: input.inputs ?? "source-application context",
      outputs: input.outputs ?? "source-application output",
      tools: input.tools ?? [],
      sideEffects: input.sideEffects ?? [],
      readAccess: input.readAccess ?? [],
      writeAccess: input.writeAccess ?? [],
      externalCommunication: input.externalCommunication ?? [],
      externalAuthority: input.externalAuthority ?? false,
      dependencies: input.dependencies ?? [],
      applicationContext: input.applicationContext ?? "",
      sourceAuthority: input.authority,
      applicationSpecific: input.applicationSpecific,
      scope: input.applicationSpecific ? "APPLICATION_SPECIFIC" : "UNIQUE",
      canonicalCapabilityId: input.canonicalKey ? (canonByKey[input.canonicalKey] ?? null) : null,
    });
    return id;
  }

  const byKey = Object.fromEntries(sourceAgents.map((a) => [a.sourceKey, a]));

  const civioRights = byKey["CIV-AG-001"]!;
  const civioRightsCap = addCap({
    sourceAgentId: civioRights.id,
    name: "civio-verified-rights-answer",
    purpose: "Retrieve reviewed Israeli civic-rights guidance with official source links and disclaimers",
    domain: "civic-rights",
    inputs: "Hebrew civic-rights or public-housing question",
    outputs: "grounded answer, confidence, matched topics, sources, disclaimer",
    tools: ["searchHousingKnowledgeBase", "answerHousingQuestion"],
    sideEffects: [],
    readAccess: ["RIGHTS_ITEMS", "LEGAL_FOUNDATIONS", "published-rights"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["@repo/logic/housing-agent"],
    applicationContext: "Civio civic-rights guidance; informational only, not legal advice",
    authority: "READ",
    applicationSpecific: false,
    canonicalKey: "LEGAL_MEDIA_COMMS",
  });
  permissions.push({
    id: uid(permSeq++),
    sourceAgentId: civioRights.id,
    sourceAuthority: "READ",
    description: "Reads Civio's reviewed rights catalog. Atlas inheritance NONE; only the approved snapshot is available to scoped agents.",
    atlasInheritance: "NONE",
  });

  const civioLegalAi = byKey["CIV-AG-002"]!;
  addCap({
    sourceAgentId: civioLegalAi.id,
    name: "civio-legal-ai-routes",
    purpose: "Generate legal-information responses and contract review through authenticated Civio routes",
    domain: "legal-services",
    inputs: "authenticated text, question, or contract",
    outputs: "draft, structured contract scan, or legal-information response",
    tools: ["aiRouter", "getAgentCatalog", "Gemini"],
    sideEffects: ["EXTERNAL_CALL"],
    readAccess: ["published-rights", "LEGAL_FOUNDATIONS", "request-content"],
    writeAccess: [],
    externalCommunication: ["HTTP_CALL"],
    externalAuthority: true,
    dependencies: ["Civio auth", "Gemini API", "Civio rights catalog"],
    applicationContext: "Civio authenticated AI services; provider execution remains inside Civio",
    authority: "EXTERNAL_SOURCE",
    applicationSpecific: true,
    canonicalKey: null,
  });
  permissions.push({
    id: uid(permSeq++),
    sourceAgentId: civioLegalAi.id,
    sourceAuthority: "EXTERNAL_SOURCE",
    description: "Civio may call its configured AI provider. Atlas inheritance NONE and Atlas never receives provider credentials.",
    atlasInheritance: "NONE",
  });

  const vone = byKey["VAN-AG-001"]!;
  addCap({
    sourceAgentId: vone.id,
    name: "resident-chat-tools",
    purpose: "Balance/tickets/faults/reminders for property residents",
    domain: "property-ops",
    inputs: "resident query, tenant context",
    outputs: "response, ticket ID, reminder confirmation",
    tools: ["createTicket", "createReminder", "getBalance"],
    sideEffects: ["STATE_MUTATION", "DB_WRITE"],
    readAccess: ["tenant-balance", "ticket-history", "reminder-history"],
    writeAccess: ["tickets", "reminders"],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["vantera-db", "tenant-context"],
    applicationContext: "Vantera property management — resident-facing chat interface",
    authority: "WRITE_SOURCE",
    applicationSpecific: true,
    canonicalKey: null,
  });
  permissions.push({
    id: uid(permSeq++),
    sourceAgentId: vone.id,
    sourceAuthority: "WRITE_SOURCE",
    description: "Source may write maintenance tickets and reminders. Atlas inheritance NONE.",
    atlasInheritance: "NONE",
  });

  const med = byKey["MEDIATOR_AGENT"]!;
  addCap({
    sourceAgentId: med.id,
    name: "desk-intent-route",
    purpose: "Route Hebrew ops intents without store mutation",
    domain: "orchestration",
    inputs: "Hebrew user query",
    outputs: "routed intent, specialist response",
    tools: ["resolveDeals", "accountingDraft", "whatsappPreview"],
    sideEffects: [],
    readAccess: ["deals", "broker-context"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["deals-store", "accounting-agent", "communication-agent"],
    applicationContext: "BrokerOS desk — Hebrew-speaking broker operations orchestrator",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: "ORCHESTRATOR",
  });

  const acc = byKey["ACCOUNTING_AGENT"]!;
  const accCap = addCap({
    sourceAgentId: acc.id,
    name: "invoice-draft-no-invent",
    purpose: "Draft invoice from deal data only — never invent amounts",
    domain: "finance",
    inputs: "deal ID, deal data",
    outputs: "invoice draft (not persisted)",
    tools: ["getDeal", "formatInvoice"],
    sideEffects: [],
    readAccess: ["deals", "invoice-templates"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["deals-store"],
    applicationContext: "BrokerOS accounting — draft-only, broker must confirm before persist",
    authority: "GENERATE",
    applicationSpecific: true,
    canonicalKey: "KNOWLEDGE_NO_INVENT_FINANCIALS",
  });
  permissions.push({
    id: uid(permSeq++),
    sourceAgentId: acc.id,
    sourceAuthority: "GENERATE",
    description: "Generate draft only. Source WRITE is invoices.create after broker confirm — not this agent.",
    atlasInheritance: "NONE",
  });

  const comm = byKey["COMMUNICATION_AGENT"]!;
  addCap({
    sourceAgentId: comm.id,
    name: "preview-not-send",
    purpose: "WhatsApp/accountant preview — never auto-sends",
    domain: "messaging",
    inputs: "deal context, message template",
    outputs: "preview text (not sent)",
    tools: ["whatsappPreview", "accountantLetterPreview"],
    sideEffects: [],
    readAccess: ["deals", "message-templates", "contact-info"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["deals-store", "templates"],
    applicationContext: "BrokerOS comms — preview only, UI sends after broker click",
    authority: "GENERATE",
    applicationSpecific: true,
    canonicalKey: "KNOWLEDGE_CONFIRM_BEFORE_SEND",
  });
  permissions.push({
    id: uid(permSeq++),
    sourceAgentId: comm.id,
    sourceAuthority: "EXTERNAL_SOURCE",
    description: "Source UI may send after click. This agent never sends. Atlas inheritance NONE.",
    atlasInheritance: "NONE",
  });

  const site = byKey["agent.site"]!;
  addCap({
    sourceAgentId: site.id,
    name: "platform-sentinel",
    purpose: "HotelOS platform security watcher — monitors infra, not physical doors",
    domain: "platform-security",
    inputs: "platform events, logs",
    outputs: "security alerts, anomaly reports",
    tools: ["monitorLogs", "detectAnomalies"],
    sideEffects: [],
    readAccess: ["platform-logs", "infra-metrics", "alert-history"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["platform-logs", "infra-metrics"],
    applicationContext: "HotelOS platform — software infrastructure monitoring only",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: "SECURITY",
  });

  const hosSec = byKey["agent.security"]!;
  addCap({
    sourceAgentId: hosSec.id,
    name: "facility-vms",
    purpose: "Physical VMS/doors control — NOT software AuthZ",
    domain: "physical-security",
    inputs: "door events, VMS feeds",
    outputs: "access decisions, alerts",
    tools: ["checkDoorAccess", "reviewVMS"],
    sideEffects: [],
    readAccess: ["vms-feeds", "door-events", "access-logs"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: true,
    dependencies: ["vms-api", "door-controllers"],
    applicationContext: "HotelOS facility — physical building security, NOT software AuthZ",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const hosLegal = byKey["agent.legal"]!;
  addCap({
    sourceAgentId: hosLegal.id,
    name: "hotel-compliance-cite",
    purpose: "Internal policy + official legal citation",
    domain: "compliance",
    inputs: "legal query, jurisdiction",
    outputs: "policy summary, citations",
    tools: ["searchPolicy", "citeLegalSource"],
    sideEffects: [],
    readAccess: ["policy-db", "legal-sources", "jurisdiction-rules"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["policy-db", "legal-sources"],
    applicationContext: "HotelOS legal — hotel-specific compliance and citation",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: "LEGAL_MEDIA_COMMS",
  });

  const corr = byKey["agent.correspondence"]!;
  addCap({
    sourceAgentId: corr.id,
    name: "drafts-no-autosend",
    purpose: "Correspondence drafts only — requires human confirmation to send",
    domain: "communications",
    inputs: "recipient, template, context",
    outputs: "draft message",
    tools: ["draftEmail", "draftLetter"],
    sideEffects: [],
    readAccess: ["templates", "guest-data", "booking-context"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["templates", "guest-data"],
    applicationContext: "HotelOS correspondence — guest-facing, human-confirmed sends",
    authority: "GENERATE",
    applicationSpecific: true,
    canonicalKey: "KNOWLEDGE_CONFIRM_BEFORE_SEND",
  });

  const cio = byKey["agent.cio"]!;
  addCap({
    sourceAgentId: cio.id,
    name: "hotel-front-door",
    purpose: "CIO orchestrator over hotel specialists",
    domain: "intelligence",
    inputs: "user query, context",
    outputs: "routed response from specialists",
    tools: ["routeToSpecialist", "aggregateResponses"],
    sideEffects: [],
    readAccess: ["specialist-registry", "routing-rules"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["hotel-specialists"],
    applicationContext: "HotelOS CIO — orchestrates hotel specialists, no direct action",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: "ORCHESTRATOR",
  });

  const cards = byKey["CF-IDENTITY-CATALOG"]!;
  addCap({
    sourceAgentId: cards.id,
    name: "identity-cards",
    purpose: "984 identity cards — not 984 agents",
    domain: "catalog",
    inputs: "card query",
    outputs: "card metadata",
    tools: ["lookupCard"],
    sideEffects: [],
    readAccess: ["identity-card-registry"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: [],
    applicationContext: "CaseFlow identity catalog — persona cards, NOT executable agents",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const cyber = byKey["CF-AG-042"]!;
  addCap({
    sourceAgentId: cyber.id,
    name: "cyber-doctor-propose",
    purpose: "Propose ops findings, never write filesystem",
    domain: "security",
    inputs: "system state, logs",
    outputs: "findings, recommendations",
    tools: ["analyzeSecurityState", "proposeRemediations"],
    sideEffects: [],
    readAccess: ["system-logs", "vulnerability-db", "security-rules"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["system-logs", "vulnerability-db"],
    applicationContext: "CaseFlow cyber ops — propose only, no filesystem writes",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: "SECURITY",
  });

  const wargame = byKey["CF-AG-010"]!;
  addCap({
    sourceAgentId: wargame.id,
    name: "office-wargame",
    purpose: "Adversary simulation on a case",
    domain: "legal-ops",
    inputs: "case data, simulation params",
    outputs: "adversary arguments, weaknesses",
    tools: ["simulateOpponent", "findWeaknesses"],
    sideEffects: [],
    readAccess: ["case-data", "legal-precedents"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["case-data"],
    applicationContext: "CaseFlow legal ops — adversary simulation for case strategy",
    authority: "GENERATE",
    applicationSpecific: true,
    canonicalKey: "ADVERSARY",
  });

  const val = byKey["CF-AG-009"]!;
  addCap({
    sourceAgentId: val.id,
    name: "hallucination-hook",
    purpose: "Validator hook on governed calls — catches hallucinations",
    domain: "validation",
    inputs: "agent output, context",
    outputs: "validation result, flags",
    tools: ["validateClaims", "checkHallucination"],
    sideEffects: [],
    readAccess: ["knowledge-base", "validation-rules"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["knowledge-base"],
    applicationContext: "CaseFlow validation — hallucination checker for governed calls",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: "JUDGE",
  });

  const lexVal = byKey["LEX-AG-018"]!;
  addCap({
    sourceAgentId: lexVal.id,
    name: "question-validator",
    purpose: "Independent validation; rejects generator self-approval",
    domain: "legal-education",
    inputs: "generated question, expected answer",
    outputs: "validation result, feedback",
    tools: ["validateQuestion", "checkAccuracy"],
    sideEffects: [],
    readAccess: ["legal-knowledge", "question-templates"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["legal-knowledge"],
    applicationContext: "LexStudy validation — portable no-self-validate pattern",
    authority: "READ",
    applicationSpecific: false,
    canonicalKey: "KNOWLEDGE_NO_SELF_VALIDATE",
  });

  const lexOpp = byKey["LEX-AG-003"]!;
  addCap({
    sourceAgentId: lexOpp.id,
    name: "court-opponent",
    purpose: "Standalone opponent overlapping orchestrator phase",
    domain: "legal-education",
    inputs: "case scenario, user arguments",
    outputs: "counter-arguments, objections",
    tools: ["generateCounterArgument", "raiseObjection"],
    sideEffects: [],
    readAccess: ["legal-knowledge", "case-context", "precedent-db"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["legal-knowledge", "case-context"],
    applicationContext: "LexStudy court simulation — standalone opponent for training",
    authority: "GENERATE",
    applicationSpecific: true,
    canonicalKey: "ADVERSARY",
  });

  const lexCi = byKey["LEX-AG-028"]!;
  addCap({
    sourceAgentId: lexCi.id,
    name: "ci-pr-review",
    purpose: "CI-only security/architecture/performance review",
    domain: "devops",
    inputs: "PR diff, code context",
    outputs: "review comments, findings",
    tools: ["analyzeCode", "checkSecurity", "reviewArchitecture"],
    sideEffects: [],
    readAccess: ["pr-diff", "codebase", "security-rules"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["codebase", "security-rules"],
    applicationContext: "LexStudy CI pipeline — automated PR review, no merge authority",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: "SECURITY",
  });

  const vanKnow = byKey["VAN-AG-003"]!;
  addCap({
    sourceAgentId: vanKnow.id,
    name: "vantera-named-atlas-knowledge",
    purpose: "Lexical knowledge named Atlas — NAME COLLISION with taqonu Atlas",
    domain: "knowledge",
    inputs: "knowledge query",
    outputs: "knowledge response",
    tools: ["queryKnowledge"],
    sideEffects: [],
    readAccess: ["vantera-knowledge-base"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["vantera-knowledge-base"],
    applicationContext: "Vantera knowledge agent — NAME COLLISION: 'Atlas' in Vantera ≠ taqonu Atlas",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: "LEGAL_MEDIA_COMMS",
  });

  // === GAP CLOSURE: Missing capabilities for IMPLEMENTED/PARTIAL agents ===

  // BrokerOS: TRANSACTION_AGENT
  const txAgent = byKey["TRANSACTION_AGENT"]!;
  addCap({
    sourceAgentId: txAgent.id,
    name: "deal-resolution",
    purpose: "Find/open/continue deals from office store without inventing IDs",
    domain: "deals",
    inputs: "deal query, client context",
    outputs: "deal records, deal status",
    tools: ["resolveDeals", "findDeal", "getDealStatus"],
    sideEffects: [],
    readAccess: ["deals-store", "client-records"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["deals-store", "client-service"],
    applicationContext: "BrokerOS deals — application-specific Deal/Client schemas",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  // Vantera: VAN-AG-002 (Ventos)
  const ventos = byKey["VAN-AG-002"]!;
  addCap({
    sourceAgentId: ventos.id,
    name: "tenant-executive-snapshot",
    purpose: "Tenant executive snapshot + lexical knowledge concat, not an LLM tool loop",
    domain: "executive",
    inputs: "tenant ID, snapshot params",
    outputs: "executive summary, knowledge concat",
    tools: ["collectTenantSnapshot", "concatKnowledge"],
    sideEffects: [],
    readAccess: ["tenant-data", "knowledge-base"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["tenant-service", "knowledge-service"],
    applicationContext: "Vantera executive — blocks money-movement phrases, partial implementation",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  // HotelOS IMPLEMENTED agents
  const kashrut = byKey["agent.kashrut"]!;
  addCap({
    sourceAgentId: kashrut.id,
    name: "kashrut-compliance",
    purpose: "Kashrut supervision and dietary compliance monitoring",
    domain: "compliance",
    inputs: "menu items, supplier data, kitchen status",
    outputs: "compliance status, alerts",
    tools: ["checkKashrutStatus", "reviewSupplier"],
    sideEffects: [],
    readAccess: ["menu-db", "supplier-records", "kitchen-logs"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["menu-service", "supplier-service"],
    applicationContext: "HotelOS kashrut — hotel-specific dietary compliance",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const cfo = byKey["agent.cfo"]!;
  addCap({
    sourceAgentId: cfo.id,
    name: "hotel-financial-oversight",
    purpose: "CFO financial oversight and reporting for hotel operations",
    domain: "finance",
    inputs: "financial queries, period params",
    outputs: "financial reports, metrics",
    tools: ["getFinancialReport", "queryMetrics"],
    sideEffects: [],
    readAccess: ["financial-data", "budget-records", "expense-logs"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["accounting-service", "budget-service"],
    applicationContext: "HotelOS CFO — hotel-specific financial oversight, NOT Atlas finance",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const housekeeping = byKey["agent.housekeeping"]!;
  addCap({
    sourceAgentId: housekeeping.id,
    name: "housekeeping-coordination",
    purpose: "Housekeeping task coordination and room status management",
    domain: "operations",
    inputs: "room status, cleaning requests",
    outputs: "task assignments, status updates",
    tools: ["assignTask", "getRoomStatus", "updateCleaningStatus"],
    sideEffects: [],
    readAccess: ["room-status", "staff-schedules", "task-queue"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["room-service", "staff-service"],
    applicationContext: "HotelOS housekeeping — room operations coordination",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const guest = byKey["agent.guest"]!;
  addCap({
    sourceAgentId: guest.id,
    name: "guest-services",
    purpose: "Guest service requests and preference management",
    domain: "guest",
    inputs: "guest ID, service request",
    outputs: "service response, preference data",
    tools: ["getGuestPreferences", "processServiceRequest"],
    sideEffects: [],
    readAccess: ["guest-profiles", "booking-data", "preference-history"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["guest-service", "booking-service"],
    applicationContext: "HotelOS guest — guest-facing service coordination",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const procurement = byKey["agent.procurement"]!;
  addCap({
    sourceAgentId: procurement.id,
    name: "procurement-management",
    purpose: "Procurement tracking and supplier management",
    domain: "supply",
    inputs: "procurement query, supplier params",
    outputs: "procurement status, supplier info",
    tools: ["trackOrder", "querySupplier", "getInventoryLevel"],
    sideEffects: [],
    readAccess: ["procurement-orders", "supplier-db", "inventory-levels"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["procurement-service", "inventory-service"],
    applicationContext: "HotelOS procurement — supply chain monitoring",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const maintenance = byKey["agent.maintenance"]!;
  addCap({
    sourceAgentId: maintenance.id,
    name: "maintenance-tracking",
    purpose: "Maintenance request tracking and facility status",
    domain: "operations",
    inputs: "maintenance request, facility query",
    outputs: "maintenance status, facility reports",
    tools: ["trackMaintenanceRequest", "getFacilityStatus"],
    sideEffects: [],
    readAccess: ["maintenance-tickets", "facility-logs", "equipment-status"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["maintenance-service", "facility-service"],
    applicationContext: "HotelOS maintenance — facility operations tracking",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const meetingSec = byKey["agent.meeting_secretary"]!;
  addCap({
    sourceAgentId: meetingSec.id,
    name: "meeting-coordination",
    purpose: "Meeting scheduling and room booking coordination",
    domain: "meetings",
    inputs: "meeting request, room params",
    outputs: "booking confirmation, schedule info",
    tools: ["scheduleMeeting", "bookRoom", "getAvailability"],
    sideEffects: [],
    readAccess: ["meeting-calendar", "room-availability", "attendee-schedules"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["calendar-service", "room-booking-service"],
    applicationContext: "HotelOS meetings — conference room coordination",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  // HotelOS PARTIAL agents
  const ceo = byKey["agent.ceo"]!;
  addCap({
    sourceAgentId: ceo.id,
    name: "executive-overview",
    purpose: "Executive overview and strategic reporting (PARTIAL implementation)",
    domain: "executive",
    inputs: "executive query",
    outputs: "executive summary",
    tools: ["getExecutiveSummary"],
    sideEffects: [],
    readAccess: ["executive-metrics", "department-reports"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["reporting-service"],
    applicationContext: "HotelOS CEO — partial implementation, executive overview only",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const revenue = byKey["agent.revenue"]!;
  addCap({
    sourceAgentId: revenue.id,
    name: "revenue-analysis",
    purpose: "Revenue analysis and pricing insights (PARTIAL implementation)",
    domain: "revenue",
    inputs: "revenue query, date range",
    outputs: "revenue metrics, pricing data",
    tools: ["getRevenueMetrics", "analyzePricing"],
    sideEffects: [],
    readAccess: ["revenue-data", "pricing-history", "booking-analytics"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["revenue-service", "analytics-service"],
    applicationContext: "HotelOS revenue — partial implementation, analysis only",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const reception = byKey["agent.reception"]!;
  addCap({
    sourceAgentId: reception.id,
    name: "reception-support",
    purpose: "Reception desk support and check-in assistance (PARTIAL implementation)",
    domain: "operations",
    inputs: "guest query, booking reference",
    outputs: "booking info, check-in status",
    tools: ["lookupBooking", "getCheckInStatus"],
    sideEffects: [],
    readAccess: ["booking-records", "guest-info", "room-assignments"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["booking-service", "room-service"],
    applicationContext: "HotelOS reception — partial implementation, lookup only",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const hr = byKey["agent.hr"]!;
  addCap({
    sourceAgentId: hr.id,
    name: "hr-queries",
    purpose: "HR information queries (PARTIAL implementation)",
    domain: "people",
    inputs: "HR query, employee context",
    outputs: "HR information, policy data",
    tools: ["queryHRInfo", "getPolicyInfo"],
    sideEffects: [],
    readAccess: ["hr-policies", "employee-directory"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["hr-service"],
    applicationContext: "HotelOS HR — partial implementation, read-only queries",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  // CaseFlow IMPLEMENTED agents
  const cfPersonal = byKey["CF-AG-001"]!;
  addCap({
    sourceAgentId: cfPersonal.id,
    name: "office-personal-agent",
    purpose: "Personal agent for office case management",
    domain: "legal-ops",
    inputs: "case query, user context",
    outputs: "case info, task recommendations",
    tools: ["getCaseInfo", "suggestTasks"],
    sideEffects: [],
    readAccess: ["case-data", "user-tasks", "office-calendar"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["case-service", "task-service"],
    applicationContext: "CaseFlow personal — office-specific case assistant",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const cfLegalChat = byKey["CF-AG-004"]!;
  addCap({
    sourceAgentId: cfLegalChat.id,
    name: "legal-chat-governed",
    purpose: "Legal chat with governed agent calls",
    domain: "legal-ops",
    inputs: "legal query, case context",
    outputs: "legal response, citations",
    tools: ["governedAgentCall", "getLegalInfo"],
    sideEffects: [],
    readAccess: ["legal-knowledge", "case-context", "precedents"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["legal-service", "governance-service"],
    applicationContext: "CaseFlow legal chat — governed responses with tool policy",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const cfLegalDraft = byKey["CF-AG-007"]!;
  addCap({
    sourceAgentId: cfLegalDraft.id,
    name: "legal-draft-policy",
    purpose: "Legal document drafting with tool policy enforcement",
    domain: "legal-ops",
    inputs: "draft request, case data",
    outputs: "draft document",
    tools: ["assertAgentToolAllowed", "generateDraft"],
    sideEffects: [],
    readAccess: ["case-data", "document-templates", "legal-rules"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["document-service", "policy-service"],
    applicationContext: "CaseFlow drafting — tool policy enforced, no direct file writes",
    authority: "GENERATE",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const cfLegalGenius = byKey["CF-AG-011"]!;
  addCap({
    sourceAgentId: cfLegalGenius.id,
    name: "autonomous-secretary",
    purpose: "Autonomous secretary for case management",
    domain: "legal-ops",
    inputs: "secretary task, case context",
    outputs: "task completion, notifications",
    tools: ["processTask", "notifyParties"],
    sideEffects: [],
    readAccess: ["case-data", "party-info", "task-queue"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["case-service", "notification-service"],
    applicationContext: "CaseFlow autonomous — case task automation",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const cfJurisdiction = byKey["CF-AG-015"]!;
  addCap({
    sourceAgentId: cfJurisdiction.id,
    name: "jurisdiction-research",
    purpose: "Jurisdiction research factory for legal queries",
    domain: "legal-ops",
    inputs: "jurisdiction query, legal question",
    outputs: "jurisdiction analysis, applicable law",
    tools: ["researchJurisdiction", "findApplicableLaw"],
    sideEffects: [],
    readAccess: ["jurisdiction-db", "legal-sources", "precedent-db"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["jurisdiction-service", "legal-research-service"],
    applicationContext: "CaseFlow jurisdiction — legal research factory",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const cfDrafter = byKey["CF-AG-016"]!;
  addCap({
    sourceAgentId: cfDrafter.id,
    name: "drafter-factory",
    purpose: "Drafter factory for jurisdiction-specific documents",
    domain: "legal-ops",
    inputs: "draft params, jurisdiction",
    outputs: "drafted document",
    tools: ["createJurisdictionAgent", "generateDocument"],
    sideEffects: [],
    readAccess: ["jurisdiction-rules", "document-templates"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["jurisdiction-service", "document-service"],
    applicationContext: "CaseFlow drafter — jurisdiction-aware document generation",
    authority: "GENERATE",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const cfSupervisor = byKey["CF-AG-043"]!;
  addCap({
    sourceAgentId: cfSupervisor.id,
    name: "supervisor-oversight",
    purpose: "Supervisor oversight for agent operations",
    domain: "legal-ops",
    inputs: "supervision query, agent status",
    outputs: "oversight report, recommendations",
    tools: ["monitorAgents", "reviewOperations"],
    sideEffects: [],
    readAccess: ["agent-logs", "operation-metrics", "compliance-status"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["monitoring-service", "compliance-service"],
    applicationContext: "CaseFlow supervisor — agent operation oversight",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  // LexStudy IMPLEMENTED agents
  const lexPersonal = byKey["LEX-AG-001"]!;
  addCap({
    sourceAgentId: lexPersonal.id,
    name: "personal-learning-agent",
    purpose: "Personal learning agent for legal education",
    domain: "legal-education",
    inputs: "learning query, student context",
    outputs: "learning content, progress tracking",
    tools: ["getLearningContent", "trackProgress"],
    sideEffects: [],
    readAccess: ["course-content", "student-progress", "learning-materials"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["learning-service", "content-service"],
    applicationContext: "LexStudy personal — student-specific learning assistant",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const lexVirtualCourt = byKey["LEX-AG-002"]!;
  addCap({
    sourceAgentId: lexVirtualCourt.id,
    name: "virtual-court-orchestrator",
    purpose: "Virtual court simulation orchestrator",
    domain: "legal-education",
    inputs: "simulation params, case scenario",
    outputs: "simulation flow, participant actions",
    tools: ["orchestrateSimulation", "manageParticipants"],
    sideEffects: [],
    readAccess: ["case-scenarios", "simulation-rules", "participant-roles"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["simulation-service", "role-service"],
    applicationContext: "LexStudy court sim — orchestrates virtual court training",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: "ORCHESTRATOR",
  });

  const lexScoring = byKey["LEX-AG-004"]!;
  addCap({
    sourceAgentId: lexScoring.id,
    name: "scoring-agent",
    purpose: "Scoring agent for legal education assessments",
    domain: "legal-education",
    inputs: "submission, rubric params",
    outputs: "score, feedback",
    tools: ["scoreSubmission", "generateFeedback"],
    sideEffects: [],
    readAccess: ["rubrics", "submission-data", "scoring-criteria"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["scoring-service", "feedback-service"],
    applicationContext: "LexStudy scoring — assessment evaluation",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const lexGeniusNonUS = byKey["LEX-AG-011"]!;
  addCap({
    sourceAgentId: lexGeniusNonUS.id,
    name: "legal-genius-non-us",
    purpose: "Legal Genius for non-US jurisdictions",
    domain: "legal-education",
    inputs: "legal query, jurisdiction",
    outputs: "legal analysis, citations",
    tools: ["analyzeLegalQuestion", "citeSources"],
    sideEffects: [],
    readAccess: ["international-law-db", "jurisdiction-rules", "legal-sources"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["legal-research-service"],
    applicationContext: "LexStudy non-US — international legal education",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const lexGeniusUS = byKey["LEX-AG-012"]!;
  addCap({
    sourceAgentId: lexGeniusUS.id,
    name: "us-law-genius",
    purpose: "US Law Genius for US-specific legal education",
    domain: "legal-education",
    inputs: "legal query, US jurisdiction",
    outputs: "US legal analysis, citations",
    tools: ["analyzeUSLaw", "citeUSPrecedents"],
    sideEffects: [],
    readAccess: ["us-law-db", "us-precedents", "state-laws"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["us-legal-service"],
    applicationContext: "LexStudy US law — US-specific legal education",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const lexRAG = byKey["LEX-AG-016"]!;
  addCap({
    sourceAgentId: lexRAG.id,
    name: "legal-rag-qa",
    purpose: "Legal RAG Q&A for retrieval-augmented legal questions",
    domain: "legal-education",
    inputs: "legal question",
    outputs: "answer with sources",
    tools: ["retrieveContext", "answerQuestion"],
    sideEffects: [],
    readAccess: ["legal-corpus", "case-law", "statutes"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["rag-service", "retrieval-service"],
    applicationContext: "LexStudy RAG — retrieval-augmented legal Q&A",
    authority: "READ",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const lexQuestionGen = byKey["LEX-AG-017"]!;
  addCap({
    sourceAgentId: lexQuestionGen.id,
    name: "question-factory-generator",
    purpose: "Question factory generator for legal assessments",
    domain: "legal-education",
    inputs: "topic, difficulty params",
    outputs: "generated questions",
    tools: ["generateQuestion", "validateDifficulty"],
    sideEffects: [],
    readAccess: ["question-templates", "topic-db", "difficulty-rules"],
    writeAccess: [],
    externalCommunication: [],
    externalAuthority: false,
    dependencies: ["question-service", "validation-service"],
    applicationContext: "LexStudy question gen — assessment question creation",
    authority: "GENERATE",
    applicationSpecific: true,
    canonicalKey: null,
  });

  const knowledgeCanon = Object.fromEntries(
    canonicalCapabilities.filter((c) => c.kind === "KNOWLEDGE_ONLY").map((c) => [c.key, c.id]),
  );

  const evidence: z.input<typeof portfolioEvidenceSchema>[] = applications
    .filter((a) => a.role === "SOURCE")
    .map((a, i) => ({
      id: uid(1000 + i),
      sourceAgentId: null,
      applicationId: a.id,
      capabilityId: null,
      kind: "REGISTRY" as const,
      path:
        a.slug === "brokeros"
          ? "packages/api/src/agent/agent-registry.ts"
          : a.slug === "vantera"
            ? "docs/agents/VANTERA_AGENT_MASTER_REGISTRY.md"
            : a.slug === "hotelos"
              ? "docs/engineering-standard/11-ai-agents/01-HOTELOS-AGENT-REGISTRY.md"
              : a.slug === "caseflow"
                ? "docs/CASEFLOW_AGENT_REGISTRY.md"
                : a.slug === "civio"
                  ? "apps/housing-agent/README.md"
                : "docs/agents/LEXSTUDY_AGENT_MASTER_REGISTRY.md",
      note: "Static inspection of source registry documentation and code. Not live runtime.",
      authorityRank: "ARCHITECTURE_DOCUMENT" as const,
      extractedAt: EXTRACTED_AT,
      isRuntimeProbe: false as const,
    }));

  // Link evidence to specific capabilities
  const deskIntentCap = capabilities.find((c) => c.name === "desk-intent-route");
  evidence.push({
    id: uid(1010),
    sourceAgentId: med.id,
    applicationId: APP.brokeros,
    capabilityId: deskIntentCap?.id ?? null,
    kind: "TEST",
    path: "packages/api/src/agent/orchestrator.test.ts",
    note: "Unit tests for intent routing, drafts, never-claims-send. Evidence ≠ RuntimeStatus.",
    authorityRank: "AUTOMATED_VERIFIED_TEST",
    extractedAt: EXTRACTED_AT,
    isRuntimeProbe: false as const,
  });

  // Add capability-specific evidence for key capabilities
  const residentChatCap = capabilities.find((c) => c.name === "resident-chat-tools");
  if (residentChatCap) {
    evidence.push({
      id: uid(1011),
      sourceAgentId: vone.id,
      applicationId: APP.vantera,
      capabilityId: residentChatCap.id,
      kind: "SOURCE_CODE",
      path: "packages/vone-agent/src/index.ts",
      note: "VONE_TOOLS implementation. Evidence of WRITE_SOURCE (tickets/reminders). Evidence ≠ RuntimeStatus.",
      authorityRank: "SOURCE_CODE",
      extractedAt: EXTRACTED_AT,
      isRuntimeProbe: false as const,
    });
  }

  const invoiceDraftCap = capabilities.find((c) => c.name === "invoice-draft-no-invent");
  if (invoiceDraftCap) {
    evidence.push({
      id: uid(1012),
      sourceAgentId: acc.id,
      applicationId: APP.brokeros,
      capabilityId: invoiceDraftCap.id,
      kind: "SOURCE_CODE",
      path: "packages/api/src/agent/orchestrator.ts",
      note: "accountingDraft function. Evidence of GENERATE authority, no WRITE. Evidence ≠ RuntimeStatus.",
      authorityRank: "SOURCE_CODE",
      extractedAt: EXTRACTED_AT,
      isRuntimeProbe: false as const,
    });
  }

  const platformSentinelCap = capabilities.find((c) => c.name === "platform-sentinel");
  if (platformSentinelCap) {
    evidence.push({
      id: uid(1013),
      sourceAgentId: site.id,
      applicationId: APP.hotelos,
      capabilityId: platformSentinelCap.id,
      kind: "SOURCE_CODE",
      path: "packages/database/src/catalog/agent-catalog.ts",
      note: "agent.site catalog entry. Platform security, NOT physical doors. Evidence ≠ RuntimeStatus.",
      authorityRank: "SOURCE_CODE",
      extractedAt: EXTRACTED_AT,
      isRuntimeProbe: false as const,
    });
  }

  const facilityVmsCap = capabilities.find((c) => c.name === "facility-vms");
  if (facilityVmsCap) {
    evidence.push({
      id: uid(1014),
      sourceAgentId: hosSec.id,
      applicationId: APP.hotelos,
      capabilityId: facilityVmsCap.id,
      kind: "SOURCE_CODE",
      path: "packages/database/src/catalog/agent-catalog.ts",
      note: "agent.security catalog entry. Physical VMS/doors, NOT software AuthZ. Evidence ≠ RuntimeStatus.",
      authorityRank: "SOURCE_CODE",
      extractedAt: EXTRACTED_AT,
      isRuntimeProbe: false as const,
    });
  }

  const hallucinationHookCap = capabilities.find((c) => c.name === "hallucination-hook");
  if (hallucinationHookCap) {
    evidence.push({
      id: uid(1015),
      sourceAgentId: val.id,
      applicationId: APP.caseflow,
      capabilityId: hallucinationHookCap.id,
      kind: "SOURCE_CODE",
      path: "apps/server/src/services/ai/governedAgentCall.js",
      note: "hallucinationDetector in governed calls. STUB implementation. Evidence ≠ RuntimeStatus.",
      authorityRank: "SOURCE_CODE",
      extractedAt: EXTRACTED_AT,
      isRuntimeProbe: false as const,
    });
  }

  const questionValidatorCap = capabilities.find((c) => c.name === "question-validator");
  if (questionValidatorCap) {
    evidence.push({
      id: uid(1016),
      sourceAgentId: lexVal.id,
      applicationId: APP.lexstudy,
      capabilityId: questionValidatorCap.id,
      kind: "SOURCE_CODE",
      path: "docs/agents/LEXSTUDY_AGENT_MASTER_REGISTRY.md",
      note: "LEX-AG-018 registry entry. Portable no-self-validate pattern. Evidence ≠ RuntimeStatus.",
      authorityRank: "ARCHITECTURE_DOCUMENT",
      extractedAt: EXTRACTED_AT,
      isRuntimeProbe: false as const,
    });
  }

  evidence.push(
    {
      id: uid(1017),
      sourceAgentId: civioRights.id,
      applicationId: APP.civio,
      capabilityId: civioRightsCap,
      kind: "SOURCE_CODE",
      path: "packages/logic/src/housing-agent/answerEngine.ts",
      note: "KB-first answer engine with source citations, confidence labels, and fixed legal disclaimer.",
      authorityRank: "SOURCE_CODE",
      extractedAt: EXTRACTED_AT,
      isRuntimeProbe: false as const,
    },
    {
      id: uid(1018),
      sourceAgentId: civioRights.id,
      applicationId: APP.civio,
      capabilityId: civioRightsCap,
      kind: "TEST",
      path: "apps/housing-agent/src/lib/answerEngine.test.ts",
      note: "Tests KB fallback, source formatting, and the mandatory not-legal-advice disclaimer.",
      authorityRank: "AUTOMATED_VERIFIED_TEST",
      extractedAt: EXTRACTED_AT,
      isRuntimeProbe: false as const,
    },
  );

  const orchCanon = canonByKey["ORCHESTRATOR"]!;
  const secCanon = canonByKey["SECURITY"]!;
  const legalCanon = canonByKey["LEGAL_MEDIA_COMMS"]!;
  const advCanon = canonByKey["ADVERSARY"]!;

  const dedupRelations: z.input<typeof portfolioDedupRelationSchema>[] = [
    {
      id: uid(1100),
      kind: "CONTEXT_SPECIFIC",
      leftCapabilityId: capabilities.find((c) => c.name === "desk-intent-route")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: med.id,
      canonicalCapabilityId: orchCanon,
      notes: "Orchestration keyword only. Real-estate desk ≠ software planner.",
    },
    {
      id: uid(1101),
      kind: "CONTEXT_SPECIFIC",
      leftCapabilityId: capabilities.find((c) => c.name === "hotel-front-door")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: cio.id,
      canonicalCapabilityId: orchCanon,
      notes: "Hotel CIO vs Atlas ORCHESTRATOR.",
    },
    {
      id: uid(1102),
      kind: "SEMANTIC_OVERLAP",
      leftCapabilityId: capabilities.find((c) => c.name === "platform-sentinel")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: site.id,
      canonicalCapabilityId: secCanon,
      notes: "HotelOS site/Sentinel overlaps Atlas SECURITY+DEVOPS. Do not create a second SECURITY agent.",
    },
    {
      id: uid(1103),
      kind: "CONTEXT_SPECIFIC",
      leftCapabilityId: capabilities.find((c) => c.name === "facility-vms")?.id ?? null,
      rightCapabilityId: capabilities.find((c) => c.name === "platform-sentinel")?.id ?? null,
      leftSourceAgentId: hosSec.id,
      canonicalCapabilityId: secCanon,
      notes: "Physical VMS ≠ code/AuthZ security. Keep separate.",
    },
    {
      id: uid(1104),
      kind: "SEMANTIC_OVERLAP",
      leftCapabilityId: capabilities.find((c) => c.name === "hotel-compliance-cite")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: hosLegal.id,
      canonicalCapabilityId: legalCanon,
      notes: "Official-cite pattern. URL lists need diff before knowledge merge.",
    },
    {
      id: uid(1105),
      kind: "COMPLEMENTARY",
      leftCapabilityId: capabilities.find((c) => c.name === "preview-not-send")?.id ?? null,
      rightCapabilityId: capabilities.find((c) => c.name === "drafts-no-autosend")?.id ?? null,
      leftSourceAgentId: comm.id,
      canonicalCapabilityId: knowledgeCanon["KNOWLEDGE_CONFIRM_BEFORE_SEND"] ?? null,
      notes: "Same principle, different business context.",
    },
    {
      id: uid(1106),
      kind: "FUNCTIONALLY_DUPLICATE",
      leftCapabilityId: capabilities.find((c) => c.name === "court-opponent")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: lexOpp.id,
      canonicalCapabilityId: advCanon,
      notes: "LexStudy 003 vs 002 opponent phase — internal duplicate. Not a new Atlas agent.",
    },
    {
      id: uid(1107),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "invoice-draft-no-invent")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: acc.id,
      canonicalCapabilityId: knowledgeCanon["KNOWLEDGE_NO_INVENT_FINANCIALS"] ?? null,
      notes: "No Atlas finance specialist. Knowledge-only candidate. Do not create Finance Agent.",
    },
    {
      id: uid(1108),
      kind: "CONFLICTING",
      leftCapabilityId: capabilities.find((c) => c.name === "vantera-named-atlas-knowledge")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: vanKnow.id,
      canonicalCapabilityId: legalCanon,
      notes: "Product name Atlas in Vantera ≠ taqonu Atlas.",
    },
    // === PHASE 11.6: Global Deduplication Analysis ===
    // CaseFlow LEGAL-OPS capabilities
    {
      id: uid(1109),
      kind: "CONTEXT_SPECIFIC",
      leftCapabilityId: capabilities.find((c) => c.name === "office-wargame")?.id ?? null,
      rightCapabilityId: capabilities.find((c) => c.name === "court-opponent")?.id ?? null,
      leftSourceAgentId: byKey["CF-AG-010"]?.id ?? null,
      canonicalCapabilityId: advCanon,
      notes: "CaseFlow wargame and LexStudy court-opponent both implement adversary simulation. Context-specific to their domains.",
    },
    {
      id: uid(1110),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "office-personal-agent")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["CF-AG-001"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "CaseFlow-specific personal agent. No Atlas equivalent — application-specific case management.",
    },
    {
      id: uid(1111),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "legal-chat-governed")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["CF-AG-004"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "CaseFlow-specific governed chat. No Atlas equivalent — application-specific legal chat.",
    },
    {
      id: uid(1112),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "legal-draft-policy")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["CF-AG-007"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "CaseFlow-specific drafting. No Atlas equivalent — application-specific document generation.",
    },
    {
      id: uid(1113),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "autonomous-secretary")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["CF-AG-011"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "CaseFlow-specific automation. No Atlas equivalent — application-specific task processing.",
    },
    {
      id: uid(1114),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "jurisdiction-research")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["CF-AG-015"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "CaseFlow-specific legal research. No Atlas equivalent — application-specific jurisdiction analysis.",
    },
    {
      id: uid(1115),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "drafter-factory")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["CF-AG-016"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "CaseFlow-specific factory pattern. No Atlas equivalent — application-specific agent creation.",
    },
    {
      id: uid(1116),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "supervisor-oversight")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["CF-AG-043"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "CaseFlow-specific oversight. No Atlas equivalent — application-specific monitoring.",
    },
    // CaseFlow security/validation capabilities
    {
      id: uid(1117),
      kind: "SEMANTIC_OVERLAP",
      leftCapabilityId: capabilities.find((c) => c.name === "cyber-doctor-propose")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["CF-AG-042"]?.id ?? null,
      canonicalCapabilityId: secCanon,
      notes: "CaseFlow security proposals overlap Atlas SECURITY. Do not create duplicate security agent.",
    },
    {
      id: uid(1118),
      kind: "CONTEXT_SPECIFIC",
      leftCapabilityId: capabilities.find((c) => c.name === "hallucination-hook")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["CF-AG-009"]?.id ?? null,
      canonicalCapabilityId: canonByKey["JUDGE"] ?? null,
      notes: "CaseFlow hallucination detection. Overlaps Atlas JUDGE validation pattern.",
    },
    {
      id: uid(1119),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "identity-cards")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["CF-IDENTITY-CATALOG"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "CaseFlow identity catalog. No Atlas equivalent — 984 cards are not agents.",
    },
    // LexStudy LEGAL-EDUCATION capabilities
    {
      id: uid(1120),
      kind: "CONTEXT_SPECIFIC",
      leftCapabilityId: capabilities.find((c) => c.name === "virtual-court-orchestrator")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["LEX-AG-002"]?.id ?? null,
      canonicalCapabilityId: orchCanon,
      notes: "LexStudy simulation orchestrator. Keyword overlap with Atlas ORCHESTRATOR but education-specific.",
    },
    {
      id: uid(1121),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "personal-learning-agent")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["LEX-AG-001"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "LexStudy-specific learning agent. No Atlas equivalent — education-specific assistant.",
    },
    {
      id: uid(1122),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "scoring-agent")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["LEX-AG-004"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "LexStudy-specific scoring. No Atlas equivalent — education-specific assessment.",
    },
    {
      id: uid(1123),
      kind: "COMPLEMENTARY",
      leftCapabilityId: capabilities.find((c) => c.name === "legal-genius-non-us")?.id ?? null,
      rightCapabilityId: capabilities.find((c) => c.name === "us-law-genius")?.id ?? null,
      leftSourceAgentId: byKey["LEX-AG-011"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "LexStudy US vs non-US legal genius. Complementary jurisdiction coverage, internal to LexStudy.",
    },
    {
      id: uid(1124),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "legal-rag-qa")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["LEX-AG-016"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "LexStudy-specific RAG Q&A. No Atlas equivalent — education-specific retrieval.",
    },
    {
      id: uid(1125),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "question-factory-generator")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["LEX-AG-017"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "LexStudy-specific question generation. No Atlas equivalent — education-specific content.",
    },
    {
      id: uid(1126),
      kind: "SEMANTIC_OVERLAP",
      leftCapabilityId: capabilities.find((c) => c.name === "ci-pr-review")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["LEX-AG-028"]?.id ?? null,
      canonicalCapabilityId: secCanon,
      notes: "LexStudy CI review overlaps Atlas SECURITY devops pattern.",
    },
    // HotelOS application-specific capabilities
    {
      id: uid(1127),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "kashrut-compliance")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["agent.kashrut"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "HotelOS-specific dietary compliance. No Atlas equivalent — hospitality-specific.",
    },
    {
      id: uid(1128),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "hotel-financial-oversight")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["agent.cfo"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "HotelOS-specific finance. No Atlas equivalent — hospitality-specific CFO view.",
    },
    {
      id: uid(1129),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "housekeeping-coordination")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["agent.housekeeping"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "HotelOS-specific operations. No Atlas equivalent — hospitality-specific housekeeping.",
    },
    {
      id: uid(1130),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "guest-services")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["agent.guest"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "HotelOS-specific guest services. No Atlas equivalent — hospitality-specific.",
    },
    {
      id: uid(1131),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "procurement-management")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["agent.procurement"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "HotelOS-specific procurement. No Atlas equivalent — hospitality-specific supply chain.",
    },
    {
      id: uid(1132),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "maintenance-tracking")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["agent.maintenance"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "HotelOS-specific maintenance. No Atlas equivalent — hospitality-specific facility ops.",
    },
    {
      id: uid(1133),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "meeting-coordination")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["agent.meeting_secretary"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "HotelOS-specific meetings. No Atlas equivalent — hospitality-specific scheduling.",
    },
    {
      id: uid(1134),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "executive-overview")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["agent.ceo"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "HotelOS-specific executive view. PARTIAL implementation — hospitality-specific.",
    },
    {
      id: uid(1135),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "revenue-analysis")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["agent.revenue"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "HotelOS-specific revenue. PARTIAL implementation — hospitality-specific.",
    },
    {
      id: uid(1136),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "reception-support")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["agent.reception"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "HotelOS-specific reception. PARTIAL implementation — hospitality-specific.",
    },
    {
      id: uid(1137),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "hr-queries")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["agent.hr"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "HotelOS-specific HR. PARTIAL implementation — hospitality-specific.",
    },
    // Vantera application-specific capabilities
    {
      id: uid(1138),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "resident-chat-tools")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["VAN-AG-001"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "Vantera-specific resident chat. No Atlas equivalent — property management specific.",
    },
    {
      id: uid(1139),
      kind: "COMPLEMENTARY",
      leftCapabilityId: capabilities.find((c) => c.name === "tenant-executive-snapshot")?.id ?? null,
      rightCapabilityId: capabilities.find((c) => c.name === "executive-overview")?.id ?? null,
      leftSourceAgentId: byKey["VAN-AG-002"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "Vantera and HotelOS both have executive snapshot patterns. Complementary but application-specific.",
    },
    // BrokerOS application-specific capabilities
    {
      id: uid(1140),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "deal-resolution")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["TRANSACTION_AGENT"]?.id ?? null,
      canonicalCapabilityId: null,
      notes: "BrokerOS-specific deal resolution. No Atlas equivalent — real estate specific.",
    },
    // LexStudy question-validator (already has canonical mapping to KNOWLEDGE_NO_SELF_VALIDATE)
    {
      id: uid(1141),
      kind: "CONTEXT_SPECIFIC",
      leftCapabilityId: capabilities.find((c) => c.name === "question-validator")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: byKey["LEX-AG-018"]?.id ?? null,
      canonicalCapabilityId: knowledgeCanon["KNOWLEDGE_NO_SELF_VALIDATE"] ?? null,
      notes: "LexStudy question validation implements no-self-validate pattern. Knowledge-only candidate.",
    },
    {
      id: uid(1142),
      kind: "COMPLEMENTARY",
      leftCapabilityId: civioRightsCap,
      rightCapabilityId: null,
      leftSourceAgentId: civioRights.id,
      canonicalCapabilityId: legalCanon,
      notes: "Civio contributes reviewed Israeli civic-rights sources to LEGAL_MEDIA_COMMS without importing its runtime agent.",
    },
    {
      id: uid(1143),
      kind: "UNIQUE",
      leftCapabilityId: capabilities.find((c) => c.name === "civio-legal-ai-routes")?.id ?? null,
      rightCapabilityId: null,
      leftSourceAgentId: civioLegalAi.id,
      canonicalCapabilityId: null,
      notes: "Civio authentication, contract review, and provider calls remain application-specific.",
    },
  ];

  const conflicts: z.input<typeof portfolioConflictSchema>[] = [
    {
      id: uid(1200),
      key: "C1_ATLAS_NAME",
      status: "ESCALATED",
      summary: "The word Atlas refers to taqonu-main, Vantera knowledge, CaseFlow /atlas UI, HotelOS planned oversight, and MongoDB Atlas.",
      sourceAgentIds: [vanKnow.id],
      applicationIds: [APP.vantera],
      canonicalCapabilityId: null,
    },
    {
      id: uid(1201),
      key: "C2_FAIL_OPEN",
      status: "OPEN",
      summary: "CaseFlow governedAgentCall fail-open when agents table missing vs Atlas fail-closed identity.",
      sourceAgentIds: [byKey["CF-AG-004"]!.id],
      applicationIds: [APP.caseflow],
      canonicalCapabilityId: null,
    },
    {
      id: uid(1202),
      key: "C4_SECURITY_DOMAIN",
      status: "CONTEXT_DEPENDENT",
      summary: "HotelOS agent.security is facility VMS; Atlas SECURITY is code/AuthZ.",
      sourceAgentIds: [hosSec.id, site.id],
      applicationIds: [APP.hotelos],
      canonicalCapabilityId: secCanon,
    },
    {
      id: uid(1203),
      key: "C5_OFFICIAL_URL_LISTS",
      status: "UNRESOLVED",
      summary: "Official legal/cyber URL allow-lists differ across repos. Do not merge silently.",
      sourceAgentIds: [hosLegal.id, vanKnow.id],
      applicationIds: [APP.hotelos, APP.vantera],
      canonicalCapabilityId: knowledgeCanon["KNOWLEDGE_OFFICIAL_LEGAL_HOSTS"] ?? null,
    },
  ];

  const governanceDecisions: PortfolioGovernanceDecision[] = [
    {
      id: uid(1300),
      action: "KEEP_SOURCE_SPECIFIC",
      status: "PROPOSED",
      applicationId: APP.vantera,
      sourceAgentId: null,
      capabilityId: null,
      rationale: "Vantera runtimes are application-specific (Mongo/JWT/building). Observability only.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1301),
      action: "KEEP_SOURCE_SPECIFIC",
      status: "PROPOSED",
      applicationId: APP.hotelos,
      sourceAgentId: null,
      capabilityId: null,
      rationale: "Hotel specialists stay on PMS/HITL. Sentinel knowledge may later ADD_PROVENANCE to SECURITY.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1302),
      action: "DO_NOT_IMPORT",
      status: "PROPOSED",
      applicationId: APP.caseflow,
      sourceAgentId: cards.id,
      capabilityId: null,
      rationale: "Identity cards are not implemented agents.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1303),
      action: "KEEP_SOURCE_SPECIFIC",
      status: "PROPOSED",
      applicationId: APP.brokeros,
      sourceAgentId: null,
      capabilityId: null,
      rationale: "Four specialists remain BrokerOS. Safety rules are knowledge-only candidates — not ingested in this phase.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1304),
      action: "IMPORT_KNOWLEDGE_ONLY",
      status: "PROPOSED",
      applicationId: APP.brokeros,
      sourceAgentId: acc.id,
      capabilityId: accCap,
      rationale: "Do-not-invent amounts is portable knowledge. Explicitly not a Finance specialist. Ingest not enabled.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1305),
      action: "DO_NOT_IMPORT",
      status: "PROPOSED",
      applicationId: APP.vantera,
      sourceAgentId: vanKnow.id,
      capabilityId: null,
      rationale: "Vantera VAN-AG-003 must not become an Atlas fabric agent. Escalate naming.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1306),
      action: "KEEP_SOURCE_SPECIFIC",
      status: "PROPOSED",
      applicationId: APP.lexstudy,
      sourceAgentId: null,
      capabilityId: null,
      rationale: "Pedagogy/court sim stay in LexStudy. Validator split is knowledge-only candidate, not ingested.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1321),
      action: "KEEP_SOURCE_SPECIFIC",
      status: "PROPOSED",
      applicationId: APP.civio,
      sourceAgentId: civioLegalAi.id,
      capabilityId: capabilities.find((c) => c.name === "civio-legal-ai-routes")?.id ?? null,
      rationale: "Civio authentication, Gemini calls, contract review, and runtime operations remain inside Civio. Atlas supervises but does not execute them.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1322),
      action: "IMPORT_KNOWLEDGE_ONLY",
      status: "PROPOSED",
      applicationId: APP.civio,
      sourceAgentId: civioRights.id,
      capabilityId: civioRightsCap,
      rationale: "Owner approved a commit-pinned snapshot of RIGHTS_ITEMS and LEGAL_FOUNDATIONS for RESEARCHER and LEGAL_MEDIA_COMMS only.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    // Phase 11.8: Explicit governance decisions for capabilities with canonical mappings
    // These decisions remain PROPOSED until explicit Owner approval
    // ORCHESTRATOR pattern capabilities
    {
      id: uid(1307),
      action: "ADD_PROVENANCE",
      status: "PROPOSED",
      applicationId: APP.brokeros,
      sourceAgentId: byKey["MEDIATOR_AGENT"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "desk-intent-route")?.id ?? null,
      rationale:
        "BrokerOS desk-intent-route maps to ORCHESTRATOR pattern. ADD_PROVENANCE only — no agent creation. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1308),
      action: "ADD_PROVENANCE",
      status: "PROPOSED",
      applicationId: APP.hotelos,
      sourceAgentId: byKey["agent.cio"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "hotel-front-door")?.id ?? null,
      rationale:
        "HotelOS hotel-front-door maps to ORCHESTRATOR pattern. ADD_PROVENANCE only — hotel context preserved. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1309),
      action: "ADD_PROVENANCE",
      status: "PROPOSED",
      applicationId: APP.lexstudy,
      sourceAgentId: byKey["LEX-AG-002"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "virtual-court-orchestrator")?.id ?? null,
      rationale:
        "LexStudy virtual-court-orchestrator maps to ORCHESTRATOR pattern. ADD_PROVENANCE only — simulation context. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    // SECURITY pattern capabilities
    {
      id: uid(1310),
      action: "ADD_PROVENANCE",
      status: "PROPOSED",
      applicationId: APP.hotelos,
      sourceAgentId: byKey["agent.site"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "platform-sentinel")?.id ?? null,
      rationale:
        "HotelOS platform-sentinel maps to SECURITY pattern (software AuthZ). ADD_PROVENANCE only. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1311),
      action: "ADD_PROVENANCE",
      status: "PROPOSED",
      applicationId: APP.caseflow,
      sourceAgentId: byKey["CF-AG-042"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "cyber-doctor-propose")?.id ?? null,
      rationale:
        "CaseFlow cyber-doctor-propose maps to SECURITY pattern. ADD_PROVENANCE only — legal compliance context. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1312),
      action: "ADD_PROVENANCE",
      status: "PROPOSED",
      applicationId: APP.lexstudy,
      sourceAgentId: byKey["LEX-AG-028"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "ci-pr-review")?.id ?? null,
      rationale:
        "LexStudy ci-pr-review maps to SECURITY pattern. ADD_PROVENANCE only — educational CI context. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    // ADVERSARY pattern capabilities
    {
      id: uid(1313),
      action: "ADD_PROVENANCE",
      status: "PROPOSED",
      applicationId: APP.caseflow,
      sourceAgentId: byKey["CF-AG-010"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "office-wargame")?.id ?? null,
      rationale:
        "CaseFlow office-wargame maps to ADVERSARY pattern. ADD_PROVENANCE only — legal war-gaming context. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1314),
      action: "ADD_PROVENANCE",
      status: "PROPOSED",
      applicationId: APP.lexstudy,
      sourceAgentId: byKey["LEX-AG-003"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "court-opponent")?.id ?? null,
      rationale:
        "LexStudy court-opponent maps to ADVERSARY pattern. ADD_PROVENANCE only — educational simulation. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    // KNOWLEDGE_CONFIRM_BEFORE_SEND pattern capabilities
    {
      id: uid(1315),
      action: "IMPORT_KNOWLEDGE_ONLY",
      status: "PROPOSED",
      applicationId: APP.brokeros,
      sourceAgentId: byKey["COMMUNICATION_AGENT"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "preview-not-send")?.id ?? null,
      rationale:
        "BrokerOS preview-not-send implements confirm-before-send pattern. IMPORT_KNOWLEDGE_ONLY — no agent creation. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    {
      id: uid(1316),
      action: "IMPORT_KNOWLEDGE_ONLY",
      status: "PROPOSED",
      applicationId: APP.brokeros,
      sourceAgentId: byKey["agent.correspondence"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "drafts-no-autosend")?.id ?? null,
      rationale:
        "BrokerOS drafts-no-autosend implements confirm-before-send pattern. IMPORT_KNOWLEDGE_ONLY — no agent creation. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    // LEGAL_MEDIA_COMMS pattern capability
    {
      id: uid(1317),
      action: "ADD_PROVENANCE",
      status: "PROPOSED",
      applicationId: APP.hotelos,
      sourceAgentId: byKey["agent.legal"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "hotel-compliance-cite")?.id ?? null,
      rationale:
        "HotelOS hotel-compliance-cite maps to LEGAL_MEDIA_COMMS pattern. ADD_PROVENANCE only — hospitality compliance. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    // JUDGE pattern capability
    {
      id: uid(1318),
      action: "ADD_PROVENANCE",
      status: "PROPOSED",
      applicationId: APP.caseflow,
      sourceAgentId: byKey["CF-AG-009"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "hallucination-hook")?.id ?? null,
      rationale:
        "CaseFlow hallucination-hook maps to JUDGE pattern. ADD_PROVENANCE only — legal verification context. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    // KNOWLEDGE_NO_SELF_VALIDATE pattern capability
    {
      id: uid(1319),
      action: "IMPORT_KNOWLEDGE_ONLY",
      status: "PROPOSED",
      applicationId: APP.lexstudy,
      sourceAgentId: byKey["LEX-AG-018"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "question-validator")?.id ?? null,
      rationale:
        "LexStudy question-validator implements no-self-validate pattern. IMPORT_KNOWLEDGE_ONLY — educational context. Requires Owner approval.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
    // CONFLICTING capability - requires ESCALATE action
    {
      id: uid(1320),
      action: "ESCALATE",
      status: "PROPOSED",
      applicationId: APP.vantera,
      sourceAgentId: byKey["VAN-AG-003"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "vantera-named-atlas-knowledge")?.id ?? null,
      rationale:
        "CONFLICTING: Vantera uses 'Atlas' as product name. This is NOT taqonu Atlas. Requires explicit Owner resolution before any action.",
      decidedBy: null,
      decidedAt: null,
      fabricCatalogMutated: false,
      knowledgeIngested: false,
    },
  ];

  const auditEvents: PortfolioAuditEvent[] = [
    {
      id: uid(1400),
      at: EXTRACTED_AT,
      type: "portfolio.seed.loaded",
      actorId: "system:static-scan",
      payload: {
        applications: applications.length,
        sourceAgents: sourceAgents.length,
        knowledgeIngested: false,
        fabricCatalogMutated: false,
        runtimeDefault: "UNKNOWN/NOT_PROBED",
      },
    },
    // Phase 11.15: Owner-approved knowledge ingestion audit event
    {
      id: uid(1401),
      at: "2026-08-28T17:45:00.000Z",
      type: "portfolio.ingestion_decision",
      actorId: "owner:explicit-approval",
      payload: {
        phase: "11.15",
        action: "IMPORT_KNOWLEDGE_ONLY",
        recordsIngested: 4,
        recordIds: [uid(1500), uid(1501), uid(1502), uid(1503)],
        governanceDecisionIds: [uid(1304), uid(1315), uid(1316), uid(1319)],
        patterns: [
          "Do-Not-Invent Amounts",
          "Confirm-Before-Send (Preview)",
          "Confirm-Before-Send (Drafts)",
          "No-Self-Validate",
        ],
        fabricCatalogMutated: false,
        atlasAgentsCreated: 0,
        sourceExecutionPerformed: false,
        secretsTouched: false,
        permissionsInherited: false,
      },
    },
    {
      id: uid(1402),
      at: "2026-08-30T00:00:00.000Z",
      type: "portfolio.ingestion_decision",
      actorId: "owner:explicit-approval",
      payload: {
        application: "civio",
        action: "IMPORT_KNOWLEDGE_ONLY",
        sourceCommit: COMMITS.civio,
        documentsIngested: 180,
        allowedAgentIds: ["RESEARCHER", "LEGAL_MEDIA_COMMS"],
        governanceDecisionId: uid(1322),
        knowledgeRecordId: uid(1504),
        fabricCatalogMutated: false,
        atlasAgentsCreated: 0,
        sourceExecutionPerformed: false,
        secretsTouched: false,
        permissionsInherited: false,
      },
    },
  ];

  // Phase 11.15: Knowledge records for Owner-approved IMPORT_KNOWLEDGE_ONLY decisions
  // These 4 records were explicitly approved by Owner on 2026-08-28
  const knowledgeRecords: PortfolioKnowledgeRecord[] = [
    {
      id: uid(1500),
      applicationId: APP.brokeros,
      sourceAgentId: acc.id,
      capabilityId: accCap,
      provenance: prov({
        applicationId: APP.brokeros,
        repo: "github.com/taqonu/brokeros",
        branch: "main",
        commit: COMMITS.brokeros,
        path: "apps/brokeros/src/agents/accounting/",
        pkg: "@brokeros/agents",
        symbol: "ACCOUNTING_AGENT",
        sourceType: "KNOWLEDGE",
        originalStatus: "ACTIVE",
        atlasClassification: "KNOWLEDGE_CANDIDATE",
      }),
      title: "Do-Not-Invent Amounts Pattern",
      summary:
        "Financial figures must never be fabricated. BrokerOS ACCOUNTING_AGENT enforces that invoice amounts, percentages, and calculations are derived from actual data sources only. This pattern prevents hallucinated financial data.",
      ingested: true,
      ingestEnabled: false,
      governanceDecisionId: uid(1304),
    },
    {
      id: uid(1501),
      applicationId: APP.brokeros,
      sourceAgentId: byKey["COMMUNICATION_AGENT"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "preview-not-send")?.id ?? null,
      provenance: prov({
        applicationId: APP.brokeros,
        repo: "github.com/taqonu/brokeros",
        branch: "main",
        commit: COMMITS.brokeros,
        path: "apps/brokeros/src/agents/communication/",
        pkg: "@brokeros/agents",
        symbol: "COMMUNICATION_AGENT",
        sourceType: "KNOWLEDGE",
        originalStatus: "ACTIVE",
        atlasClassification: "KNOWLEDGE_CANDIDATE",
      }),
      title: "Confirm-Before-Send Pattern (Preview)",
      summary:
        "Communications must be previewed before sending. BrokerOS COMMUNICATION_AGENT implements a mandatory preview step where users see exactly what will be sent before confirming dispatch. This prevents accidental or unreviewed message transmission.",
      ingested: true,
      ingestEnabled: false,
      governanceDecisionId: uid(1315),
    },
    {
      id: uid(1502),
      applicationId: APP.brokeros,
      sourceAgentId: byKey["agent.correspondence"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "drafts-no-autosend")?.id ?? null,
      provenance: prov({
        applicationId: APP.brokeros,
        repo: "github.com/taqonu/brokeros",
        branch: "main",
        commit: COMMITS.brokeros,
        path: "apps/brokeros/src/agents/correspondence/",
        pkg: "@brokeros/agents",
        symbol: "agent.correspondence",
        sourceType: "KNOWLEDGE",
        originalStatus: "ACTIVE",
        atlasClassification: "KNOWLEDGE_CANDIDATE",
      }),
      title: "Confirm-Before-Send Pattern (Drafts)",
      summary:
        "Draft messages are never auto-sent. BrokerOS agent.correspondence maintains drafts in an unsent state until explicit user confirmation. This ensures no communication leaves the system without deliberate human approval.",
      ingested: true,
      ingestEnabled: false,
      governanceDecisionId: uid(1316),
    },
    {
      id: uid(1503),
      applicationId: APP.lexstudy,
      sourceAgentId: byKey["LEX-AG-018"]?.id ?? null,
      capabilityId: capabilities.find((c) => c.name === "question-validator")?.id ?? null,
      provenance: prov({
        applicationId: APP.lexstudy,
        repo: "github.com/taqonu/lexstudy",
        branch: "main",
        commit: COMMITS.lexstudy,
        path: "apps/lexstudy/src/agents/exam-validator/",
        pkg: "@lexstudy/agents",
        symbol: "LEX-AG-018",
        sourceType: "KNOWLEDGE",
        originalStatus: "ACTIVE",
        atlasClassification: "KNOWLEDGE_CANDIDATE",
      }),
      title: "No-Self-Validate Pattern",
      summary:
        "Validators cannot validate their own output. LexStudy LEX-AG-018 enforces that exam question generation and validation are performed by separate agents. An agent that creates content cannot approve that same content.",
      ingested: true,
      ingestEnabled: false,
      governanceDecisionId: uid(1319),
    },
    {
      id: uid(1504),
      applicationId: APP.civio,
      sourceAgentId: civioRights.id,
      capabilityId: civioRightsCap,
      provenance: prov({
        applicationId: APP.civio,
        repo: "github.com/relaya17/civio",
        branch: "main",
        commit: COMMITS.civio,
        path: "packages/logic/src/rights/database.data.js + packages/logic/src/housing-agent/legalFoundations.ts",
        pkg: "@repo/logic",
        symbol: "RIGHTS_ITEMS + LEGAL_FOUNDATIONS",
        sourceType: "KNOWLEDGE",
        originalStatus: "ACTIVE",
        atlasClassification: "APPROVED_SCOPED_KNOWLEDGE",
      }),
      title: "Civio Verified Civic Rights Snapshot",
      summary:
        "Commit-pinned snapshot of 167 reviewed rights and 13 legal foundations. Retrieval is restricted to RESEARCHER and LEGAL_MEDIA_COMMS; sources and disclaimers remain attached and no Civio runtime authority is inherited.",
      ingested: true,
      ingestEnabled: false,
      governanceDecisionId: uid(1322),
    },
  ];

  return portfolioGovernanceSnapshotSchema.parse({
    version: PORTFOLIO_GOVERNANCE_VERSION,
    extractedAt: EXTRACTED_AT,
    applications,
    sourceAgents,
    capabilities,
    canonicalCapabilities,
    sourcePermissions: permissions,
    atlasPermissions: [],
    sourceCodeRecords: [],
    knowledgeRecords,
    fabricAgentRefs: [],
    evidence,
    dedupRelations,
    conflicts,
    governanceDecisions,
    auditEvents,
  });
}
