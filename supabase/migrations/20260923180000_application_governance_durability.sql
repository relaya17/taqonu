-- G16 R01+R02+R03: durable application connector nonce, preflight
-- decision / execution-report correlation, and canonical application audit.
--
-- Additive only. Does not alter approval, memory, or RLS policy design.
-- Writes are service-role (no INSERT policies for authenticated/anon).
-- Canonical application audit is inserted by these RPCs into public.audit_logs
-- in the SAME transaction as the operational rows. Node must not call
-- appendCanonicalAuditEntry() after these RPCs commit.

create table public.connector_nonces (
  application_id text not null check (char_length(application_id) between 1 and 64),
  nonce text not null check (char_length(nonce) between 8 and 128),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (application_id, nonce)
);

create index connector_nonces_expires_at_idx
  on public.connector_nonces (expires_at);

alter table public.connector_nonces enable row level security;

create table public.preflight_decisions (
  decision_id uuid primary key,
  request_id text not null check (char_length(request_id) between 1 and 200),
  application_id text not null check (char_length(application_id) between 1 and 64),
  tenant_id text not null check (char_length(tenant_id) between 1 and 200),
  project_id text not null check (char_length(project_id) between 1 and 200),
  operation text not null check (char_length(operation) between 1 and 200),
  operation_class text not null check (char_length(operation_class) between 1 and 64),
  decision text not null check (decision in (
    'ALLOW', 'DENY', 'REQUIRE_APPROVAL', 'KILLED', 'INVALID', 'OUT_OF_SCOPE'
  )),
  agent_id text check (agent_id is null or char_length(agent_id) between 1 and 200),
  approval_id uuid,
  http_status int not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'RECORDED' check (status in ('RECORDED', 'EXPIRED')),
  unique (application_id, request_id)
);

create index preflight_decisions_expires_at_idx
  on public.preflight_decisions (expires_at);

create index preflight_decisions_application_created_idx
  on public.preflight_decisions (application_id, created_at desc);

alter table public.preflight_decisions enable row level security;

create table public.preflight_idempotency (
  application_id text not null check (char_length(application_id) between 1 and 64),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  fingerprint text not null check (char_length(fingerprint) between 1 and 2000),
  decision_id uuid not null references public.preflight_decisions (decision_id),
  http_status int not null,
  created_at timestamptz not null default now(),
  primary key (application_id, idempotency_key)
);

alter table public.preflight_idempotency enable row level security;

