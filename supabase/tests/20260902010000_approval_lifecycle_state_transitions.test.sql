-- Phase 3B durable approval state-machine repair — verification script.
--
-- NOT EXECUTED IN THIS SESSION: this environment has no local Postgres,
-- Docker, or Supabase CLI (`which docker supabase psql` all resolve to
-- nothing), so this script could not be run against a real database this
-- phase. It is written to be run with `psql "$SUPABASE_DB_URL" -f
-- supabase/tests/20260902010000_approval_lifecycle_state_transitions.test.sql`
-- against a local `supabase start` instance (or CI's Postgres) with both
-- `20260901000000_approval_backed_execution_persistence.sql` and
-- `20260902010000_approval_lifecycle_state_transitions.sql` applied, BEFORE
-- this repair is trusted as verified. Every assertion below was derived by
-- hand-tracing the actual SQL in both migrations (see the Phase 3B report
-- for the specific line-level reasoning); it has not been machine-checked.
--
-- The whole script runs inside one transaction and ends with ROLLBACK, so it
-- is always safe to run against a real (even non-disposable) dev database —
-- nothing it does is retained.
--
-- Covers every scenario listed in the Phase 3B brief's item 11:
--   REQUESTED->APPROVED, REQUESTED->REJECTED, REQUESTED->REVOKED, expiry,
--   APPROVED->claim, duplicate redemption, revoked cannot redeem, artifact
--   mismatch cannot redeem, entity/action/agent mismatch cannot redeem,
--   claim/finalize replay, crash/interruption semantics, invalid
--   transitions, scope/tenant/project isolation.

begin;

-- ---------------------------------------------------------------------
-- Shared test helper: builds a self-consistent, schema-valid envelope
-- entirely in SQL (no dependency on the TS canonicalizer — the hash is
-- computed from the exact same JSON text this function returns inside the
-- envelope, so `create_requested_approval`'s own hash re-derivation check
-- passes by construction, the same way it would for a real TS-built
-- envelope).
-- ---------------------------------------------------------------------
create or replace function pg_temp.build_envelope(
  p_approval_id uuid, p_principal text, p_tenant text, p_agent text,
  p_project_id uuid, p_entity_type text, p_action text,
  p_requested_at timestamptz, p_expires_at timestamptz
) returns jsonb language plpgsql as $fn$
declare
  v_json text;
  v_hash text;
begin
  v_json := jsonb_build_object(
    'schemaVersion', 'atlas.execution-approval-envelope/v1',
    'approvalId', p_approval_id,
    'canonicalizationVersion', 'atlas-c14n-json/v1',
    'requester', jsonb_build_object('principalId', p_principal, 'principalType', 'USER', 'tenantId', p_tenant),
    'proposedExecutingAgent', jsonb_build_object('agentId', p_agent, 'identityVersion', 'v1'),
    'operation', 'test.operation',
    'action', p_action,
    'tool', jsonb_build_object('name', 'test-tool', 'catalogVersion', 'v1', 'argumentSchemaVersion', 'v1'),
    'toolArgs', jsonb_build_object('k', 'v'),
    'toolArgsHash', encode(digest('test-args', 'sha256'), 'hex'),
    'entity', jsonb_build_object('type', p_entity_type, 'id', null),
    'project', jsonb_build_object('projectId', p_project_id::text),
    'tenant', jsonb_build_object('tenantId', p_tenant),
    'artifact', jsonb_build_object('artifactId', null, 'artifactHash', null, 'hashAlgorithm', null, 'canonicalizationVersion', null),
    'verificationPlan', jsonb_build_object('version', 'v1', 'expectedObservations', '[]'::jsonb, 'baselineObservations', '[]'::jsonb, 'verificationPlanHash', encode(digest('vp', 'sha256'), 'hex')),
    'policyDecision', jsonb_build_object('policyVersion', 'v1', 'riskLevel', 'HIGH', 'disposition', 'REQUIRES_APPROVAL', 'decisionHash', encode(digest('policy', 'sha256'), 'hex')),
    'requestedAt', to_char(p_requested_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt', to_char(p_expires_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )::text;
  v_hash := encode(digest(v_json, 'sha256'), 'hex');
  return v_json::jsonb || jsonb_build_object('envelopeHash', v_hash);
end;
$fn$;

-- Fixture factory: a fresh owner/project/tenant/agent quadruple per
-- scenario, so scenarios never interfere with each other's rows.
create or replace function pg_temp.new_fixture(out owner_id uuid, out project_id uuid, out tenant text, out agent text, out principal text)
language plpgsql as $fn$
begin
  owner_id := gen_random_uuid();
  project_id := gen_random_uuid();
  tenant := 'tenant-' || owner_id::text;
  agent := 'agent-' || owner_id::text;
  principal := owner_id::text; -- USER principal id == auth.users.id, matching how the live system treats onBehalfOfUserId
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, aud, role)
  values (owner_id, owner_id::text || '@example.test', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, 'authenticated', 'authenticated');
  insert into public.projects (id, owner_id, slug, name) values (project_id, owner_id, 'proj-' || project_id::text, 'Test Project');
end;
$fn$;

create or replace function pg_temp.auth_context(p_principal text, p_owner uuid, p_project uuid, p_tenant text) returns jsonb
language sql as $fn$
  select jsonb_build_object('authenticatedPrincipalId', p_principal, 'ownerId', p_owner::text, 'projectId', p_project::text, 'tenantId', p_tenant);
$fn$;

-- ===================================================================
-- 1. REQUESTED -> APPROVED
-- ===================================================================
do $$
declare
  f record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_created jsonb; v_ctx jsonb; v_decision jsonb;
  v_state text;
begin
  select * into f from pg_temp.new_fixture();
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now(), now() + interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  v_created := public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);
  if v_created->>'state' <> 'REQUESTED' then raise exception 'FAIL 1: expected REQUESTED after creation, got %', v_created->>'state'; end if;

  v_decision := public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'APPROVE', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'looks fine', v_ctx, gen_random_uuid(), '{}'::jsonb);
  if v_decision->>'state' <> 'APPROVED' then raise exception 'FAIL 1: record_approval_decision(APPROVE) returned state=%, expected APPROVED (this is the exact defect Phase 3B fixes)', v_decision->>'state'; end if;

  select state into v_state from public.approval_requests where approval_id = v_approval_id;
  if v_state <> 'APPROVED' then raise exception 'FAIL 1: approval_requests.state is % after APPROVE, expected APPROVED', v_state; end if;
  raise notice 'PASS 1: REQUESTED -> APPROVED (state written to parent row, and return value matches)';
