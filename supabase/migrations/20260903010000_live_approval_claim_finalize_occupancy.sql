-- CP1: claim / mark-started / finalize occupancy on the LIVE approval authority.
-- Extends public.live_approval_requests only. This is NOT Unit 2
-- (approval_requests / approval_redemptions / execution_receipts) and does
-- not use ExecutionApprovalEnvelopeV1.
--
-- Added transitions:
--   APPROVED -> CLAIMED | REVOKED | CONSUMED (consume kept until CP6)
--   CLAIMED  -> FULFILLED | FAILED | OUTCOME_UNKNOWN
-- CLAIMED -> APPROVED (reclaim) is forbidden.

do $$
declare
  v_con name;
begin
  select conname into v_con
  from pg_constraint
  where conrelid = 'public.live_approval_requests'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%PENDING%APPROVED%REJECTED%CONSUMED%REVOKED%';
  if v_con is not null then
    execute format('alter table public.live_approval_requests drop constraint %I', v_con);
  end if;
end $$;

alter table public.live_approval_requests
  add column if not exists live_execution_id uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text
    check (claimed_by is null or char_length(claimed_by) between 1 and 200),
  add column if not exists request_id text
    check (request_id is null or char_length(request_id) between 1 and 200),
  add column if not exists execution_started_at timestamptz,
  add column if not exists finalized_at timestamptz,
  add column if not exists final_outcome text
    check (final_outcome is null or final_outcome in ('FULFILLED', 'FAILED', 'OUTCOME_UNKNOWN')),
  add column if not exists finalize_reason text
    check (finalize_reason is null or char_length(finalize_reason) between 1 and 2000),
  add column if not exists runtime_execution_id text
    check (runtime_execution_id is null or char_length(runtime_execution_id) between 1 and 128),
  add column if not exists output_evidence text
    check (output_evidence is null or char_length(output_evidence) between 1 and 4000);

alter table public.live_approval_requests
  add constraint live_approval_requests_status_check
  check (status in (
    'PENDING', 'APPROVED', 'REJECTED', 'CONSUMED', 'CLAIMED',
    'FULFILLED', 'FAILED', 'OUTCOME_UNKNOWN', 'REVOKED'
  ));

alter table public.live_approval_requests
  add constraint live_approval_requests_final_outcome_matches_status
  check (
    (status in ('FULFILLED', 'FAILED', 'OUTCOME_UNKNOWN') and final_outcome = status)
    or (status not in ('FULFILLED', 'FAILED', 'OUTCOME_UNKNOWN') and final_outcome is null)
  );

create unique index if not exists live_approval_requests_live_execution_id_uidx
  on public.live_approval_requests (live_execution_id)
  where live_execution_id is not null;

