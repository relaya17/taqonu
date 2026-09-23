-- G16 durability SQL/RPC proof.
-- Run with: psql "$SUPABASE_DB_URL" -f supabase/tests/20260923180000_application_governance_durability.test.sql
-- Wrapped in a transaction and ends with ROLLBACK.

begin;

do $$
declare
  v_nonce jsonb;
  v_t1 jsonb;
  v_t1b jsonb;
  v_t2 jsonb;
  v_lookup jsonb;
  v_decision_id uuid := '11111111-1111-4111-8111-111111111111';
  v_audit_id uuid := '22222222-2222-4222-8222-222222222222';
  v_report_audit uuid := '33333333-3333-4333-8333-333333333333';
  v_fail_audit uuid := '44444444-4444-4444-8444-444444444444';
  v_count int;
begin
  v_nonce := public.consume_application_connector_nonce(
    'civio', 'aabbccddeeff0011', now() + interval '10 minutes'
  );
  if v_nonce->>'ok' <> 'true' then raise exception 'T0 first consume must succeed'; end if;

  v_nonce := public.consume_application_connector_nonce(
    'civio', 'aabbccddeeff0011', now() + interval '10 minutes'
  );
  if v_nonce->>'ok' <> 'false' then raise exception 'T0 reuse must fail'; end if;

  v_t1 := public.record_application_preflight_outcome(
    v_decision_id,
    'req-1',
    'civio',
    'tenant-a',
    'project-a',
    'civio.legal.query',
    'GOVERNED_DECISION',
    'ALLOW',
    null,
    null,
    200,
    '{"decision":"ALLOW"}'::jsonb,
    now() + interval '24 hours',
    'idem-1',
    'fp-1',
    v_audit_id,
    jsonb_build_object(
      'type', 'application.preflight.evaluated',
      'tenantId', 'tenant-a',
      'projectId', 'project-a'
    )
  );
  if v_t1->>'kind' <> 'RECORDED' then raise exception 'T1 must record'; end if;

  select count(*) into v_count from public.preflight_decisions where decision_id = v_decision_id;
  if v_count <> 1 then raise exception 'T1 must persist the decision'; end if;
  select count(*) into v_count from public.preflight_idempotency
    where application_id = 'civio' and idempotency_key = 'idem-1';
  if v_count <> 1 then raise exception 'T1 must persist idempotency'; end if;
  select count(*) into v_count from public.audit_logs where id = v_audit_id;
  if v_count <> 1 then raise exception 'T1 RPC must write audit_logs'; end if;

  v_t1b := public.record_application_preflight_outcome(
    '55555555-5555-4555-8555-555555555555',
    'req-2',
    'civio',
    'tenant-a',
    'project-a',
    'civio.legal.query',
    'GOVERNED_DECISION',
    'ALLOW',
    null,
    null,
    200,
    '{"decision":"ALLOW"}'::jsonb,
    now() + interval '24 hours',
    'idem-1',
    'fp-1',
    '66666666-6666-4666-8666-666666666666',
    jsonb_build_object('type', 'application.preflight.evaluated')
  );
  if v_t1b->>'kind' <> 'IDEMPOTENT_HIT' then
    raise exception 'same fingerprint must be idempotent';
  end if;

  v_t1b := public.record_application_preflight_outcome(
    '77777777-7777-4777-8777-777777777777',
    'req-3',
    'civio',
    'tenant-a',
    'project-a',
    'civio.other',
    'GOVERNED_DECISION',
    'ALLOW',
    null,
    null,
    200,
    '{"decision":"ALLOW"}'::jsonb,
    now() + interval '24 hours',
    'idem-1',
    'fp-other',
    '88888888-8888-4888-8888-888888888888',
    jsonb_build_object('type', 'application.preflight.evaluated')
  );
  if v_t1b->>'kind' <> 'IDEMPOTENT_CONFLICT' then
    raise exception 'different fingerprint must conflict';
  end if;

  v_lookup := public.lookup_application_preflight_decision(v_decision_id);
  if v_lookup->>'decision' <> 'ALLOW' then raise exception 'lookup must return ALLOW'; end if;

  v_t2 := public.record_application_execution_report(
    v_decision_id,
    'chatcmpl-1',
    'civio',
    'other-tenant',
    'project-a',
    'req-1',
    'civio.legal.query',
    'SUCCESS',
    null,
    v_report_audit,
    jsonb_build_object('type', 'application.execution.reported')
  );
  if v_t2->>'kind' <> 'REJECTED' then raise exception 'binding mismatch must reject'; end if;

  v_t2 := public.record_application_execution_report(
    v_decision_id,
    'chatcmpl-1',
    'civio',
    'tenant-a',
    'project-a',
    'req-1',
    'civio.legal.query',
    'SUCCESS',
    null,
    v_report_audit,
    jsonb_build_object(
      'type', 'application.execution.reported',
      'tenantId', 'tenant-a',
      'projectId', 'project-a'
    )
  );
  if v_t2->>'kind' <> 'RECORDED' then raise exception 'T2 must record'; end if;
  select count(*) into v_count from public.audit_logs where id = v_report_audit;
  if v_count <> 1 then raise exception 'T2 RPC must write audit_logs'; end if;

  v_t2 := public.record_application_execution_report(
    v_decision_id,
    'chatcmpl-1',
    'civio',
    'tenant-a',
    'project-a',
    'req-1',
    'civio.legal.query',
    'SUCCESS',
    null,
    '99999999-9999-4999-8999-999999999999',
    jsonb_build_object('type', 'application.execution.reported')
  );
  if v_t2->>'kind' <> 'IDEMPOTENT_HIT' then raise exception 'duplicate report must be idempotent'; end if;

  v_t2 := public.record_application_execution_report(
    v_decision_id,
    'chatcmpl-1',
    'civio',
    'tenant-a',
    'project-a',
    'req-1',
    'civio.legal.query',
    'FAILURE',
    null,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    jsonb_build_object('type', 'application.execution.reported')
  );
  if v_t2->>'kind' <> 'CONFLICT' then raise exception 'conflicting report must conflict'; end if;

  v_t2 := public.record_application_execution_report(
    '00000000-0000-4000-8000-000000000099',
    'chatcmpl-missing',
    'civio',
    'tenant-a',
    'project-a',
    'req-1',
    'civio.legal.query',
    'SUCCESS',
    null,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    jsonb_build_object('type', 'application.execution.reported')
  );
  if v_t2->>'kind' <> 'REJECTED' then raise exception 'unknown decision must reject'; end if;

  -- T1 rollback: colliding audit id must not leave a decision/idempotency row
  insert into public.audit_logs (id, owner_id, action, entity_type, payload)
  values (v_fail_audit, null, 'seed', 'seed', '{}'::jsonb);

  begin
    perform public.record_application_preflight_outcome(
      '12121212-1212-4121-8121-121212121212',
      'req-fail',
      'civio',
      'tenant-a',
      'project-a',
      'civio.legal.query',
      'GOVERNED_DECISION',
      'ALLOW',
      null,
      null,
      200,
      '{"decision":"ALLOW"}'::jsonb,
      now() + interval '24 hours',
      'idem-fail',
      'fp-fail',
      v_fail_audit,
      jsonb_build_object('type', 'application.preflight.evaluated')
    );
    raise exception 'T1 colliding audit id must fail';
  exception
    when unique_violation then
      null;
    when others then
      if sqlerrm like '%T1 colliding%' then raise; end if;
  end;

  select count(*) into v_count from public.preflight_decisions
    where decision_id = '12121212-1212-4121-8121-121212121212';
  if v_count <> 0 then raise exception 'T1 rollback must not persist the decision'; end if;
  select count(*) into v_count from public.preflight_idempotency
    where idempotency_key = 'idem-fail';
  if v_count <> 0 then raise exception 'T1 rollback must not persist idempotency'; end if;
end;
$$;

rollback;