end;
$$;

-- ===================================================================
-- 2. REQUESTED -> REJECTED, and finalized_at set (terminal state)
-- ===================================================================
do $$
declare
  f record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_ctx jsonb; v_decision jsonb; v_row record;
begin
  select * into f from pg_temp.new_fixture();
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'DELETE', now(), now() + interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);

  v_decision := public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'REJECT', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'too risky', v_ctx, gen_random_uuid(), '{}'::jsonb);
  if v_decision->>'state' <> 'REJECTED' then raise exception 'FAIL 2: expected REJECTED, got %', v_decision->>'state'; end if;

  select * into v_row from public.approval_requests where approval_id = v_approval_id;
  if v_row.state <> 'REJECTED' then raise exception 'FAIL 2: parent row state=%, expected REJECTED', v_row.state; end if;
  if v_row.finalized_at is null then raise exception 'FAIL 2: REJECTED is terminal and should set finalized_at'; end if;
  raise notice 'PASS 2: REQUESTED -> REJECTED, finalized_at set';
end;
$$;

-- ===================================================================
-- 3. REQUESTED -> REVOKED (new RPC), and APPROVED -> REVOKED
-- ===================================================================
do $$
declare
  f record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_ctx jsonb; v_revoked jsonb; v_row record;
begin
  select * into f from pg_temp.new_fixture();
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now(), now() + interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);

  v_revoked := public.revoke_approval(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', f.principal, 'withdrawn by requester', v_ctx, gen_random_uuid(), '{}'::jsonb);
  if v_revoked->>'state' <> 'REVOKED' then raise exception 'FAIL 3a: expected REVOKED, got %', v_revoked->>'state'; end if;
  select * into v_row from public.approval_requests where approval_id = v_approval_id;
  if v_row.state <> 'REVOKED' or v_row.finalized_at is null then raise exception 'FAIL 3a: row not REVOKED+finalized'; end if;
  raise notice 'PASS 3a: REQUESTED -> REVOKED';
end;
$$;

do $$
declare
  f record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_ctx jsonb; v_row record;
begin
  select * into f from pg_temp.new_fixture();
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now(), now() + interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);
  perform public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'APPROVE', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'ok', v_ctx, gen_random_uuid(), '{}'::jsonb);

  perform public.revoke_approval(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', f.principal, 'incident resolved, withdrawing', v_ctx, gen_random_uuid(), '{}'::jsonb);
  select * into v_row from public.approval_requests where approval_id = v_approval_id;
  if v_row.state <> 'REVOKED' then raise exception 'FAIL 3b: APPROVED -> REVOKED did not land, state=%', v_row.state; end if;
  raise notice 'PASS 3b: APPROVED -> REVOKED (revocation beats a live approval)';
end;
$$;

-- ===================================================================
-- 4. Expiry (lazy, self-healing on the read that discovers it)
-- ===================================================================
do $$
declare
  f record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_ctx jsonb; v_result jsonb; v_row record;
begin
  select * into f from pg_temp.new_fixture();
  -- requestedAt/expiresAt both in the past, expiresAt still > requestedAt so
  -- the envelope's own superRefine (mirrored here by hand) is satisfied.
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now() - interval '2 hours', now() - interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);

  v_result := public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'APPROVE', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'late', v_ctx, gen_random_uuid(), '{}'::jsonb);
  if v_result->>'state' <> 'EXPIRED' then raise exception 'FAIL 4: expected typed EXPIRED result, got %', v_result->>'state'; end if;
  select * into v_row from public.approval_requests where approval_id = v_approval_id;
  if v_row.state <> 'EXPIRED' then raise exception 'FAIL 4: row did not self-heal to EXPIRED, state=%', v_row.state; end if;
  raise notice 'PASS 4: expiry returns typed EXPIRED and self-heals the row';
