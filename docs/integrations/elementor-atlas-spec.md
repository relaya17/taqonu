# Elementor × Atlas — Integration Specification (research draft)

**Status:** Research only — **not** a claimed partnership or shipped adapter.  
**Positioning:** Elementor is a **Provider Adapter** / distribution channel, not
“Atlas for Elementor.”

## Official surfaces (as of research 2026-08)

| Surface | Notes |
| --- | --- |
| [developers.elementor.com](https://developers.elementor.com/) | Official developer center |
| REST: `/wp-json/elementor/v1/settings/{key}` | Settings (auth + caps required) |
| REST: `/wp-json/wp/v2/elementor_library` | Template library CRUD |
| Post meta REST | Elementor-specific post metadata (authenticated) |
| MCP module (experiment) | `elementor-mcp-server` — abilities: structure, create page, settings, globals, mutate elements — gated experiments / WP MCP adapter |

**Do not** scrape the Elementor editor UI or present unofficial access as a partnership.

## Proposed Atlas adapter levels

### L1 — Import / Pull (POC)

Connect WordPress site or theme/plugin **Git repo** (preferred) or authenticated
WP REST + Elementor endpoints.

Emit `NormalizedEvidenceDraft` (same contract as GitHub/Vercel):

- theme/plugin versions  
- Elementor kit / active settings keys (non-secret)  
- template library inventory  
- accessibility/performance scan artifacts (Atlas-side)

### L2 — Analyze (Killer for agencies)

Workflow: *“Is this Elementor site production-safe?”*

Checks (Evidence-backed): a11y · performance · broken assets · PHP/plugin
conflicts · security headers · stale deps · responsive regressions.

Output: **Atlas Verdict** + Certificate dimensions.

### L3 — Governed Fix

Propose Patches (theme/child theme / plugin code or documented Elementor JSON
changes) → Preview → Human Approve → Apply → Verify.

Mutating live Elementor documents via MCP/REST only with **explicit partner
consent** and approval gate.

## POC recommendation (2 weeks)

1. Partner provides staging WP + Elementor + Git for theme/child.  
2. Atlas Discovery on Git (L1).  
3. Issue Verdict + readiness certificate (L2).  
4. Optional one a11y/security Patch under approval (L3).  
5. Write Case Study (agency anonymized).

## Business wedge (if distribution works)

Free site scan → Pro monitoring → Agency multi-site → Enterprise.

## Open questions before build

- Which Elementor REST/MCP abilities are stable vs experiment-flagged?  
- Partner API / marketplace path for official listing?  
- Write-back policy for published pages (draft-only first)?  
- Data residency for agency multi-tenant?

## Non-goals

- Branding Atlas as an Elementor-only product  
- Unofficial scraping  
- Silent WRITE to production sites
