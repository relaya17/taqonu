-- CP7.2: HUMAN_ONLY live-human decision path.
--
-- Extends public.live_approval_requests only. Adds exactly one new legal
-- state transition (PENDING -> CLAIMED) and exactly one new RPC. Does NOT
-- modify create_live_approval_request, decide_live_approval_request,
-- claim_live_approval_request, consume_live_approval_request,
-- mark_live_approval_execution_started, or finalize_live_approval_request --
-- those keep their existing signatures and semantics unchanged, and
-- continue to serve the approval-token-replay flow exactly as before.
--
-- Why a new transition and a new RPC, not a workaround in TypeScript:
-- `HUMAN_ONLY` (see apps/api/src/services/agent-dispatch-guard.ts) must
-- never be satisfiable by a claimed, previously-APPROVED token -- that is
-- "approval-token replay", the exact thing HUMAN_ONLY exists to forbid.
-- The existing two-step flow (decide_live_approval_request now, claim
-- later) always produces an externally-observable, separately-claimable
-- APPROVED row in between -- which IS a reusable execution authority,
-- indistinguishable from a replayed token once it exists. There is no way
-- to express "a live human decided AND claimed this, atomically, with no
-- resting authority in between" using the existing RPCs. This migration
-- adds that missing state transition, narrowly, as a new function -- the
-- old transition (PENDING -> APPROVED -> CLAIMED) is untouched and still
-- the only path available to every existing caller.

-- 1. Extend the transition-legality trigger with exactly one new clause.
-- This is the verbatim, current body of live_approval_protect() (as of
-- migration 20260903010000) with one addition:
--   (old.status = 'PENDING' and new.status = 'CLAIMED')
-- Every other clause, and the mutable-fields allowlist, is unchanged.
create or replace function public.live_approval_protect()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_mutable text[] := array[
    'status',
    'decided_by', 'decided_at', 'decision_reason',
    'revoked_by', 'revoked_at', 'revocation_reason',
    'artifact_hash',
    'live_execution_id', 'claimed_at', 'claimed_by', 'request_id',
    'execution_started_at',
    'finalized_at', 'final_outcome', 'finalize_reason',
    'runtime_execution_id', 'output_evidence'
  ];
begin
  if tg_op = 'DELETE' then
    raise exception 'live approval records are immutable';
  end if;
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'live approval identity fields are immutable';
  end if;
  if old.artifact_hash is not null and new.artifact_hash is distinct from old.artifact_hash then
    raise exception 'live approval artifactHash is immutable once bound';
  end if;
  if old.live_execution_id is not null and new.live_execution_id is distinct from old.live_execution_id then
    raise exception 'liveExecutionId cannot be replaced';
  end if;
  if not (
    (old.status = 'PENDING' and new.status in ('APPROVED', 'REJECTED', 'REVOKED', 'CLAIMED'))
    or (old.status = 'APPROVED' and new.status in ('CONSUMED', 'CLAIMED', 'REVOKED'))
    or (old.status = 'CLAIMED' and new.status = 'CLAIMED')
    or (old.status = 'CLAIMED' and new.status in ('FULFILLED', 'FAILED', 'OUTCOME_UNKNOWN'))
  ) then
    raise exception 'illegal live approval transition from % to %', old.status, new.status;
  end if;
  return new;
end;
$$;

-- 2. The new RPC: a single atomic PENDING -> CLAIMED transition that
-- records the live human's decision (decided_by/decided_at/decision_reason)
-- and the claim (claimed_by/claimed_at/live_execution_id) in one UPDATE.
-- There is no intermediate APPROVED row for this path -- the row is either
-- still PENDING (nothing committed yet) or already CLAIMED (fully
-- committed). A crash on either side of this one statement leaves the
-- database in one of those two states; there is no reusable "APPROVED,
-- awaiting execution" authority produced at any point.
--
-- claimed_by is set to p_decided_by directly -- the real, live-authenticated
-- human is the executor of record, not a stand-in for requested_by. This
-- intentionally departs from claim_live_approval_request's
-- executor-must-equal-requester contract, because that contract encodes a
-- different scenario (the same agent that asked also eventually executes).
-- Here the scenario is the opposite by design: separation of duties
-- requires the decider to differ from the requester, so requiring
-- executor === requester would be self-contradictory.
create or replace function public.claim_live_approval_request_as_live_human(
  p_id uuid,
  p_entity_type text,
  p_action text,
  p_decided_by text,
  p_decision_reason text,
  p_artifact_hash text,
  p_request_id text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_row public.live_approval_requests%rowtype;
  v_artifact text;
  v_execution_id uuid;
begin
  if p_entity_type is null or char_length(p_entity_type) = 0
     or p_action is null or char_length(p_action) = 0
     or p_decided_by is null or char_length(p_decided_by) = 0 then
    raise exception 'live-human claim requires entityType, action, and decidedBy';
  end if;
  select * into v_row from public.live_approval_requests where id = p_id for update;
  if not found then
    raise exception 'Approval request % not found', p_id;
  end if;
  if v_row.status = 'REVOKED' then
    raise exception 'Approval request % was REVOKED by % at % and can never authorize an action',
      p_id, coalesce(v_row.revoked_by, 'unknown'), coalesce(v_row.revoked_at::text, 'unknown time');
  end if;
  if v_row.status <> 'PENDING' then
    raise exception 'Approval request % is not PENDING (status=%) and cannot be claimed by a live human decision -- a live-human decision is only valid against a fresh, undecided request, never a previously-decided, already-claimed, or replayed one',
      p_id, v_row.status;
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'Approval request % expired at % and can no longer authorize an action', p_id, v_row.expires_at;
  end if;
  if p_entity_type <> v_row.entity_type then
    raise exception 'Approval request % authorizes entityType %, not %', p_id, v_row.entity_type, p_entity_type;
  end if;
  if p_action <> v_row.action then
    raise exception 'Approval request % authorizes action %, not %', p_id, v_row.action, p_action;
  end if;
  if p_decided_by = v_row.requested_by then
    raise exception 'Approval request % was requested by % -- separation of duties forbids the same identity from also being the live human who decides and claims it',
      p_id, v_row.requested_by;
  end if;
  v_artifact := v_row.artifact_hash;
  if v_artifact is not null then
    if p_artifact_hash is null or char_length(p_artifact_hash) = 0 then
      raise exception 'Approval request % is bound to a specific artifact; a live-human claim requires presenting that artifact''s hash', p_id;
    end if;
    if p_artifact_hash <> v_artifact then
      raise exception 'Approval request % authorizes artifact %, not % — the approved artifact changed after sign-off',
        p_id, v_artifact, p_artifact_hash;
    end if;
  elsif p_artifact_hash is not null and char_length(p_artifact_hash) > 0 then
    v_artifact := p_artifact_hash;
  end if;
  v_execution_id := gen_random_uuid();
  update public.live_approval_requests
    set status = 'CLAIMED',
        decided_by = p_decided_by,
        decided_at = now(),
        decision_reason = p_decision_reason,
        artifact_hash = v_artifact,
        live_execution_id = v_execution_id,
        claimed_at = now(),
        claimed_by = p_decided_by,
        request_id = nullif(p_request_id, '')
    where id = p_id
    returning * into v_row;
  return public.live_approval_request_to_json(v_row);
end;
$$;

revoke all on function public.claim_live_approval_request_as_live_human(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_live_approval_request_as_live_human(uuid, text, text, text, text, text, text) to service_role;