end;
$$;

-- ===================================================================
-- 5. APPROVED -> redemption claim
-- ===================================================================
do $$
declare
  f record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_ctx jsonb; v_claim jsonb; v_row record;
begin
  select * into f from pg_temp.new_fixture();
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now(), now() + interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);
  perform public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'APPROVE', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'ok', v_ctx, gen_random_uuid(), '{}'::jsonb);

  v_claim := public.claim_approval_redemption(v_approval_id, f.owner_id, f.project_id, f.tenant, v_envelope->>'envelopeHash', f.principal, encode(digest('idem-key-1', 'sha256'), 'hex'), v_ctx, gen_random_uuid(), '{}'::jsonb);
  if v_claim->>'claimState' <> 'CLAIMED' or (v_claim->>'replayed')::boolean <> false then raise exception 'FAIL 5: claim did not succeed cleanly: %', v_claim; end if;
  select * into v_row from public.approval_requests where approval_id = v_approval_id;
  if v_row.state <> 'FULFILLMENT_IN_PROGRESS' then raise exception 'FAIL 5: expected FULFILLMENT_IN_PROGRESS, got %', v_row.state; end if;
  raise notice 'PASS 5: APPROVED -> claim -> FULFILLMENT_IN_PROGRESS';
end;
$$;

-- ===================================================================
-- 6. Duplicate redemption: same idempotency key replays; different key on
--    an already-claimed approval is refused.
-- ===================================================================
do $$
declare
  f record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_ctx jsonb; v_claim1 jsonb; v_claim2 jsonb;
  v_failed boolean := false;
begin
  select * into f from pg_temp.new_fixture();
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now(), now() + interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);
  perform public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'APPROVE', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'ok', v_ctx, gen_random_uuid(), '{}'::jsonb);

  v_claim1 := public.claim_approval_redemption(v_approval_id, f.owner_id, f.project_id, f.tenant, v_envelope->>'envelopeHash', f.principal, encode(digest('same-key', 'sha256'), 'hex'), v_ctx, gen_random_uuid(), '{}'::jsonb);
  v_claim2 := public.claim_approval_redemption(v_approval_id, f.owner_id, f.project_id, f.tenant, v_envelope->>'envelopeHash', f.principal, encode(digest('same-key', 'sha256'), 'hex'), v_ctx, gen_random_uuid(), '{}'::jsonb);
  if (v_claim2->>'replayed')::boolean <> true or v_claim2->>'executionId' <> v_claim1->>'executionId' then
    raise exception 'FAIL 6a: same-key replay did not return the identical prior result: %', v_claim2;
  end if;

  begin
    perform public.claim_approval_redemption(v_approval_id, f.owner_id, f.project_id, f.tenant, v_envelope->>'envelopeHash', f.principal, encode(digest('different-key', 'sha256'), 'hex'), v_ctx, gen_random_uuid(), '{}'::jsonb);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 6b: a different idempotency key against an already-claimed approval should have been refused'; end if;
  raise notice 'PASS 6: duplicate redemption — same key replays, different key refused';
