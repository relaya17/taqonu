# Unit 2 PostgreSQL Test Specification

Status: NOT EXECUTED. Requires a disposable Supabase/PostgreSQL database with this migration applied and isolated `service_role`, authenticated-owner, and cross-scope fixtures.

## Envelope Persistence

- Create a valid Unit 1 envelope and call `create_requested_approval` with canonical JSON excluding `envelopeHash`; assert `REQUESTED` is persisted with the original hash and canonical JSON.
- Tamper one envelope field while retaining the prior hash; assert the RPC rejects and writes no approval, domain event, or outbox event.
- Submit canonical JSON that does not decode to the envelope with `envelopeHash` removed; assert rejection and zero writes.

## Expiration

- Start with an `APPROVED` approval whose `expires_at` is in the past; call `claim_approval_redemption`; assert an `EXPIRED` response and durable `APPROVED -> EXPIRED` with no redemption, receipt, domain event, or outbox event.
- Start with a `REQUESTED` approval whose `expires_at` is in the past; call `record_approval_decision`; assert an `EXPIRED` response and durable `REQUESTED -> EXPIRED` with no decision, domain event, or outbox event.

## Scope and RLS

- As an authenticated owner, assert SELECT returns only rows with matching `owner_id`; verify direct INSERT, UPDATE, and DELETE deny without policies.
- As a different authenticated owner, assert no approval, decision, redemption, or receipt row is visible.
- As service role, call each mutation with a server-resolved context whose owner, tenant, or project does not match stored scope; assert rejection and no writes.

## Claim Concurrency

- Execute two concurrent `claim_approval_redemption` calls with the same approval, operator, and idempotency-key hash. Assert both return the same redemption/execution IDs, exactly one result has `replayed = false`, and one redemption, execution ID, claim receipt, event, and outbox row exist.
- Execute concurrent calls with different idempotency keys. Assert exactly one claim succeeds, the other rejects, and exactly one redemption/execution ID exists.
- Retry a committed claim with the same tuple; assert it returns the original redemption/result. Retry with a different key; assert rejection.

## Immutability and Audit

- Attempt updates/deletes of immutable approval, decision, redemption identity, receipt, and outbox event fields; assert trigger rejection.
- Submit audit payloads containing `tool_args`, `secret`, `password`, `artifact`, `raw_result`, nested object values, arrays, and unknown fields; assert allowlist rejection and zero event/outbox writes.
- Submit an allowlisted scalar-only payload; assert the same payload digest appears in its transactional outbox row.