-- Unit 2 follow-up (Phase 3B): repair the durable approval state machine so it
-- is internally coherent on its own terms, before any question of whether it
-- becomes authoritative for live governed execution.
--
-- Two concrete defects, both confirmed by reading `20260901000000_
-- approval_backed_execution_persistence.sql` line-by-line rather than
-- inferred:
--
--   1. `record_approval_decision`'s happy path inserted a row into
--      `approval_decisions` recording the human's choice, but never wrote
--      that choice back onto the parent `approval_requests.state` column —
--      it always returned the literal 'REQUESTED', for both APPROVE and
--      REJECT. Since `claim_approval_redemption` requires
--      `state = 'APPROVED'` to proceed, no approval could ever be redeemed
--      through the RPC surface, regardless of what a human decided.
--
--   2. `REVOKED` is a legal value in `approval_requests.state`'s check
--      constraint and an explicitly allowed transition in
--      `governance_protect_approval_request()`'s trigger
--      (`REQUESTED|APPROVED -> REVOKED`), but no RPC in the prior migration
--      ever produced it. There was no way to revoke a durable approval at
--      all.
--
-- This migration fixes both, reusing the exact conventions already
-- established in the prior migration (governance_context_is_valid,
-- governance_audit_payload_is_allowed, row-level locking via `for update`,
-- domain_events + audit_outbox as the one evidence trail — no second outbox
-- is introduced; `audit_outbox` already has the shape this needs).
--
-- OUT OF SCOPE, DELIBERATELY: this migration does NOT touch
-- `approval_requests.project_id` or `.expires_at` nullability. See the
-- Phase 3B report for why: both columns are populated exclusively from the
-- Execution Approval Envelope (`p_envelope #>> '{project,projectId}'` and
-- `p_envelope ->> 'expiresAt'` in `create_requested_approval`), and the
-- envelope's Zod schema (`execution-approval-envelope.schema.ts`) requires
-- both to be non-null before the RPC is ever reachable — validated by
-- `validateExecutionApprovalEnvelope` in the (protected, out-of-scope)
-- `ApprovalExecutionRepository.createRequestedApproval`. The envelope schema
-- is explicitly out of scope for this phase, so no caller can present a null
-- project or a null expiry through the real creation path regardless of what
-- this table's own constraints say. Relaxing the column constraints without
-- also relaxing the envelope would be unreachable in practice, and would
-- require rewriting every `<>` scope/consistency comparison against
-- `project_id` across all five approval RPCs to null-safe `IS DISTINCT FROM`
-- semantics to avoid silently defeating the `governance_context_is_valid`
-- and `governance_project_scope_is_valid` authorization guards under SQL's
-- three-valued NULL logic (an `if not (x <> null) then raise` never raises,
-- since `x <> null` and `not (x <> null)` are both NULL, not TRUE). That is
-- real, security-relevant work with no reachable payoff until the envelope
-- itself changes, so it is left undone here and reported as a traced,
-- unresolved dependency rather than silently worked around.