end;
$$;

-- ===================================================================
-- 7. Revoked approval cannot redeem
-- ===================================================================
do $$
declare
  f record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_ctx jsonb; v_failed boolean := false; v_msg text;
begin
  select * into f from pg_temp.new_fixture();
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now(), now() + interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);
  perform public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'APPROVE', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'ok', v_ctx, gen_random_uuid(), '{}'::jsonb);
  perform public.revoke_approval(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', f.principal, 'withdrawn', v_ctx, gen_random_uuid(), '{}'::jsonb);

  begin
    perform public.claim_approval_redemption(v_approval_id, f.owner_id, f.project_id, f.tenant, v_envelope->>'envelopeHash', f.principal, encode(digest('k', 'sha256'), 'hex'), v_ctx, gen_random_uuid(), '{}'::jsonb);
  exception when others then v_failed := true; get stacked diagnostics v_msg = message_text;
  end;
  if not v_failed then raise exception 'FAIL 7: revoked approval was redeemable'; end if;
  if v_msg not ilike '%revoked%' then raise exception 'FAIL 7: refusal did not name revocation: %', v_msg; end if;
  raise notice 'PASS 7: revoked-first — a revoked approval cannot be redeemed, and the refusal names revocation';
end;
$$;

-- ===================================================================
-- 8/9. Artifact mismatch (and, since the durable model binds
-- entity/action/agent INTO the envelope hash rather than as separate
-- fields, an entity/action/agent mismatch surfaces identically, as a
-- different envelope_hash) cannot redeem.
-- ===================================================================
do $$
declare
  f record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_ctx jsonb; v_failed boolean := false;
begin
  select * into f from pg_temp.new_fixture();
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now(), now() + interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);
  perform public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'APPROVE', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'ok', v_ctx, gen_random_uuid(), '{}'::jsonb);

  begin
    -- present a hash for a DIFFERENT (never-created) envelope — stands in for
    -- either a tampered artifact or an approval presented by the wrong
    -- entity/action/agent, both of which change the envelope hash.
    perform public.claim_approval_redemption(v_approval_id, f.owner_id, f.project_id, f.tenant, encode(digest('a-different-envelope','sha256'),'hex'), f.principal, encode(digest('k', 'sha256'), 'hex'), v_ctx, gen_random_uuid(), '{}'::jsonb);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 8/9: a mismatched envelope_hash was accepted for redemption'; end if;
  raise notice 'PASS 8/9: envelope_hash mismatch (artifact OR entity/action/agent substitution) refused at redemption';
end;
$$;

-- ===================================================================
-- 10. Claim/finalize replay
-- ===================================================================
do $$
declare
  f record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_ctx jsonb; v_claim jsonb; v_fin1 jsonb; v_fin2 jsonb; v_failed boolean := false;
