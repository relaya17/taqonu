-- Phase 3F: durable authority for the LIVE ApprovalRequest contract
-- (apps/api/src/services/approvals.ts). This is NOT Unit 2
-- `public.approval_requests` and does not use ExecutionApprovalEnvelopeV1.
--
-- Lifecycle (unchanged from the process-local store):
--   PENDING -> APPROVED | REJECTED | REVOKED
--   APPROVED -> CONSUMED | REVOKED
-- Consume is one-shot under row lock.

create table public.live_approval_requests (
  id uuid primary key,
  entity_type text not null check (char_length(entity_type) between 1 and 200),
  action text not null check (char_length(action) between 1 and 200),
  requested_by text not null check (char_length(requested_by) between 1 and 200),
  requested_at timestamptz not null,
  status text not null check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CONSUMED', 'REVOKED')),
  reason text not null check (char_length(reason) between 1 and 2000),
  context jsonb not null default '{}'::jsonb,
  artifact_hash text check (artifact_hash is null or char_length(artifact_hash) between 1 and 128),
  expires_at timestamptz,
  expected_observations text[] not null default '{}',
  baseline_observations text[] not null default '{}',
  revoked_by text check (revoked_by is null or char_length(revoked_by) between 1 and 200),
  revoked_at timestamptz,
  revocation_reason text check (revocation_reason is null or char_length(revocation_reason) between 1 and 2000),
  decided_by text check (decided_by is null or char_length(decided_by) between 1 and 200),
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) between 1 and 2000)
);

create index live_approval_requests_status_requested_idx
  on public.live_approval_requests (status, requested_at desc);

alter table public.live_approval_requests enable row level security;

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
    'decisionReason', p_row.decision_reason
  );
$$;

create or replace function public.live_approval_protect()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'live approval records are immutable';
  end if;
  if (to_jsonb(new) - array['status', 'decided_by', 'decided_at', 'decision_reason', 'revoked_by', 'revoked_at', 'revocation_reason'])
       is distinct from
     (to_jsonb(old) - array['status', 'decided_by', 'decided_at', 'decision_reason', 'revoked_by', 'revoked_at', 'revocation_reason']) then
    raise exception 'live approval identity fields are immutable';
  end if;
  if not (
    (old.status = 'PENDING' and new.status in ('APPROVED', 'REJECTED', 'REVOKED'))
    or (old.status = 'APPROVED' and new.status in ('CONSUMED', 'REVOKED'))
  ) then
    raise exception 'illegal live approval transition from % to %', old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger live_approval_requests_protect
  before update or delete on public.live_approval_requests
  for each row execute function public.live_approval_protect();

create or replace function public.create_live_approval_request(
  p_entity_type text,
  p_action text,
  p_requested_by text,
  p_reason text,
  p_context jsonb,
  p_artifact_hash text,
  p_expires_at timestamptz,
  p_expected_observations text[],
  p_baseline_observations text[]
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_row public.live_approval_requests%rowtype;
begin
  insert into public.live_approval_requests (
    id, entity_type, action, requested_by, requested_at, status, reason, context,
    artifact_hash, expires_at, expected_observations, baseline_observations,
    revoked_by, revoked_at, revocation_reason, decided_by, decided_at, decision_reason
  ) values (
    gen_random_uuid(), p_entity_type, p_action, p_requested_by, now(), 'PENDING', p_reason,
    coalesce(p_context, '{}'::jsonb), p_artifact_hash, p_expires_at,
    coalesce(p_expected_observations, '{}'), coalesce(p_baseline_observations, '{}'),
    null, null, null, null, null, null
  ) returning * into v_row;
  return public.live_approval_request_to_json(v_row);
end;
$$;

create or replace function public.get_live_approval_request(p_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_row public.live_approval_requests%rowtype;
begin
  select * into v_row from public.live_approval_requests where id = p_id;
  if not found then
    return null;
  end if;
  return public.live_approval_request_to_json(v_row);
end;
$$;

create or replace function public.list_live_approval_requests(p_status text)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  if p_status is not null and p_status not in ('PENDING', 'APPROVED', 'REJECTED', 'CONSUMED', 'REVOKED') then
    raise exception 'invalid live approval status filter';
  end if;
  return coalesce((
    select jsonb_agg(public.live_approval_request_to_json(r) order by r.requested_at desc)
    from public.live_approval_requests r
    where p_status is null or r.status = p_status
  ), '[]'::jsonb);
end;
$$;

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

create or replace function public.consume_live_approval_request(
  p_id uuid,
  p_artifact_hash text,
  p_entity_type text,
  p_action text,
  p_agent_id text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_row public.live_approval_requests%rowtype;
begin
  select * into v_row from public.live_approval_requests where id = p_id for update;
  if not found then
    raise exception 'Approval request % not found', p_id;
  end if;
  if v_row.status = 'REVOKED' then
    raise exception 'Approval request % was REVOKED by % at % and can never authorize an action',
      p_id, coalesce(v_row.revoked_by, 'unknown'), coalesce(v_row.revoked_at::text, 'unknown time');
  end if;
  if v_row.status <> 'APPROVED' then
    raise exception 'Approval request % is not APPROVED (status=%) and cannot be consumed', p_id, v_row.status;
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'Approval request % expired at % and can no longer authorize an action', p_id, v_row.expires_at;
  end if;
  if p_entity_type is not null and p_entity_type <> v_row.entity_type then
    raise exception 'Approval request % authorizes entityType %, not %', p_id, v_row.entity_type, p_entity_type;
  end if;
  if p_action is not null and p_action <> v_row.action then
    raise exception 'Approval request % authorizes action %, not %', p_id, v_row.action, p_action;
  end if;
  if p_agent_id is not null and p_agent_id <> v_row.requested_by then
    raise exception 'Approval request % was requested by % and cannot be redeemed by %', p_id, v_row.requested_by, p_agent_id;
  end if;
  if v_row.artifact_hash is not null then
    if p_artifact_hash is null then
      raise exception 'Approval request % is bound to a specific artifact; consuming it requires presenting that artifact''s hash', p_id;
    end if;
    if p_artifact_hash <> v_row.artifact_hash then
      raise exception 'Approval request % authorizes artifact %, not % — the approved artifact changed after sign-off',
        p_id, v_row.artifact_hash, p_artifact_hash;
    end if;
  end if;
  update public.live_approval_requests
    set status = 'CONSUMED'
    where id = p_id
    returning * into v_row;
  return public.live_approval_request_to_json(v_row);
end;
$$;

revoke all on function public.create_live_approval_request(text, text, text, text, jsonb, text, timestamptz, text[], text[]) from public, anon, authenticated;
revoke all on function public.get_live_approval_request(uuid) from public, anon, authenticated;
revoke all on function public.list_live_approval_requests(text) from public, anon, authenticated;
revoke all on function public.decide_live_approval_request(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.revoke_live_approval_request(uuid, text, text) from public, anon, authenticated;
revoke all on function public.consume_live_approval_request(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on table public.live_approval_requests from public, anon, authenticated;

grant execute on function public.create_live_approval_request(text, text, text, text, jsonb, text, timestamptz, text[], text[]) to service_role;
grant execute on function public.get_live_approval_request(uuid) to service_role;
grant execute on function public.list_live_approval_requests(text) to service_role;
grant execute on function public.decide_live_approval_request(uuid, text, boolean, text) to service_role;
grant execute on function public.revoke_live_approval_request(uuid, text, text) to service_role;
grant execute on function public.consume_live_approval_request(uuid, text, text, text, text) to service_role;
grant all on table public.live_approval_requests to service_role;