create or replace function public.record_approval_decision(
  p_approval_id uuid, p_owner_id uuid, p_project_id uuid, p_envelope_hash text, p_decision text,
  p_approver_principal_id text, p_approver_identity_version text, p_authority_snapshot jsonb,
  p_policy_version text, p_policy_decision_hash text, p_reason text, p_authorization_context jsonb,
  p_correlation_id uuid, p_event_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_request public.approval_requests%rowtype;
  v_decision_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_new_state text;
begin
  if p_decision not in ('APPROVE', 'REJECT') then raise exception 'invalid approval decision'; end if;
    if not public.governance_context_is_valid(p_authorization_context, p_owner_id, p_project_id, p_authorization_context ->> 'tenantId')
      or not public.governance_audit_payload_is_allowed(p_event_payload) then raise exception 'invalid authorization context or audit payload'; end if;
    if p_authorization_context ->> 'authenticatedPrincipalId' <> p_approver_principal_id then raise exception 'approver identity mismatch'; end if;
  select * into v_request from public.approval_requests where approval_id = p_approval_id for update;
  if not found or v_request.owner_id <> p_owner_id or v_request.project_id <> p_project_id or v_request.tenant_id <> p_authorization_context ->> 'tenantId' or v_request.envelope_hash <> p_envelope_hash then raise exception 'approval scope or envelope mismatch'; end if;
  if v_request.expires_at <= now() then
    if v_request.state = 'REQUESTED' then update public.approval_requests set state = 'EXPIRED', finalized_at = now() where approval_id = p_approval_id; end if;
    return jsonb_build_object('approvalId', p_approval_id, 'state', 'EXPIRED', 'replayed', false);
  end if;
  if v_request.state <> 'REQUESTED' then raise exception 'approval already decided'; end if;
  -- FIX (Phase 3B, defect 1): the decision must actually land on the parent
  -- row's `state`, not just on the child `approval_decisions` audit row.
  -- REQUESTED -> APPROVED / REQUESTED -> REJECTED are both already legal
  -- transitions under `governance_protect_approval_request()`'s trigger, so
  -- no trigger change is required — only this write was missing.
  v_new_state := case p_decision when 'APPROVE' then 'APPROVED' else 'REJECTED' end;
  insert into public.approval_decisions (decision_id, approval_id, owner_id, project_id, decision, approver_principal_id, approver_identity_version, authority_snapshot, policy_version, policy_decision_hash, envelope_hash, reason)
  values (v_decision_id, p_approval_id, p_owner_id, p_project_id, p_decision, p_approver_principal_id, p_approver_identity_version, p_authority_snapshot, p_policy_version, p_policy_decision_hash, p_envelope_hash, p_reason);
  if v_new_state = 'REJECTED' then
    -- REJECTED is terminal (no transition out of it exists in the trigger),
    -- so it gets `finalized_at` the same way EXPIRED/FULFILLED do elsewhere
    -- in this file — `finalized_at` marks "this record's lifecycle is over".
    update public.approval_requests set state = v_new_state, finalized_at = now() where approval_id = p_approval_id;
  else
    -- APPROVED is not terminal (it can still go to REVOKED, EXPIRED, or
    -- FULFILLMENT_IN_PROGRESS), so finalized_at stays null, consistent with
    -- how `claim_approval_redemption` treats the APPROVED state elsewhere.
    update public.approval_requests set state = v_new_state where approval_id = p_approval_id;
  end if;
  insert into public.domain_events (id, type, occurred_at, owner_id, project_id, correlation_id, causation_id, epistemic_state, payload)
  values (v_event_id, 'approval.decision', now(), p_owner_id, p_project_id, p_correlation_id, p_approval_id, 'CONFIRMED', p_event_payload);
  insert into public.audit_outbox (outbox_id, aggregate_type, aggregate_id, event_type, event_version, owner_id, project_id, tenant_id, approval_id, correlation_id, causation_id, envelope_hash, payload, payload_digest, occurred_at)
  values (v_event_id, 'APPROVAL', p_approval_id, 'approval.decision', 'v1', p_owner_id, p_project_id, v_request.tenant_id, p_approval_id, p_correlation_id, p_approval_id, p_envelope_hash, p_event_payload, encode(digest(p_event_payload::text, 'sha256'), 'hex'), now());
  -- FIX (return-type truthfulness, Phase 3B item 10): report the state the
  -- row now actually has, not a hard-coded literal. This is a deliberate,
  -- flagged break from the prior contract — see the Phase 3B report: the
  -- protected TS wrapper (`ApprovalExecutionRepository.recordApprovalDecision`)
  -- currently asserts `state !== "REQUESTED"` throws, so it will now reject
  -- every successful call until that file is updated in a future,
  -- explicitly-approved phase. Returning the true state was judged correct
  -- over preserving compatibility with an assertion that encoded the bug.
  return jsonb_build_object('decisionId', v_decision_id, 'approvalId', p_approval_id, 'state', v_new_state);
end;
$$;

-- FIX (Phase 3B, defect 2): the missing revoke path. Mirrors the existing
-- functions' shape exactly: same authorization-context and audit-payload
-- guards, same row-level lock via `for update`, same scope/envelope
-- consistency check, same domain_events + audit_outbox evidence trail.
--
-- Semantics deliberately mirror the live `revokeApprovalRequest`
-- (`apps/api/src/services/approvals.ts`) principle "REVOCATION BEATS
-- APPROVAL" as closely as the durable state machine allows:
--   - REQUESTED and APPROVED can be revoked (the trigger already permits
--     both transitions to REVOKED; this function is the first thing that
--     ever exercises that permission).
--   - Anything already terminal, or already past APPROVED into
--     FULFILLMENT_IN_PROGRESS/FULFILLED/CONSUMED_FAILED/OUTCOME_UNKNOWN, is
--     refused with a hard exception (not a soft/typed result) — matching the
--     live system's refusal to let a REVOKED status retroactively claim an
--     executed action was never authorized.
--   - Unlike `claim_approval_redemption`/`finalize_approval_redemption`,
--     this is not an idempotency-key-based operation, so a second revoke
--     attempt on an already-REVOKED row is refused as a hard error, not
--     replayed — again matching the live system's behavior for REVOKED
--     ("refused; already terminal").
create or replace function public.revoke_approval(
  p_approval_id uuid, p_owner_id uuid, p_project_id uuid, p_envelope_hash text,
  p_revoker_principal_id text, p_reason text, p_authorization_context jsonb,
  p_correlation_id uuid, p_event_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_request public.approval_requests%rowtype;
  v_event_id uuid := gen_random_uuid();
begin
  if not public.governance_context_is_valid(p_authorization_context, p_owner_id, p_project_id, p_authorization_context ->> 'tenantId')
    or not public.governance_audit_payload_is_allowed(p_event_payload) then raise exception 'invalid authorization context or audit payload'; end if;
  if p_authorization_context ->> 'authenticatedPrincipalId' <> p_revoker_principal_id then raise exception 'revoker identity mismatch'; end if;
  select * into v_request from public.approval_requests where approval_id = p_approval_id for update;
  if not found or v_request.owner_id <> p_owner_id or v_request.project_id <> p_project_id or v_request.envelope_hash <> p_envelope_hash then raise exception 'approval scope or envelope mismatch'; end if;
  if v_request.state not in ('REQUESTED', 'APPROVED') then
    raise exception 'approval % cannot be revoked from state % — only REQUESTED or APPROVED approvals can be revoked', p_approval_id, v_request.state;
  end if;
  update public.approval_requests set state = 'REVOKED', finalized_at = now() where approval_id = p_approval_id;
  insert into public.domain_events (id, type, occurred_at, owner_id, project_id, correlation_id, causation_id, epistemic_state, payload)
  values (v_event_id, 'approval.revoked', now(), p_owner_id, p_project_id, p_correlation_id, p_approval_id, 'CONFIRMED', p_event_payload);
  insert into public.audit_outbox (outbox_id, aggregate_type, aggregate_id, event_type, event_version, owner_id, project_id, tenant_id, approval_id, correlation_id, causation_id, envelope_hash, payload, payload_digest, occurred_at)
  values (v_event_id, 'APPROVAL', p_approval_id, 'approval.revoked', 'v1', p_owner_id, p_project_id, v_request.tenant_id, p_approval_id, p_correlation_id, p_approval_id, p_envelope_hash, p_event_payload, encode(digest(p_event_payload::text, 'sha256'), 'hex'), now());
  return jsonb_build_object('approvalId', p_approval_id, 'state', 'REVOKED');
end;
$$;

revoke all on function public.revoke_approval(uuid, uuid, uuid, text, text, text, jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.revoke_approval(uuid, uuid, uuid, text, text, text, jsonb, uuid, jsonb) to service_role;