begin
  select * into f from pg_temp.new_fixture();
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now(), now() + interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);
  perform public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'APPROVE', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'ok', v_ctx, gen_random_uuid(), '{}'::jsonb);
  v_claim := public.claim_approval_redemption(v_approval_id, f.owner_id, f.project_id, f.tenant, v_envelope->>'envelopeHash', f.principal, encode(digest('k', 'sha256'), 'hex'), v_ctx, gen_random_uuid(), '{}'::jsonb);

  -- NOTE: finalize_approval_redemption takes 14 positional parameters
  -- (execution_id, owner_id, project_id, final_state, then five optional
  -- runtime/result/error/verdict text fields, then context/correlation/
  -- payload) — called here with named (=>) argument syntax rather than
  -- positionally, to avoid silently mis-binding v_ctx into a text slot.
  v_fin1 := public.finalize_approval_redemption(
    p_execution_id => (v_claim->>'executionId')::uuid, p_owner_id => f.owner_id, p_project_id => f.project_id,
    p_final_state => 'FULFILLED', p_runtime_execution_ref => null, p_runtime_receipt_hash => null,
    p_result_digest => null, p_error_category => null, p_error_reference => null,
    p_verification_verdict => null, p_regression_verdict => null,
    p_authorization_context => v_ctx, p_correlation_id => gen_random_uuid(), p_event_payload => '{}'::jsonb
  );
  v_fin2 := public.finalize_approval_redemption(
    p_execution_id => (v_claim->>'executionId')::uuid, p_owner_id => f.owner_id, p_project_id => f.project_id,
    p_final_state => 'FULFILLED', p_runtime_execution_ref => null, p_runtime_receipt_hash => null,
    p_result_digest => null, p_error_category => null, p_error_reference => null,
    p_verification_verdict => null, p_regression_verdict => null,
    p_authorization_context => v_ctx, p_correlation_id => gen_random_uuid(), p_event_payload => '{}'::jsonb
  );
  if (v_fin2->>'replayed')::boolean <> true or v_fin2->>'state' <> 'FULFILLED' then raise exception 'FAIL 10a: identical-outcome finalize replay not honored: %', v_fin2; end if;

  begin
    perform public.finalize_approval_redemption(
      p_execution_id => (v_claim->>'executionId')::uuid, p_owner_id => f.owner_id, p_project_id => f.project_id,
      p_final_state => 'CONSUMED_FAILED', p_runtime_execution_ref => null, p_runtime_receipt_hash => null,
      p_result_digest => null, p_error_category => null, p_error_reference => null,
      p_verification_verdict => null, p_regression_verdict => null,
      p_authorization_context => v_ctx, p_correlation_id => gen_random_uuid(), p_event_payload => '{}'::jsonb
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 10b: a conflicting finalize outcome was allowed to overwrite history'; end if;
  raise notice 'PASS 10: finalize is idempotent on a matching replay and refuses a conflicting one';
end;
$$;

-- ===================================================================
-- 11. Crash/interruption semantics: claim without ever finalizing leaves a
-- durable, inspectable FULFILLMENT_IN_PROGRESS record rather than losing
-- the approval — this is the property the live in-memory system cannot
-- offer at all (a crash there loses the approval outright). There is no
-- "resume" or "release" RPC in the current schema (see the Phase 3B
-- report) — this test documents that the record survives, not that it can
-- be automatically recovered.
-- ===================================================================
do $$
declare
  f record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_ctx jsonb; v_row record; v_failed boolean := false;
begin
  select * into f from pg_temp.new_fixture();
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now(), now() + interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);
  perform public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'APPROVE', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'ok', v_ctx, gen_random_uuid(), '{}'::jsonb);
  perform public.claim_approval_redemption(v_approval_id, f.owner_id, f.project_id, f.tenant, v_envelope->>'envelopeHash', f.principal, encode(digest('k', 'sha256'), 'hex'), v_ctx, gen_random_uuid(), '{}'::jsonb);
  -- (simulated crash: no finalize call)

  select * into v_row from public.approval_requests where approval_id = v_approval_id;
  if v_row.state <> 'FULFILLMENT_IN_PROGRESS' then raise exception 'FAIL 11: interrupted claim did not remain durably FULFILLMENT_IN_PROGRESS, state=%', v_row.state; end if;

  -- confirm it cannot be silently re-approved/re-decided out from under the
  -- in-flight claim (REQUESTED-only guard still holds):
  begin
    perform public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'APPROVE', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'again?', v_ctx, gen_random_uuid(), '{}'::jsonb);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 11: an in-flight (FULFILLMENT_IN_PROGRESS) approval accepted a second decision'; end if;
  raise notice 'PASS 11: an interrupted claim survives as a durable, inspectable FULFILLMENT_IN_PROGRESS record and cannot be re-decided';
end;
$$;

-- ===================================================================
-- 12. Invalid transitions
-- ===================================================================
do $$
declare
  f record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_ctx jsonb; v_failed boolean := false;
