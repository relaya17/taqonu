# Early Access agreement draft (G2)

**Status:** DRAFT outline for counsel review — **not legal advice**, not a signed contract.  
**Use:** share with your lawyer before sending to design partners.  
**Companions:** [`design-partner-truth10-early-access.md`](./design-partner-truth10-early-access.md) · [`paid-beta-checklist.md`](./paid-beta-checklist.md) · [`legal-media-comms.md`](./legal-media-comms.md)

---

## Parties

- **Provider:** [Company legal name] (“Atlas” / ArletOS)
- **Partner:** [Company legal name] (“Partner”)

## Term

- Pilot length: **60–90 days** from first linked workspace.
- Either party may end with **7 days** written notice (email OK).

## Scope

- Partner links **owned** repositories / local workspaces only.
- Surfaces in scope: Truth · Observer · Sentinel · propose/verify (human-gated apply).
- Out of scope: offensive security scanning, third-party systems Partner does not control, model training on Partner code.

## Data & isolation

- Partner code and Evidence stay under Partner-controlled storage where BYO is configured.
- Provider **does not** use Partner code to train shared models or learn across tenants.
- Provider may process metadata required to operate the product (usage counters, audit of human approvals).

## Security & access

- HIGH/CRITICAL remediations require Partner human approval.
- Partner is responsible for rotating any secrets Atlas discovers in their workspace.
- Provider will not perform unauthorized scanning of non-Partner systems.

## Feedback & metrics

- Partner agrees to a weekly **30-minute** feedback touchpoint (or async equivalent).
- Provider may use **anonymized** aggregate counters (`analyzed` / `risks` / `confirmed` / `caughtBeforeProd`) for product improvement.
- Case study / named quote requires **separate written permission**.

## Confidentiality

- Mutual NDA terms apply to non-public product materials and Partner code/architecture.
- Public marketing needs prior written approval.

## Fees (Early Access)

- Default: **$0** during Early Access, or founder-set nominal fee.
- Conversion to Paid Beta / commercial terms is **optional** and negotiated separately ([`paid-beta-checklist.md`](./paid-beta-checklist.md)).

## Warranty disclaimer (placeholder)

- Pilot software is provided **as-is** for evaluation. No production SLA unless separately agreed.

## Signature block (placeholder)

| | Provider | Partner |
|---|---|---|
| Name | | |
| Title | | |
| Date | | |
| Signature | | |

---

## Feedback loop checklist (product ops)

1. Kickoff → link workspace → first Truth + Sentinel cycle  
2. Week 1 readout → capture sheet in [`design-partner-tracker.md`](./design-partner-tracker.md)  
3. Midpoint → WTP signal ([`willingness-to-pay-interviews.md`](./willingness-to-pay-interviews.md))  
4. End → renew / Paid Beta / pause  

**Reminder:** Have counsel review before use with real companies.
