# Owner decision request — ADR-022 and sibling execute

**Status:** REQUEST — not an amendment. Do not treat this file as authorization.
**Date:** 2026-09-04
**Scope:** Real Connected-Application execution beyond Atlas-self (`def-000`).

This request exists because productionization reached an architectural wall.
No code in this pass silently overrides ADR-022.

---

## Exact blocked capability

Governed **execute** of a sibling Connected Application:

```text
Atlas → Authorization → Control Plane → Connected-App authorization
      → Real application action → Result → Canonical audit → Verification
```

Blocked applications:

| Application | Current contract | Blocked capability |
| --- | --- | --- |
| Civio | HMAC ingest evaluate-only | Atlas-to-Civio inbound action; ingest-time tool/target/artifact execute |
| CaseFlow | Inventory only | Any connector, auth, action, target, artifact |
| HotelOS | Inventory only | Same |
| BrokerOS | Inventory only | Same (`fixtures/golden-brokeros` is an exemplar, not a connector) |
| LexStudy | Inventory only | Same |
| Vantera | Inventory only | Same |

Not blocked: Atlas-self `def-000` via `POST /api/v1/gateway/fulfill` → `executeGovernedAction` → `executeTool`. Control Plane still does not run tools.

---

## Current architecture

- ADR-022: Control **evaluates** Civio ingest and **does not execute tools** on ingest.
- Atlas-to-Civio inbound actions are **not implemented**.
- CaseFlow, HotelOS, BrokerOS, LexStudy, Vantera stay observe-only / not connected.
- `CONNECTED_APPLICATION_RUNTIME` is the inventory: only `def-000` has `execute: GATEWAY_FULFILL`.
- `CIVIO_SUPPORTED_ACTIONS` is empty. Civio events have no authoritative tool, target, or artifact.
- `fulfillGatewayHandoff` refuses non-`def-000`. HTTP gateway fulfill is Atlas-self only.
- Sibling ALLOW writes on Control Plane produce a receipt with `executed: false` and **no** HTTP fulfill hop.

---

## Why the existing contract is insufficient

ADR-022 plus the Civio envelope authorize **observation and evaluation**, not **application action**.

Inventing a mapping such as `knowledge_search(query = eventId)` or treating portfolio seed as a live API would:

- fabricate an execute contract that does not exist in Civio or sibling repos
- collapse SOURCE identity into Fabric identity
- violate “ALLOW ≠ EXECUTED”

---

## Minimal required change (if Owner authorizes later)

Pick **one** sibling and one action, then amend ADR-022 explicitly with:

1. Application identity (never `def-000`)
2. Authentication (existing HMAC for Civio, or a new connector for others)
3. Authoritative action/tool name owned by that application
4. Target identifier and artifact/result schema
5. Whether Control may HTTP-fulfill that application, or only evaluate
6. Canonical audit fields and world-state verification observations
7. Fail-closed behavior when the sibling runtime is unreachable

Do not reuse Atlas-self `analyze_repo` as a stand-in for a sibling action.

---

## Implications

| Plane | If Owner keeps ADR-022 | If Owner amends for one action |
| --- | --- | --- |
| Security | Sibling execute remains impossible; attack surface stays ingest/eval | New egress, authz, SSRF, and tenant-binding surface on that action |
| Governance | Evaluate-only; Fabric catalog unchanged | New policy cell + approval path for that action |
| Audit | Civio ingest audit is in-memory CP + optional API import; execute audit is Atlas-self only | Canonical NDJSON must record sibling `applicationId`, tool, target, artifact |
| Verification | Ingest `execution: NOT_IMPLEMENTED`; world-state verify is Atlas-self | Sibling world-state observations must come from that app, not Atlas fixtures |

---

## Proposed decision (for Owner, not implemented)

**Recommended default:** keep ADR-022. Atlas-self remains the only executable Connected Application until a sibling publishes an authoritative execute contract.

**Alternative:** authorize a single Civio inbound action (not ingest-time execute) with an explicit ADR-022 amendment. That still requires the Civio runtime, credentials, and action schema — none of which exist in this monorepo.

---

## What this pass did without the decision

- Recorded `executeGap` on every inventory row
- Ran live `def-000` fulfill when the private plane was up
- Ran Civio HMAC evaluate-only when `ATLAS_CIVIO_*` was set
- Did not invent sibling fulfill mappings
