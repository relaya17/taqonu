-- Unit 2: durable approval-backed execution persistence.
-- All governance mutations are performed by the domain-specific RPC functions below.

create table public.approval_requests (
  approval_id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  tenant_id text not null,
  schema_version text not null,
  canonicalization_version text not null,
  envelope_hash text not null check (envelope_hash ~ '^[a-f0-9]{64}$'),
  canonical_envelope jsonb not null,
  canonical_envelope_json text not null,
  requester_principal_id text not null,
  proposed_agent_id text not null,
  entity_type text not null,
  entity_id text,
  operation text not null,
  action text not null,
  tool_name text not null,
  tool_catalog_version text not null,
  risk_level text not null check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  state text not null check (state in ('REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED', 'FULFILLMENT_IN_PROGRESS', 'FULFILLED', 'CONSUMED_FAILED', 'OUTCOME_UNKNOWN')),
  requested_at timestamptz not null,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  fulfilled_at timestamptz,
  finalized_at timestamptz,
  claim_release_count integer not null default 0 check (claim_release_count between 0 and 1),
  last_execution_id uuid,
  created_at timestamptz not null default now(),
  unique (owner_id, envelope_hash)
);

create table public.approval_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.approval_requests (approval_id) on delete restrict,
  owner_id uuid not null references auth.users (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  decision text not null check (decision in ('APPROVE', 'REJECT')),
  approver_principal_id text not null,
  approver_identity_version text not null,
  authority_snapshot jsonb not null,
  policy_version text not null,
  policy_decision_hash text not null check (policy_decision_hash ~ '^[a-f0-9]{64}$'),
  envelope_hash text not null check (envelope_hash ~ '^[a-f0-9]{64}$'),
  reason text,
  decided_at timestamptz not null default now(),
  unique (approval_id, approver_principal_id)
);

