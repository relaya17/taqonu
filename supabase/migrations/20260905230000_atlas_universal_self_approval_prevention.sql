-- ATLAS — Universal Self-Approval Prevention (Dual Control):
--
-- Until now, "the requester cannot also be the decider" was enforced at
-- decide_live_approval_request(...) ONLY for Atlas's own self-audit
-- approvals (applicationId = 'def-000' / the DEF-000 self-governance
-- project) -- see 20260903170000_atlas_self_approval_separation.sql. Every
-- ordinary approval (the vast majority: CONFIGURATION.EXECUTE,
-- DOCUMENT.EXECUTE, RECORD.*, etc. requested by an agent or a human on
-- behalf of a portfolio application) had NO separation-of-duties check at
-- decide time at all -- the same identity that requested an action could
-- also approve it.
--
-- claim_live_approval_request_as_live_human(...) (20260903020000) already
-- got this right: its requester/decider check
-- (`p_decided_by = v_row.requested_by`) has always been unconditional, for
-- every approval, not just Atlas-self ones. This migration generalizes
-- decide_live_approval_request(...) to match that existing, stronger
-- pattern -- extending it to every approval instead of only DEF-000 -- and
-- hardens BOTH functions' identity comparison to be resilient to a
-- whitespace or casing difference (trim + case-fold), so an
-- otherwise-identical identity string cannot slip past the check in either
-- disguise.
--
-- Nothing else about either function changes: expiry enforcement (added in
-- 20260905220000 / 20260903010000 / 20260903020000), status-transition
-- checks, artifact binding, and every other guard are preserved verbatim.

create or replace function public.decide_live_approval_request(
  p_id uuid,
  p_decided_by text,
  p_approve boolean,
  p_decision_reason text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_row public.live_approval_requests%rowtype;
  v_status text;
begin
  select * into v_row from public.live_approval_requests where id = p_id for update;
  if not found then
    raise exception 'Approval request % not found', p_id;
  end if;
  if v_row.status <> 'PENDING' then
    raise exception 'Approval request % has already been decided (status=%)', p_id, v_row.status;
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'Approval request % expired at % and can no longer authorize an action', p_id, v_row.expires_at;
  end if;
  -- Universal Self-Approval Prevention: applies to every approval request,
  -- not only Atlas's own self-audit ones (which this used to be scoped
  -- to). Trim + case-fold both sides so a whitespace or casing difference
  -- in an otherwise-identical identity cannot bypass the check.
  if lower(trim(p_decided_by)) = lower(trim(v_row.requested_by)) then
    raise exception 'Approval request % was requested by % -- separation of duties forbids the same identity from also deciding it',
      p_id, v_row.requested_by;
  end if;
  v_status := case when p_approve then 'APPROVED' else 'REJECTED' end;
  update public.live_approval_requests
    set status = v_status,
        decided_by = p_decided_by,
        decided_at = now(),
        decision_reason = p_decision_reason
    where id = p_id
    returning * into v_row;
  return public.live_approval_request_to_json(v_row);
end;
$$;

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
  -- Same normalized comparison as decide_live_approval_request above --
  -- this check was already unconditional here, only the trim/case-fold is
  -- new, for consistency and to close the same whitespace/casing gap.
  if lower(trim(p_decided_by)) = lower(trim(v_row.requested_by)) then
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