begin
  select * into f from pg_temp.new_fixture();
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now(), now() + interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);

  -- 12a: cannot claim a REQUESTED (not yet approved) approval
  begin
    perform public.claim_approval_redemption(v_approval_id, f.owner_id, f.project_id, f.tenant, v_envelope->>'envelopeHash', f.principal, encode(digest('k', 'sha256'), 'hex'), v_ctx, gen_random_uuid(), '{}'::jsonb);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 12a: claimed a REQUESTED (not APPROVED) approval'; end if;

  -- 12b: cannot decide the same approval twice
  perform public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'APPROVE', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'ok', v_ctx, gen_random_uuid(), '{}'::jsonb);
  v_failed := false;
  begin
    perform public.record_approval_decision(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', 'REJECT', f.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'changed my mind', v_ctx, gen_random_uuid(), '{}'::jsonb);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 12b: an already-decided approval accepted a second decision'; end if;

  -- 12c: cannot revoke past APPROVED (claim it, then try to revoke)
  perform public.claim_approval_redemption(v_approval_id, f.owner_id, f.project_id, f.tenant, v_envelope->>'envelopeHash', f.principal, encode(digest('k', 'sha256'), 'hex'), v_ctx, gen_random_uuid(), '{}'::jsonb);
  v_failed := false;
  begin
    perform public.revoke_approval(v_approval_id, f.owner_id, f.project_id, v_envelope->>'envelopeHash', f.principal, 'too late', v_ctx, gen_random_uuid(), '{}'::jsonb);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 12c: a FULFILLMENT_IN_PROGRESS approval was revocable — an executed/executing action must not be retroactively un-authorized'; end if;
  raise notice 'PASS 12: invalid transitions (claim-before-approve, double-decide, revoke-after-claim) all refused';
end;
$$;

-- ===================================================================
-- 13. Scope / tenant / project isolation
-- ===================================================================
do $$
declare
  f record; g record; v_approval_id uuid := gen_random_uuid(); v_envelope jsonb; v_ctx jsonb; v_wrong_ctx jsonb; v_failed boolean := false;
begin
  select * into f from pg_temp.new_fixture();
  select * into g from pg_temp.new_fixture(); -- a second, unrelated owner/project/tenant
  v_envelope := pg_temp.build_envelope(v_approval_id, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now(), now() + interval '1 hour');
  v_ctx := pg_temp.auth_context(f.principal, f.owner_id, f.project_id, f.tenant);
  perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_envelope, (v_envelope - 'envelopeHash')::text, v_ctx, gen_random_uuid(), '{}'::jsonb);

  -- 13a: g's owner/project attempting to decide f's approval, using g's own
  -- (self-consistent, correctly-shaped) authorization context — must be
  -- refused as a scope mismatch, not merely an identity mismatch.
  v_wrong_ctx := pg_temp.auth_context(g.principal, g.owner_id, g.project_id, g.tenant);
  begin
    perform public.record_approval_decision(v_approval_id, g.owner_id, g.project_id, v_envelope->>'envelopeHash', 'APPROVE', g.principal, 'v1', '{}'::jsonb, 'v1', encode(digest('policy','sha256'),'hex'), 'cross-tenant attempt', v_wrong_ctx, gen_random_uuid(), '{}'::jsonb);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 13a: a different owner/project/tenant could decide another tenant''s approval'; end if;

  -- 13b: create_requested_approval itself refuses when the authorization
  -- context does not match the explicit owner/project/tenant parameters
  -- (governance_context_is_valid), independent of the envelope's own
  -- internal consistency.
  v_failed := false;
  declare v_id2 uuid := gen_random_uuid(); v_env2 jsonb;
  begin
    v_env2 := pg_temp.build_envelope(v_id2, f.principal, f.tenant, f.agent, f.project_id, 'RECORD', 'UPDATE', now(), now() + interval '1 hour');
    begin
      -- authorization context claims to be g's, but the explicit p_owner_id/
      -- p_project_id/p_tenant_id and the envelope itself are still f's.
      perform public.create_requested_approval(f.owner_id, f.project_id, f.tenant, v_env2, (v_env2 - 'envelopeHash')::text, v_wrong_ctx, gen_random_uuid(), '{}'::jsonb);
    exception when others then v_failed := true;
    end;
  end;
  if not v_failed then raise exception 'FAIL 13b: creation succeeded with an authorization context scoped to a different owner/project/tenant'; end if;
  raise notice 'PASS 13: scope/tenant/project isolation enforced on both decision and creation';
end;
$$;

raise notice '=== Phase 3B state-machine verification script complete — see individual PASS/FAIL notices above ===';

rollback;