create table public.approval_redemptions (
  redemption_id uuid primary key default gen_random_uuid(),
  approval_id uuid not null unique references public.approval_requests (approval_id) on delete restrict,
  owner_id uuid not null references auth.users (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  tenant_id text not null,
  operator_principal_id text not null,
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  execution_id uuid not null unique,
  envelope_hash text not null check (envelope_hash ~ '^[a-f0-9]{64}$'),
  claim_state text not null check (claim_state in ('CLAIMED', 'DISPATCH_NOT_STARTED', 'DISPATCHED', 'FINALIZED')),
  claimed_at timestamptz not null default now(),
  response_status text,
  response_payload_digest text check (response_payload_digest is null or response_payload_digest ~ '^[a-f0-9]{64}$'),
  response_reference text,
  final_state text check (final_state is null or final_state in ('FULFILLED', 'CONSUMED_FAILED', 'OUTCOME_UNKNOWN')),
  finalized_at timestamptz,
  release_reason text,
  unique (approval_id, operator_principal_id, idempotency_key_hash)
);

alter table public.approval_requests
  add constraint approval_requests_last_execution_fk
  foreign key (last_execution_id) references public.approval_redemptions (execution_id) on delete restrict;

create table public.execution_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.approval_redemptions (execution_id) on delete restrict,
  approval_id uuid not null references public.approval_requests (approval_id) on delete restrict,
  redemption_id uuid not null references public.approval_redemptions (redemption_id) on delete restrict,
  owner_id uuid not null references auth.users (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  receipt_kind text not null check (receipt_kind in ('CLAIMED', 'DISPATCH_NOT_STARTED', 'DISPATCH_STARTED', 'COMPLETED', 'FAILED', 'OUTCOME_UNKNOWN')),
  recorded_at timestamptz not null default now(),
  runtime_execution_ref text,
  runtime_receipt_hash text check (runtime_receipt_hash is null or runtime_receipt_hash ~ '^[a-f0-9]{64}$'),
  result_digest text check (result_digest is null or result_digest ~ '^[a-f0-9]{64}$'),
  error_category text,
  error_reference text,
  verification_verdict text,
  regression_verdict text,
  evidence jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  causation_id uuid,
  envelope_hash text not null check (envelope_hash ~ '^[a-f0-9]{64}$'),
  unique (execution_id, receipt_kind)
);

create table public.audit_outbox (
  outbox_id uuid primary key,
  aggregate_type text not null check (aggregate_type in ('APPROVAL', 'EXECUTION')),
  aggregate_id uuid not null,
  event_type text not null,
  event_version text not null,
  owner_id uuid not null references auth.users (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  tenant_id text not null,
  approval_id uuid references public.approval_requests (approval_id) on delete restrict,
  execution_id uuid references public.approval_redemptions (execution_id) on delete restrict,
  correlation_id uuid not null,
  causation_id uuid,
  envelope_hash text not null check (envelope_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null,
  delivery_state text not null default 'PENDING' check (delivery_state in ('PENDING', 'LEASED', 'PUBLISHED', 'DEAD_LETTER')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  published_at timestamptz,
  last_error_reference text,
  created_at timestamptz not null default now(),
  unique (aggregate_type, aggregate_id, event_type, payload_digest)
);

create index approval_requests_owner_state_expiry_idx on public.approval_requests (owner_id, state, expires_at);
create index approval_requests_project_requested_idx on public.approval_requests (project_id, requested_at desc);
create index approval_decisions_approval_decided_idx on public.approval_decisions (approval_id, decided_at);
create index approval_redemptions_operator_claimed_idx on public.approval_redemptions (owner_id, operator_principal_id, claimed_at desc);
create index execution_receipts_execution_recorded_idx on public.execution_receipts (execution_id, recorded_at);
create index audit_outbox_pending_idx on public.audit_outbox (available_at, created_at) where delivery_state = 'PENDING';
create index audit_outbox_lease_idx on public.audit_outbox (lease_expires_at) where delivery_state = 'LEASED';

alter table public.approval_requests enable row level security;
alter table public.approval_decisions enable row level security;
alter table public.approval_redemptions enable row level security;
alter table public.execution_receipts enable row level security;
alter table public.audit_outbox enable row level security;

create policy "approval_requests_owner_select" on public.approval_requests for select using (auth.uid() = owner_id);
create policy "approval_decisions_owner_select" on public.approval_decisions for select using (auth.uid() = owner_id);
create policy "approval_redemptions_owner_select" on public.approval_redemptions for select using (auth.uid() = owner_id);
create policy "execution_receipts_owner_select" on public.execution_receipts for select using (auth.uid() = owner_id);

create or replace function public.governance_project_scope_is_valid(p_owner_id uuid, p_project_id uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.projects where id = p_project_id and owner_id = p_owner_id);
$$;

create or replace function public.governance_audit_payload_is_allowed(p_payload jsonb)
returns boolean language plpgsql immutable security invoker set search_path = public as $$
declare
  item record;
begin
  if jsonb_typeof(p_payload) <> 'object' then return false; end if;
  for item in select key, value from jsonb_each(p_payload) loop
    if item.key not in ('approvalId', 'executionId', 'redemptionId', 'correlationId', 'causationId', 'envelopeHash', 'schemaVersion', 'tenantId', 'ownerId', 'projectId', 'requesterId', 'proposedAgentId', 'operatorId', 'approverId', 'entityType', 'entityId', 'operation', 'action', 'toolName', 'toolCatalogVersion', 'policyVersion', 'policyDecisionHash', 'riskLevel', 'state', 'decision', 'reason', 'errorCategory', 'errorReference', 'resultDigest', 'runtimeExecutionRef', 'runtimeReceiptHash', 'idempotencyKeyHash', 'receiptKind', 'verificationVerdict', 'regressionVerdict')
       or jsonb_typeof(item.value) not in ('string', 'null', 'boolean') then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function public.governance_reject_immutable_mutation()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  raise exception 'governance evidence is immutable';
end;
$$;

create trigger approval_decisions_immutable before update or delete on public.approval_decisions
  for each row execute function public.governance_reject_immutable_mutation();
create trigger execution_receipts_immutable before update or delete on public.execution_receipts
  for each row execute function public.governance_reject_immutable_mutation();

create or replace function public.governance_protect_approval_request()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'governance evidence is immutable'; end if;
  if (to_jsonb(new) - array['state', 'claimed_at', 'fulfilled_at', 'finalized_at', 'claim_release_count', 'last_execution_id'])
       is distinct from
     (to_jsonb(old) - array['state', 'claimed_at', 'fulfilled_at', 'finalized_at', 'claim_release_count', 'last_execution_id']) then
    raise exception 'approval envelope fields are immutable';
  end if;
  if not ((old.state = 'REQUESTED' and new.state in ('APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED'))
       or (old.state = 'APPROVED' and new.state in ('REVOKED', 'EXPIRED', 'FULFILLMENT_IN_PROGRESS'))
       or (old.state = 'FULFILLMENT_IN_PROGRESS' and new.state in ('APPROVED', 'FULFILLED', 'CONSUMED_FAILED', 'OUTCOME_UNKNOWN'))) then
    raise exception 'illegal approval lifecycle transition from % to %', old.state, new.state;
  end if;
  if new.state = 'APPROVED' and old.state = 'FULFILLMENT_IN_PROGRESS' and new.claim_release_count <> 1 then
    raise exception 'approval claim may be released only once';
  end if;
  return new;
end;
$$;

create trigger approval_requests_protect before update or delete on public.approval_requests
  for each row execute function public.governance_protect_approval_request();

create or replace function public.governance_protect_approval_redemption()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'governance evidence is immutable'; end if;
  if (to_jsonb(new) - array['claim_state', 'response_status', 'response_payload_digest', 'response_reference', 'final_state', 'finalized_at', 'release_reason'])
       is distinct from
     (to_jsonb(old) - array['claim_state', 'response_status', 'response_payload_digest', 'response_reference', 'final_state', 'finalized_at', 'release_reason']) then
    raise exception 'redemption identity fields are immutable';
  end if;
  if new.claim_state <> old.claim_state and not (
    (old.claim_state = 'CLAIMED' and new.claim_state in ('DISPATCH_NOT_STARTED', 'DISPATCHED', 'FINALIZED'))
    or (old.claim_state = 'DISPATCH_NOT_STARTED' and new.claim_state = 'FINALIZED')
    or (old.claim_state = 'DISPATCHED' and new.claim_state = 'FINALIZED')
  ) then raise exception 'illegal redemption transition'; end if;
  return new;
end;
$$;

create trigger approval_redemptions_protect before update or delete on public.approval_redemptions
  for each row execute function public.governance_protect_approval_redemption();

create or replace function public.governance_protect_audit_outbox()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'audit outbox evidence is immutable'; end if;
  if (to_jsonb(new) - array['delivery_state', 'attempt_count', 'available_at', 'lease_token', 'lease_expires_at', 'published_at', 'last_error_reference'])
       is distinct from
     (to_jsonb(old) - array['delivery_state', 'attempt_count', 'available_at', 'lease_token', 'lease_expires_at', 'published_at', 'last_error_reference']) then
    raise exception 'audit outbox event fields are immutable';
  end if;
  return new;
end;
$$;

create trigger audit_outbox_protect before update or delete on public.audit_outbox
  for each row execute function public.governance_protect_audit_outbox();

create or replace function public.governance_context_is_valid(p_context jsonb, p_owner_id uuid, p_project_id uuid, p_tenant_id text)
returns boolean language sql immutable security invoker set search_path = public as $$
  select p_context ? 'authenticatedPrincipalId'
     and p_context ->> 'ownerId' = p_owner_id::text
     and p_context ->> 'projectId' = p_project_id::text
     and p_context ->> 'tenantId' = p_tenant_id;
$$;

create or replace function public.create_requested_approval(
  p_owner_id uuid, p_project_id uuid, p_tenant_id text, p_envelope jsonb, p_canonical_envelope_json text,
  p_authorization_context jsonb, p_correlation_id uuid, p_event_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_approval_id uuid := (p_envelope ->> 'approvalId')::uuid;
  v_hash text := p_envelope ->> 'envelopeHash';
  v_event_id uuid := gen_random_uuid();
begin
    if not public.governance_project_scope_is_valid(p_owner_id, p_project_id)
      or not public.governance_context_is_valid(p_authorization_context, p_owner_id, p_project_id, p_tenant_id) then raise exception 'invalid authorization scope'; end if;
    if p_authorization_context ->> 'authenticatedPrincipalId' <> p_envelope #>> '{requester,principalId}' then raise exception 'requester identity mismatch'; end if;
  if p_tenant_id <> p_envelope #>> '{tenant,tenantId}' or p_tenant_id <> p_envelope #>> '{requester,tenantId}' then raise exception 'tenant mismatch'; end if;
  if p_project_id::text <> p_envelope #>> '{project,projectId}' then raise exception 'project mismatch'; end if;
    if p_canonical_envelope_json::jsonb <> p_envelope - 'envelopeHash'
      or v_hash !~ '^[a-f0-9]{64}$'
      or encode(digest(p_canonical_envelope_json, 'sha256'), 'hex') <> v_hash then raise exception 'invalid envelope hash'; end if;
    if not public.governance_audit_payload_is_allowed(p_event_payload) then raise exception 'audit payload is not allowlisted'; end if;
  insert into public.approval_requests (
    approval_id, owner_id, project_id, tenant_id, schema_version, canonicalization_version, envelope_hash, canonical_envelope, canonical_envelope_json,
    requester_principal_id, proposed_agent_id, entity_type, entity_id, operation, action, tool_name, tool_catalog_version, risk_level, state, requested_at, expires_at
  ) values (
    v_approval_id, p_owner_id, p_project_id, p_tenant_id, p_envelope ->> 'schemaVersion', p_envelope ->> 'canonicalizationVersion', v_hash, p_envelope, p_canonical_envelope_json,
    p_envelope #>> '{requester,principalId}', p_envelope #>> '{proposedExecutingAgent,agentId}', p_envelope #>> '{entity,type}', nullif(p_envelope #>> '{entity,id}', ''),
    p_envelope ->> 'operation', p_envelope ->> 'action', p_envelope #>> '{tool,name}', p_envelope #>> '{tool,catalogVersion}', p_envelope #>> '{policyDecision,riskLevel}', 'REQUESTED',
    (p_envelope ->> 'requestedAt')::timestamptz, (p_envelope ->> 'expiresAt')::timestamptz
  );
  insert into public.domain_events (id, type, occurred_at, owner_id, project_id, correlation_id, causation_id, epistemic_state, payload)
  values (v_event_id, 'approval.requested', now(), p_owner_id, p_project_id, p_correlation_id, null, 'CONFIRMED', p_event_payload);
  insert into public.audit_outbox (outbox_id, aggregate_type, aggregate_id, event_type, event_version, owner_id, project_id, tenant_id, approval_id, correlation_id, envelope_hash, payload, payload_digest, occurred_at)
  values (v_event_id, 'APPROVAL', v_approval_id, 'approval.requested', 'v1', p_owner_id, p_project_id, p_tenant_id, v_approval_id, p_correlation_id, v_hash, p_event_payload, encode(digest(p_event_payload::text, 'sha256'), 'hex'), now());
  return jsonb_build_object('approvalId', v_approval_id, 'state', 'REQUESTED', 'envelopeHash', v_hash);
end;
$$;

create or replace function public.claim_approval_redemption(
  p_approval_id uuid, p_owner_id uuid, p_project_id uuid, p_tenant_id text, p_envelope_hash text, p_operator_principal_id text,
  p_idempotency_key_hash text, p_authorization_context jsonb, p_correlation_id uuid, p_event_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_request public.approval_requests%rowtype;
  v_existing public.approval_redemptions%rowtype;
  v_redemption_id uuid := gen_random_uuid();
  v_execution_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
begin
  if not public.governance_context_is_valid(p_authorization_context, p_owner_id, p_project_id, p_tenant_id) or not public.governance_audit_payload_is_allowed(p_event_payload) then raise exception 'invalid authorization context or audit payload'; end if;
  if p_authorization_context ->> 'authenticatedPrincipalId' <> p_operator_principal_id then raise exception 'operator identity mismatch'; end if;
  select * into v_request from public.approval_requests where approval_id = p_approval_id for update;
  if not found then raise exception 'approval not found'; end if;
  if v_request.owner_id <> p_owner_id or v_request.project_id <> p_project_id or v_request.tenant_id <> p_tenant_id or v_request.envelope_hash <> p_envelope_hash then raise exception 'approval scope or envelope mismatch'; end if;
  select * into v_existing from public.approval_redemptions where approval_id = p_approval_id and operator_principal_id = p_operator_principal_id and idempotency_key_hash = p_idempotency_key_hash;
  if found then return jsonb_build_object('redemptionId', v_existing.redemption_id, 'executionId', v_existing.execution_id, 'claimState', v_existing.claim_state, 'responseStatus', v_existing.response_status, 'responsePayloadDigest', v_existing.response_payload_digest, 'responseReference', v_existing.response_reference, 'finalState', v_existing.final_state, 'replayed', true); end if;
  if v_request.state = 'REVOKED' then raise exception 'approval revoked'; end if;
  if v_request.expires_at <= now() then
    if v_request.state = 'APPROVED' then update public.approval_requests set state = 'EXPIRED', finalized_at = now() where approval_id = p_approval_id; end if;
    return jsonb_build_object('approvalId', p_approval_id, 'state', 'EXPIRED', 'replayed', false);
  end if;
  if v_request.state <> 'APPROVED' then raise exception 'approval is not redeemable'; end if;
  if exists (select 1 from public.approval_redemptions where approval_id = p_approval_id) then raise exception 'approval already claimed'; end if;
  insert into public.approval_redemptions (redemption_id, approval_id, owner_id, project_id, tenant_id, operator_principal_id, idempotency_key_hash, execution_id, envelope_hash, claim_state)
  values (v_redemption_id, p_approval_id, p_owner_id, p_project_id, p_tenant_id, p_operator_principal_id, p_idempotency_key_hash, v_execution_id, p_envelope_hash, 'CLAIMED');
  update public.approval_requests set state = 'FULFILLMENT_IN_PROGRESS', claimed_at = now(), last_execution_id = v_execution_id where approval_id = p_approval_id;
  insert into public.execution_receipts (execution_id, approval_id, redemption_id, owner_id, project_id, receipt_kind, correlation_id, envelope_hash)
  values (v_execution_id, p_approval_id, v_redemption_id, p_owner_id, p_project_id, 'CLAIMED', p_correlation_id, p_envelope_hash);
  insert into public.domain_events (id, type, occurred_at, owner_id, project_id, correlation_id, causation_id, epistemic_state, payload)
  values (v_event_id, 'approval.fulfillment.attempted', now(), p_owner_id, p_project_id, p_correlation_id, p_approval_id, 'CONFIRMED', p_event_payload);
  insert into public.audit_outbox (outbox_id, aggregate_type, aggregate_id, event_type, event_version, owner_id, project_id, tenant_id, approval_id, execution_id, correlation_id, causation_id, envelope_hash, payload, payload_digest, occurred_at)
  values (v_event_id, 'EXECUTION', v_execution_id, 'approval.fulfillment.attempted', 'v1', p_owner_id, p_project_id, p_tenant_id, p_approval_id, v_execution_id, p_correlation_id, p_approval_id, p_envelope_hash, p_event_payload, encode(digest(p_event_payload::text, 'sha256'), 'hex'), now());
  return jsonb_build_object('redemptionId', v_redemption_id, 'executionId', v_execution_id, 'claimState', 'CLAIMED', 'responseStatus', null, 'responsePayloadDigest', null, 'responseReference', null, 'finalState', null, 'replayed', false);
end;
$$;

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
  insert into public.approval_decisions (decision_id, approval_id, owner_id, project_id, decision, approver_principal_id, approver_identity_version, authority_snapshot, policy_version, policy_decision_hash, envelope_hash, reason)
  values (v_decision_id, p_approval_id, p_owner_id, p_project_id, p_decision, p_approver_principal_id, p_approver_identity_version, p_authority_snapshot, p_policy_version, p_policy_decision_hash, p_envelope_hash, p_reason);
  insert into public.domain_events (id, type, occurred_at, owner_id, project_id, correlation_id, causation_id, epistemic_state, payload)
  values (v_event_id, 'approval.decision', now(), p_owner_id, p_project_id, p_correlation_id, p_approval_id, 'CONFIRMED', p_event_payload);
  insert into public.audit_outbox (outbox_id, aggregate_type, aggregate_id, event_type, event_version, owner_id, project_id, tenant_id, approval_id, correlation_id, causation_id, envelope_hash, payload, payload_digest, occurred_at)
  values (v_event_id, 'APPROVAL', p_approval_id, 'approval.decision', 'v1', p_owner_id, p_project_id, v_request.tenant_id, p_approval_id, p_correlation_id, p_approval_id, p_envelope_hash, p_event_payload, encode(digest(p_event_payload::text, 'sha256'), 'hex'), now());
  return jsonb_build_object('decisionId', v_decision_id, 'approvalId', p_approval_id, 'state', 'REQUESTED');
end;
$$;

create or replace function public.finalize_approval_redemption(
  p_execution_id uuid, p_owner_id uuid, p_project_id uuid, p_final_state text, p_runtime_execution_ref text,
  p_runtime_receipt_hash text, p_result_digest text, p_error_category text, p_error_reference text,
  p_verification_verdict text, p_regression_verdict text, p_authorization_context jsonb,
  p_correlation_id uuid, p_event_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_redemption public.approval_redemptions%rowtype;
  v_event_id uuid := gen_random_uuid();
  v_receipt_kind text;
begin
  if p_final_state not in ('FULFILLED', 'CONSUMED_FAILED', 'OUTCOME_UNKNOWN') then raise exception 'invalid terminal outcome'; end if;
    if not public.governance_context_is_valid(p_authorization_context, p_owner_id, p_project_id, p_authorization_context ->> 'tenantId')
      or not public.governance_audit_payload_is_allowed(p_event_payload) then raise exception 'invalid authorization context or audit payload'; end if;
  select * into v_redemption from public.approval_redemptions where execution_id = p_execution_id for update;
  if not found or v_redemption.owner_id <> p_owner_id or v_redemption.project_id <> p_project_id or v_redemption.tenant_id <> p_authorization_context ->> 'tenantId' then raise exception 'execution scope mismatch'; end if;
  if v_redemption.final_state is not null then
    if v_redemption.final_state = p_final_state then return jsonb_build_object('executionId', p_execution_id, 'approvalId', v_redemption.approval_id, 'state', p_final_state, 'replayed', true); end if;
    raise exception 'execution already finalized with a different outcome';
  end if;
  if v_redemption.claim_state <> 'CLAIMED' then raise exception 'execution cannot be finalized from its current claim state'; end if;
  v_receipt_kind := case p_final_state when 'FULFILLED' then 'COMPLETED' when 'CONSUMED_FAILED' then 'FAILED' else 'OUTCOME_UNKNOWN' end;
  update public.approval_redemptions set claim_state = 'FINALIZED', final_state = p_final_state, finalized_at = now(), response_status = p_final_state, response_payload_digest = p_result_digest, response_reference = p_runtime_execution_ref where execution_id = p_execution_id;
  update public.approval_requests set state = p_final_state, finalized_at = now(), fulfilled_at = case when p_final_state = 'FULFILLED' then now() else null end where approval_id = v_redemption.approval_id;
  insert into public.execution_receipts (execution_id, approval_id, redemption_id, owner_id, project_id, receipt_kind, runtime_execution_ref, runtime_receipt_hash, result_digest, error_category, error_reference, verification_verdict, regression_verdict, evidence, correlation_id, causation_id, envelope_hash)
  values (p_execution_id, v_redemption.approval_id, v_redemption.redemption_id, p_owner_id, p_project_id, v_receipt_kind, p_runtime_execution_ref, p_runtime_receipt_hash, p_result_digest, p_error_category, p_error_reference, p_verification_verdict, p_regression_verdict, '{}'::jsonb, p_correlation_id, v_redemption.approval_id, v_redemption.envelope_hash);
  insert into public.domain_events (id, type, occurred_at, owner_id, project_id, correlation_id, causation_id, epistemic_state, payload)
  values (v_event_id, 'approval.fulfillment.' || lower(p_final_state), now(), p_owner_id, p_project_id, p_correlation_id, v_redemption.approval_id, 'CONFIRMED', p_event_payload);
  insert into public.audit_outbox (outbox_id, aggregate_type, aggregate_id, event_type, event_version, owner_id, project_id, tenant_id, approval_id, execution_id, correlation_id, causation_id, envelope_hash, payload, payload_digest, occurred_at)
  values (v_event_id, 'EXECUTION', p_execution_id, 'approval.fulfillment.' || lower(p_final_state), 'v1', p_owner_id, p_project_id, v_redemption.tenant_id, v_redemption.approval_id, p_execution_id, p_correlation_id, v_redemption.approval_id, v_redemption.envelope_hash, p_event_payload, encode(digest(p_event_payload::text, 'sha256'), 'hex'), now());
  return jsonb_build_object('executionId', p_execution_id, 'approvalId', v_redemption.approval_id, 'state', p_final_state, 'replayed', false);
end;
$$;

revoke all on function public.create_requested_approval(uuid, uuid, text, jsonb, text, jsonb, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_approval_redemption(uuid, uuid, uuid, text, text, text, text, jsonb, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.record_approval_decision(uuid, uuid, uuid, text, text, text, text, jsonb, text, text, text, jsonb, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_approval_redemption(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_requested_approval(uuid, uuid, text, jsonb, text, jsonb, uuid, jsonb) to service_role;
grant execute on function public.claim_approval_redemption(uuid, uuid, uuid, text, text, text, text, jsonb, uuid, jsonb) to service_role;
grant execute on function public.record_approval_decision(uuid, uuid, uuid, text, text, text, text, jsonb, text, text, text, jsonb, uuid, jsonb) to service_role;
grant execute on function public.finalize_approval_redemption(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, uuid, jsonb) to service_role;