create table public.execution_reports (
  decision_id uuid not null references public.preflight_decisions (decision_id),
  execution_id text not null check (char_length(execution_id) between 1 and 200),
  application_id text not null check (char_length(application_id) between 1 and 64),
  tenant_id text not null check (char_length(tenant_id) between 1 and 200),
  project_id text not null check (char_length(project_id) between 1 and 200),
  request_id text not null check (char_length(request_id) between 1 and 200),
  operation text not null check (char_length(operation) between 1 and 200),
  execution_status text not null check (execution_status in ('SUCCESS', 'FAILURE')),
  agent_id text check (agent_id is null or char_length(agent_id) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (decision_id, execution_id)
);

create index execution_reports_application_created_idx
  on public.execution_reports (application_id, created_at desc);

alter table public.execution_reports enable row level security;

-- ---------------------------------------------------------------------------
-- T0: consume nonce in its own committed transaction
-- ---------------------------------------------------------------------------
create or replace function public.consume_application_connector_nonce(
  p_application_id text,
  p_nonce text,
  p_expires_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_inserted int;
begin
  if p_application_id is null or char_length(p_application_id) < 1 then
    raise exception 'application_id is required';
  end if;
  if p_nonce is null or char_length(p_nonce) < 8 then
    raise exception 'nonce is required';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'nonce expires_at must be in the future';
  end if;

  delete from public.connector_nonces
   where expires_at <= now();

  insert into public.connector_nonces (application_id, nonce, expires_at)
  values (p_application_id, p_nonce, p_expires_at)
  on conflict (application_id, nonce) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'Application connector nonce has already been used'
    );
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Idempotency lookup (before evaluateAuthorized)
-- ---------------------------------------------------------------------------
create or replace function public.lookup_application_preflight_idempotency(
  p_application_id text,
  p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_idemp public.preflight_idempotency%rowtype;
  v_dec public.preflight_decisions%rowtype;
begin
  select * into v_idemp
    from public.preflight_idempotency
   where application_id = p_application_id
     and idempotency_key = p_idempotency_key;
  if not found then
    return null;
  end if;
  select * into v_dec
    from public.preflight_decisions
   where decision_id = v_idemp.decision_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'fingerprint', v_idemp.fingerprint,
    'decisionId', v_idemp.decision_id,
    'httpStatus', v_idemp.http_status,
    'response', v_dec.response
  );
end;
$$;

create or replace function public.lookup_application_preflight_decision(
  p_decision_id uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_dec public.preflight_decisions%rowtype;
begin
  select * into v_dec from public.preflight_decisions where decision_id = p_decision_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'decisionId', v_dec.decision_id,
    'requestId', v_dec.request_id,
    'applicationId', v_dec.application_id,
    'tenantId', v_dec.tenant_id,
    'projectId', v_dec.project_id,
    'operation', v_dec.operation,
    'operationClass', v_dec.operation_class,
    'decision', v_dec.decision,
    'agentId', v_dec.agent_id,
    'httpStatus', v_dec.http_status,
    'response', v_dec.response,
    'createdAt', to_char(v_dec.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt', to_char(v_dec.expires_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', v_dec.status,
    'expired', (v_dec.expires_at <= now() or v_dec.status = 'EXPIRED')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- T1: decision + idempotency + audit_logs in ONE transaction
-- The RPC itself writes public.audit_logs. Do not write audit from Node.
-- ---------------------------------------------------------------------------
create or replace function public.record_application_preflight_outcome(
  p_decision_id uuid,
  p_request_id text,
  p_application_id text,
  p_tenant_id text,
  p_project_id text,
  p_operation text,
  p_operation_class text,
  p_decision text,
  p_agent_id text,
  p_approval_id uuid,
  p_http_status int,
  p_response jsonb,
  p_expires_at timestamptz,
  p_idempotency_key text,
  p_fingerprint text,
  p_audit_id uuid,
  p_audit_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_existing public.preflight_idempotency%rowtype;
  v_dec public.preflight_decisions%rowtype;
begin
  if p_decision_id is null or p_audit_id is null then
    raise exception 'decision_id and audit_id are required';
  end if;
  if p_response is null or p_audit_payload is null then
    raise exception 'response and audit_payload are required';
  end if;

  select * into v_existing
    from public.preflight_idempotency
   where application_id = p_application_id
     and idempotency_key = p_idempotency_key
     for update;
  if found then
    if v_existing.fingerprint = p_fingerprint then
      select * into v_dec from public.preflight_decisions where decision_id = v_existing.decision_id;
      return jsonb_build_object(
        'kind', 'IDEMPOTENT_HIT',
        'decisionId', v_existing.decision_id,
        'httpStatus', v_existing.http_status,
        'response', v_dec.response,
        'auditId', null
      );
    end if;
    return jsonb_build_object(
      'kind', 'IDEMPOTENT_CONFLICT',
      'decisionId', v_existing.decision_id,
      'httpStatus', 409,
      'response', null,
      'auditId', null
    );
  end if;

  insert into public.preflight_decisions (
    decision_id, request_id, application_id, tenant_id, project_id,
    operation, operation_class, decision, agent_id, approval_id,
    http_status, response, expires_at, status
  ) values (
    p_decision_id, p_request_id, p_application_id, p_tenant_id, p_project_id,
    p_operation, p_operation_class, p_decision, p_agent_id, p_approval_id,
    p_http_status, p_response, p_expires_at, 'RECORDED'
  );

  insert into public.preflight_idempotency (
    application_id, idempotency_key, fingerprint, decision_id, http_status
  ) values (
    p_application_id, p_idempotency_key, p_fingerprint, p_decision_id, p_http_status
  );

  insert into public.audit_logs (
    id, owner_id, action, entity_type, entity_id, payload
  ) values (
    p_audit_id,
    null,
    coalesce(p_audit_payload->>'type', 'application.preflight.evaluated'),
    coalesce(p_audit_payload->>'entityType', 'application_preflight'),
    p_decision_id,
    p_audit_payload
  );

  return jsonb_build_object(
    'kind', 'RECORDED',
    'decisionId', p_decision_id,
    'httpStatus', p_http_status,
    'response', p_response,
    'auditId', p_audit_id
  );
exception
  when unique_violation then
    select * into v_existing
      from public.preflight_idempotency
     where application_id = p_application_id
       and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.fingerprint = p_fingerprint then
        select * into v_dec from public.preflight_decisions where decision_id = v_existing.decision_id;
        return jsonb_build_object(
          'kind', 'IDEMPOTENT_HIT',
          'decisionId', v_existing.decision_id,
          'httpStatus', v_existing.http_status,
          'response', v_dec.response,
          'auditId', null
        );
      end if;
      return jsonb_build_object(
        'kind', 'IDEMPOTENT_CONFLICT',
        'decisionId', v_existing.decision_id,
        'httpStatus', 409,
        'response', null,
        'auditId', null
      );
    end if;
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- T2: validate persisted decision + report + audit_logs in ONE transaction
-- decisionId alone is never sufficient.
-- ---------------------------------------------------------------------------
create or replace function public.record_application_execution_report(
  p_decision_id uuid,
  p_execution_id text,
  p_application_id text,
  p_tenant_id text,
  p_project_id text,
  p_request_id text,
  p_operation text,
  p_execution_status text,
  p_agent_id text,
  p_audit_id uuid,
  p_audit_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_dec public.preflight_decisions%rowtype;
  v_rep public.execution_reports%rowtype;
begin
  if p_decision_id is null or p_execution_id is null or p_audit_id is null then
    raise exception 'decision_id, execution_id, and audit_id are required';
  end if;

  select * into v_dec
    from public.preflight_decisions
   where decision_id = p_decision_id
     for share;
  if not found then
    return jsonb_build_object(
      'kind', 'REJECTED',
      'reason', 'No preceding preflight authorization exists for this decisionId'
    );
  end if;

  if v_dec.expires_at <= now() or v_dec.status = 'EXPIRED' then
    return jsonb_build_object(
      'kind', 'REJECTED',
      'reason', 'Preceding preflight authorization has expired'
    );
  end if;

  if v_dec.application_id is distinct from p_application_id then
    return jsonb_build_object(
      'kind', 'REJECTED',
      'reason', 'Execution report application does not match the preceding authorization'
    );
  end if;
  if v_dec.tenant_id is distinct from p_tenant_id
     or v_dec.project_id is distinct from p_project_id then
    return jsonb_build_object(
      'kind', 'REJECTED',
      'reason', 'Execution report tenant or project does not match the preceding authorization'
    );
  end if;
  if v_dec.request_id is distinct from p_request_id then
    return jsonb_build_object(
      'kind', 'REJECTED',
      'reason', 'Execution report requestId does not match the preceding authorization'
    );
  end if;
  if v_dec.operation is distinct from p_operation then
    return jsonb_build_object(
      'kind', 'REJECTED',
      'reason', 'Execution report operation does not match the preceding authorization'
    );
  end if;
  if v_dec.decision is distinct from 'ALLOW' then
    return jsonb_build_object(
      'kind', 'REJECTED',
      'reason', 'Execution report requires a preceding ALLOW; found ' || v_dec.decision
    );
  end if;
  if v_dec.agent_id is not null
     and p_agent_id is not null
     and v_dec.agent_id is distinct from p_agent_id then
    return jsonb_build_object(
      'kind', 'REJECTED',
      'reason', 'Execution report agentId does not match the preceding authorization'
    );
  end if;

  select * into v_rep
    from public.execution_reports
   where decision_id = p_decision_id
     and execution_id = p_execution_id;
  if found then
    if v_rep.execution_status is distinct from p_execution_status then
      return jsonb_build_object(
        'kind', 'CONFLICT',
        'reason', 'Conflicting execution report for the same decisionId and executionId'
      );
    end if;
    return jsonb_build_object(
      'kind', 'IDEMPOTENT_HIT',
      'reason', 'Replay of an already accepted execution report',
      'report', jsonb_build_object(
        'decisionId', v_rep.decision_id,
        'requestId', v_rep.request_id,
        'executionId', v_rep.execution_id,
        'executionStatus', v_rep.execution_status,
        'applicationId', v_rep.application_id,
        'tenantId', v_rep.tenant_id,
        'projectId', v_rep.project_id,
        'operation', v_rep.operation,
        'agentId', v_rep.agent_id
      )
    );
  end if;

  insert into public.execution_reports (
    decision_id, execution_id, application_id, tenant_id, project_id,
    request_id, operation, execution_status, agent_id
  ) values (
    p_decision_id, p_execution_id, p_application_id, p_tenant_id, p_project_id,
    p_request_id, p_operation, p_execution_status,
    coalesce(p_agent_id, v_dec.agent_id)
  )
  returning * into v_rep;

  insert into public.audit_logs (
    id, owner_id, action, entity_type, entity_id, payload
  ) values (
    p_audit_id,
    null,
    coalesce(p_audit_payload->>'type', 'application.execution.reported'),
    coalesce(p_audit_payload->>'entityType', 'application_execution_report'),
    p_decision_id,
    p_audit_payload
  );

  return jsonb_build_object(
    'kind', 'RECORDED',
    'reason', 'Execution report correlated to a preceding ALLOW',
    'report', jsonb_build_object(
      'decisionId', v_rep.decision_id,
      'requestId', v_rep.request_id,
      'executionId', v_rep.execution_id,
      'executionStatus', v_rep.execution_status,
      'applicationId', v_rep.application_id,
      'tenantId', v_rep.tenant_id,
      'projectId', v_rep.project_id,
      'operation', v_rep.operation,
      'agentId', v_rep.agent_id
    ),
    'auditId', p_audit_id
  );
end;
$$;

revoke all on function public.consume_application_connector_nonce(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.lookup_application_preflight_idempotency(text, text) from public, anon, authenticated;
revoke all on function public.lookup_application_preflight_decision(uuid) from public, anon, authenticated;
revoke all on function public.record_application_preflight_outcome(uuid, text, text, text, text, text, text, text, text, uuid, int, jsonb, timestamptz, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.record_application_execution_report(uuid, text, text, text, text, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on table public.connector_nonces from public, anon, authenticated;
revoke all on table public.preflight_decisions from public, anon, authenticated;
revoke all on table public.preflight_idempotency from public, anon, authenticated;
revoke all on table public.execution_reports from public, anon, authenticated;

grant execute on function public.consume_application_connector_nonce(text, text, timestamptz) to service_role;
grant execute on function public.lookup_application_preflight_idempotency(text, text) to service_role;
grant execute on function public.lookup_application_preflight_decision(uuid) to service_role;
grant execute on function public.record_application_preflight_outcome(uuid, text, text, text, text, text, text, text, text, uuid, int, jsonb, timestamptz, text, text, uuid, jsonb) to service_role;
grant execute on function public.record_application_execution_report(uuid, text, text, text, text, text, text, text, text, uuid, jsonb) to service_role;
grant all on table public.connector_nonces to service_role;
grant all on table public.preflight_decisions to service_role;
grant all on table public.preflight_idempotency to service_role;
grant all on table public.execution_reports to service_role;
