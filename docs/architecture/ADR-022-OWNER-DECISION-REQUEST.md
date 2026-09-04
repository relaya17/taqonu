# Owner decision request — ADR-022 and sibling execute

**Status:** REQUEST — not an amendment. Do not treat this file as authorization.
**Date:** 2026-09-05
**Checkpoint:** HEAD `7adbe54` plus this reconciliation increment.

No code silently overrides ADR-022. No speculative connector was added.

---

## OWNER DECISION REQUIRED

Atlas-self (`def-000`) already has a real governed execute hop. Sibling **execute** does not.

### Civio

| Field | Fact |
| --- | --- |
| Exact application | `civio` (`github.com/relaya17/civio`, local clone present) |
| Exact missing contract | Atlas → Civio inbound action; ingest-time tool/target/artifact |
| Exact missing endpoint | No inbound Civio URL. Existing path is Civio → `POST /api/v1/connectors/civio/events` only |
| Exact missing action | `CIVIO_SUPPORTED_ACTIONS = []` |
| Exact missing credential | Live Civio process + `ATLAS_CIVIO_*` on **both** runtimes (does not create an action) |
| Exact ADR-022 conflict | Evaluate ingest; do not execute tools on ingest; inbound NOT_IMPLEMENTED |
| Smallest decision | Authorize **one** named Civio inbound action with identity, auth, target, artifact, audit, verification — or keep evaluate-only |
| Engineering consequence | Without amendment: ingest remains evaluate-only. With amendment: new egress/authz/SSRF surface |
| What Atlas can prove without that decision | HMAC ingest 202, `evaluation.executed: false`, invalid HMAC 401, Atlas-self `analyze_repo` EXECUTED |

### CaseFlow

| Field | Fact |
| --- | --- |
| Exact application | `caseflow` (`github/CaseFlow-AI-main`, local clone present) |
| Exact missing contract | Atlas → CaseFlow governed action |
| Exact missing endpoint | No taqonu execute URL. Sibling has `emitArletOsEvent` → `POST /api/v1/gateway/events` (observe) and an **internal** `/api/atlas` engineering-audit module (name collision) |
| Exact missing action | No CaseFlow tool registered in Fabric / `CONNECTED_APPLICATION_RUNTIME` |
| Exact missing credential | CaseFlow runtime + `ATLAS_CONTROL_PLANE_URL` / token for **outbound observe only** |
| Exact ADR-022 conflict | Observe-only / not connected |
| Smallest decision | Whether outbound `gateway/events` observe is enough, or one CaseFlow write action is authorized |
| Engineering consequence | Implementing execute without amendment would invent a sibling fulfill mapping |
| What Atlas can prove without that decision | Inventory + DENY unknown sibling fulfill; CaseFlow outbound observe is sibling-side, not Atlas execute |

### HotelOS

| Field | Fact |
| --- | --- |
| Exact application | `hotelos` (`github/hotelOS-AI-main`, local clone present) |
| Exact missing contract | Atlas → HotelOS inbound action |
| Exact missing endpoint | HotelOS `intelligenceApiAvailable` is **hardcoded false**. Outbound `POST /api/v1/gateway/events` only (ADR 0016) |
| Exact missing action | No HotelOS tool/target/artifact in Atlas |
| Exact missing credential | `ATLAS_TELEMETRY_URL` / `ATLAS_TELEMETRY_TOKEN` on HotelOS for observe only |
| Exact ADR-022 conflict | Observe-only / not connected. HotelOS ADR 0016 does not propose using `gateway/fulfill` |
| Smallest decision | Keep one-way telemetry, or authorize one inbound HotelOS action with a confirmed HotelOS API |
| Engineering consequence | Flipping `intelligenceApiAvailable` without a real HotelOS inbound API would be a fabricated contract |
| What Atlas can prove without that decision | Inventory; sibling write `hotelos` DENY unknown application; Atlas-self execute |

### BrokerOS

| Field | Fact |
| --- | --- |
| Exact application | `brokeros` (`github/brokerOS` — **not present** on this workstation) |
| Exact missing contract | Entire connector: auth, endpoint, action, target, artifact |
| Exact missing endpoint | none in this monorepo (`fixtures/golden-brokeros` is an exemplar) |
| Exact missing action | none |
| Exact missing credential | BrokerOS runtime not available here |
| Exact ADR-022 conflict | Observe-only / not connected |
| Smallest decision | Whether BrokerOS is ever an executable connected app |
| Engineering consequence | Fixture/evals must not be treated as live BrokerOS |
| What Atlas can prove without that decision | Golden-project / eval fixtures remain synthetic |

### LexStudy

| Field | Fact |
| --- | --- |
| Exact application | `lexstudy` (`github/LexStudy-main` — **not present** here) |
| Exact missing contract | Entire connector |
| Exact missing endpoint / action / credential | none / none / sibling repo absent |
| Exact ADR-022 conflict | Observe-only / not connected |
| Smallest decision | Whether LexStudy is ever executable from Atlas |
| Engineering consequence | Portfolio source agents stay inventory |
| What Atlas can prove without that decision | Inventory only |

### Vantera

| Field | Fact |
| --- | --- |
| Exact application | `vantera` (`github/vantera` — **not present** here) |
| Exact missing contract | Entire connector |
| Exact missing endpoint / action / credential | none / none / sibling repo absent |
| Exact ADR-022 conflict | Observe-only. Vantera product name “Atlas” is a knowledge service, not taqonu execute |
| Smallest decision | Whether Vantera is ever executable from Atlas |
| Engineering consequence | Do not import Vantera Atlas as a Fabric agent |
| What Atlas can prove without that decision | Inventory only |

---

## Proposed decision (for Owner, not implemented)

**Recommended default:** keep ADR-022. Atlas-self remains the only executable Connected Application.

**Not recommended:** treating HotelOS/CaseFlow outbound `gateway/events` telemetry as Atlas execution.

---

## Classification (exactly one per app)

| Application | Classification |
| --- | --- |
| def-000 | REAL EXECUTION READY |
| civio | EVALUATE-ONLY |
| caseflow | INVENTORY ONLY |
| hotelos | INVENTORY ONLY |
| brokeros | INVENTORY ONLY |
| lexstudy | INVENTORY ONLY |
| vantera | INVENTORY ONLY |

Authoritative code: `packages/shared/src/platform/connected-applications.ts`.