create or replace function public.live_approval_request_to_json(
  p_row public.live_approval_requests
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', p_row.id,
    'entityType', p_row.entity_type,
    'action', p_row.action,
    'requestedBy', p_row.requested_by,
    'requestedAt', to_char(p_row.requested_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', p_row.status,
    'reason', p_row.reason,
    'context', p_row.context,
    'artifactHash', p_row.artifact_hash,
    'expiresAt', case
      when p_row.expires_at is null then null
      else to_char(p_row.expires_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    end,
    'expectedObservations', to_jsonb(p_row.expected_observations),
    'baselineObservations', to_jsonb(p_row.baseline_observations),
    'revokedBy', p_row.revoked_by,
    'revokedAt', case
      when p_row.revoked_at is null then null
      else to_char(p_row.revoked_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    end,
    'revocationReason', p_row.revocation_reason,
    'decidedBy', p_row.decided_by,
    'decidedAt', case
      when p_row.decided_at is null then null
      else to_char(p_row.decided_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    end,
    'decisionReason', p_row.decision_reason,
    'liveExecutionId', p_row.live_execution_id,
    'claimedAt', case
      when p_row.claimed_at is null then null
      else to_char(p_row.claimed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    end,
    'claimedBy', p_row.claimed_by,
    'requestId', p_row.request_id,
    'executionStartedAt', case
      when p_row.execution_started_at is null then null
      else to_char(p_row.execution_started_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    end,
    'finalizedAt', case
      when p_row.finalized_at is null then null
      else to_char(p_row.finalized_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    end,
    'finalOutcome', p_row.final_outcome,
    'finalizeReason', p_row.finalize_reason,
    'runtimeExecutionId', p_row.runtime_execution_id,
    'outputEvidence', p_row.output_evidence
  );
$$;

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
    (old.status = 'PENDING' and new.status in ('APPROVED', 'REJECTED', 'REVOKED'))
    or (old.status = 'APPROVED' and new.status in ('CONSUMED', 'CLAIMED', 'REVOKED'))
    or (old.status = 'CLAIMED' and new.status = 'CLAIMED')
    or (old.status = 'CLAIMED' and new.status in ('FULFILLED', 'FAILED', 'OUTCOME_UNKNOWN'))
  ) then
    raise exception 'illegal live approval transition from % to %', old.status, new.status;
  end if;
  return new;
end;
$$;

create or replace function public.list_live_approval_requests(p_status text)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  if p_status is not null and p_status not in (
    'PENDING', 'APPROVED', 'REJECTED', 'CONSUMED', 'CLAIMED',
    'FULFILLED', 'FAILED', 'OUTCOME_UNKNOWN', 'REVOKED'
  ) then
    raise exception 'invalid live approval status filter';
  end if;
  return coalesce((
    select jsonb_agg(public.live_approval_request_to_json(r) order by r.requested_at desc)
    from public.live_approval_requests r
    where p_status is null or r.status = p_status
  ), '[]'::jsonb);
end;
$$;

create or replace function public.revoke_live_approval_request(
  p_id uuid,
  p_revoked_by text,
  p_reason text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_row public.live_approval_requests%rowtype;
begin
  select * into v_row from public.live_approval_requests where id = p_id for update;
  if not found then
    raise exception 'Approval request % not found', p_id;
  end if;
  if v_row.status = 'CONSUMED' then
    raise exception 'Approval request % has already been CONSUMED and cannot be revoked — the execution it authorized already happened', p_id;
  end if;
  if v_row.status in ('CLAIMED', 'FULFILLED', 'FAILED', 'OUTCOME_UNKNOWN') then
    raise exception 'Approval request % cannot be revoked (status=%); claimed or finalized approvals cannot be revoked', p_id, v_row.status;
  end if;
  if v_row.status <> 'PENDING' and v_row.status <> 'APPROVED' then
    raise exception 'Approval request % cannot be revoked (status=%); only PENDING or APPROVED requests can be revoked', p_id, v_row.status;
  end if;
  update public.live_approval_requests
    set status = 'REVOKED',
        revoked_by = p_revoked_by,
        revoked_at = now(),
        revocation_reason = p_reason
    where id = p_id
    returning * into v_row;
  return public.live_approval_request_to_json(v_row);
end;
$$;

create or replace function public.claim_live_approval_request(
  p_id uuid,
  p_entity_type text,
  p_action text,
  p_executor_id text,
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
     or p_executor_id is null or char_length(p_executor_id) = 0 then
    raise exception 'claim requires entityType, action, and executorId';
  end if;
  select * into v_row from public.live_approval_requests where id = p_id for update;
  if not found then
    raise exception 'Approval request % not found', p_id;
  end if;
  if v_row.status = 'REVOKED' then
    raise exception 'Approval request % was REVOKED by % at % and can never authorize an action',
      p_id, coalesce(v_row.revoked_by, 'unknown'), coalesce(v_row.revoked_at::text, 'unknown time');
  end if;
  if v_row.status <> 'APPROVED' then
    raise exception 'Approval request % is not APPROVED (status=%) and cannot be claimed', p_id, v_row.status;
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
  if p_executor_id <> v_row.requested_by then
    raise exception 'Approval request % was requested by % and cannot be claimed by %', p_id, v_row.requested_by, p_executor_id;
  end if;
  v_artifact := v_row.artifact_hash;
  if v_artifact is not null then
    if p_artifact_hash is null or char_length(p_artifact_hash) = 0 then
      raise exception 'Approval request % is bound to a specific artifact; claiming it requires presenting that artifact''s hash', p_id;
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
        artifact_hash = v_artifact,
        live_execution_id = v_execution_id,
        claimed_at = now(),
        claimed_by = p_executor_id,
        request_id = nullif(p_request_id, '')
    where id = p_id
    returning * into v_row;
  return public.live_approval_request_to_json(v_row);
end;
$$;

create or replace function public.mark_live_approval_execution_started(
  p_id uuid,
  p_live_execution_id uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_row public.live_approval_requests%rowtype;
begin
  select * into v_row from public.live_approval_requests where id = p_id for update;
  if not found then
    raise exception 'Approval request % not found', p_id;
  end if;
  if v_row.status <> 'CLAIMED' then
    raise exception 'Approval request % is not CLAIMED (status=%) and cannot mark execution started', p_id, v_row.status;
  end if;
  if v_row.live_execution_id is distinct from p_live_execution_id then
    raise exception 'liveExecutionId does not match';
  end if;
  if v_row.execution_started_at is not null then
    return public.live_approval_request_to_json(v_row);
  end if;
  update public.live_approval_requests
    set execution_started_at = now()
    where id = p_id
    returning * into v_row;
  return public.live_approval_request_to_json(v_row);
end;
$$;

create or replace function public.finalize_live_approval_request(
  p_id uuid,
  p_live_execution_id uuid,
  p_outcome text,
  p_reason text,
  p_runtime_execution_id text,
  p_output_evidence text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_row public.live_approval_requests%rowtype;
  v_reason text;
begin
  if p_outcome not in ('FULFILLED', 'FAILED', 'OUTCOME_UNKNOWN') then
    raise exception 'invalid terminal outcome';
  end if;
  select * into v_row from public.live_approval_requests where id = p_id for update;
  if not found then
    raise exception 'Approval request % not found', p_id;
  end if;
  if v_row.status in ('FULFILLED', 'FAILED', 'OUTCOME_UNKNOWN') then
    if v_row.live_execution_id is distinct from p_live_execution_id then
      raise exception 'liveExecutionId does not match';
    end if;
    if v_row.final_outcome = p_outcome then
      return public.live_approval_request_to_json(v_row);
    end if;
    raise exception 'conflicting terminal outcome';
  end if;
  if v_row.status <> 'CLAIMED' then
    raise exception 'Approval request % is not CLAIMED (status=%) and cannot be finalized', p_id, v_row.status;
  end if;
  if v_row.live_execution_id is distinct from p_live_execution_id then
    raise exception 'liveExecutionId does not match';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_outcome = 'FULFILLED' then
    if (p_runtime_execution_id is null or char_length(p_runtime_execution_id) = 0)
       and (p_output_evidence is null or char_length(p_output_evidence) = 0) then
      raise exception 'FULFILLED requires execution evidence';
    end if;
  elsif p_outcome = 'FAILED' then
    if v_reason is null then
      raise exception 'FAILED requires a reason';
    end if;
  else
    if v_row.execution_started_at is null then
      raise exception 'OUTCOME_UNKNOWN requires execution to have started';
    end if;
    if v_reason is null then
      raise exception 'OUTCOME_UNKNOWN requires a reason';
    end if;
  end if;
  update public.live_approval_requests
    set status = p_outcome,
        finalized_at = now(),
        final_outcome = p_outcome,
        finalize_reason = v_reason,
        runtime_execution_id = nullif(p_runtime_execution_id, ''),
        output_evidence = nullif(p_output_evidence, '')
    where id = p_id
    returning * into v_row;
  return public.live_approval_request_to_json(v_row);
end;
$$;

revoke all on function public.claim_live_approval_request(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.mark_live_approval_execution_started(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_live_approval_request(uuid, uuid, text, text, text, text) from public, anon, authenticated;

grant execute on function public.claim_live_approval_request(uuid, text, text, text, text, text) to service_role;
grant execute on function public.mark_live_approval_execution_started(uuid, uuid) to service_role;
grant execute on function public.finalize_live_approval_request(uuid, uuid, text, text, text, text) to service_role;
