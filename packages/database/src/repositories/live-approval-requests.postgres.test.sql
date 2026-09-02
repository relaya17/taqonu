-- Phase 3F live ApprovalRequest authority — verification script.
-- Run with: psql "$SUPABASE_DB_URL" -f packages/database/src/repositories/live-approval-requests.postgres.test.sql
-- The script is wrapped in a transaction and ends with ROLLBACK.

begin;

do $$
declare
  v_created jsonb;
  v_decided jsonb;
  v_consumed jsonb;
  v_revoked jsonb;
  v_listed jsonb;
  v_id uuid;
  v_other uuid;
begin
  v_created := public.create_live_approval_request(
    'RECORD', 'CREATE', 'agent-1', 'phase-3f create', '{}'::jsonb, null, null, '{}', '{}'
  );
  if v_created->>'status' <> 'PENDING' then raise exception 'create must return PENDING'; end if;
  if v_created->>'entityType' <> 'RECORD' or v_created->>'action' <> 'CREATE' then
    raise exception 'create must persist entity/action';
  end if;
  if v_created->>'requestedBy' <> 'agent-1' then raise exception 'create must persist requestedBy'; end if;
  v_id := (v_created->>'id')::uuid;

  if public.get_live_approval_request(v_id)->>'status' <> 'PENDING' then
    raise exception 'get must return the created row';
  end if;
  if public.get_live_approval_request('00000000-0000-4000-8000-000000000099') is not null then
    raise exception 'get missing must return null';
  end if;

  v_listed := public.list_live_approval_requests('PENDING');
  if jsonb_array_length(v_listed) < 1 then raise exception 'list PENDING must include the created row'; end if;

  begin
    perform public.consume_live_approval_request(v_id, null, null, null, null);
    raise exception 'consume PENDING must fail';
  exception when others then
    if sqlerrm not like '%not APPROVED%' then raise; end if;
  end;

  v_decided := public.decide_live_approval_request(v_id, 'admin-1', true, 'ok');
  if v_decided->>'status' <> 'APPROVED' then raise exception 'decide approve must return APPROVED'; end if;

  begin
    perform public.decide_live_approval_request(v_id, 'admin-2', true, 'again');
    raise exception 'second decide must fail';
  exception when others then
    if sqlerrm not like '%already been decided%' then raise; end if;
  end;

  v_consumed := public.consume_live_approval_request(v_id, null, 'RECORD', 'CREATE', 'agent-1');
  if v_consumed->>'status' <> 'CONSUMED' then raise exception 'consume must return CONSUMED'; end if;

  begin
    perform public.consume_live_approval_request(v_id, null, 'RECORD', 'CREATE', 'agent-1');
    raise exception 'second consume must fail';
  exception when others then
    if sqlerrm not like '%not APPROVED%' then raise; end if;
  end;

  v_created := public.create_live_approval_request(
    'RECORD', 'UPDATE', 'agent-1', 'reject path', '{}'::jsonb, 'sha256:abc', null, '{}', '{}'
  );
  v_id := (v_created->>'id')::uuid;
  v_decided := public.decide_live_approval_request(v_id, 'admin-1', false, 'no');
  if v_decided->>'status' <> 'REJECTED' then raise exception 'decide reject must return REJECTED'; end if;

  v_created := public.create_live_approval_request(
    'DOCUMENT', 'UPDATE', 'agent-alpha', 'binding', '{}'::jsonb, 'sha256:abc', null, '{}', '{}'
  );
  v_id := (v_created->>'id')::uuid;
  perform public.decide_live_approval_request(v_id, 'human-1', true, 'ok');

  begin
    perform public.consume_live_approval_request(v_id, 'sha256:evil', null, null, null);
    raise exception 'artifact mismatch must fail';
  exception when others then
    if sqlerrm not like '%authorizes artifact%' then raise; end if;
  end;
  begin
    perform public.consume_live_approval_request(v_id, null, null, null, null);
    raise exception 'missing artifact hash must fail';
  exception when others then
    if sqlerrm not like '%requires presenting that artifact%hash%' then raise; end if;
  end;
  begin
    perform public.consume_live_approval_request(v_id, 'sha256:abc', 'RECORD', null, null);
    raise exception 'entity mismatch must fail';
  exception when others then
    if sqlerrm not like '%authorizes entityType%' then raise; end if;
  end;
  begin
    perform public.consume_live_approval_request(v_id, 'sha256:abc', 'DOCUMENT', 'DELETE', null);
    raise exception 'action mismatch must fail';
  exception when others then
    if sqlerrm not like '%authorizes action%' then raise; end if;
  end;
  begin
    perform public.consume_live_approval_request(v_id, 'sha256:abc', 'DOCUMENT', 'UPDATE', 'agent-beta');
    raise exception 'requester mismatch must fail';
  exception when others then
    if sqlerrm not like '%cannot be redeemed%' then raise; end if;
  end;

  v_consumed := public.consume_live_approval_request(v_id, 'sha256:abc', 'DOCUMENT', 'UPDATE', 'agent-alpha');
  if v_consumed->>'status' <> 'CONSUMED' then raise exception 'matching consume must succeed'; end if;

  v_created := public.create_live_approval_request(
    'RECORD', 'UPDATE', 'agent-1', 'expired', '{}'::jsonb, null, now() - interval '1 minute', '{}', '{}'
  );
  v_id := (v_created->>'id')::uuid;
  perform public.decide_live_approval_request(v_id, 'admin-1', true, 'ok');
  begin
    perform public.consume_live_approval_request(v_id, null, null, null, null);
    raise exception 'expired consume must fail';
  exception when others then
    if sqlerrm not like '%expired at%' then raise; end if;
  end;

  v_created := public.create_live_approval_request(
    'RECORD', 'UPDATE', 'agent-1', 'revoke', '{}'::jsonb, null, null, '{}', '{}'
  );
  v_id := (v_created->>'id')::uuid;
  perform public.decide_live_approval_request(v_id, 'admin-1', true, 'ok');
  v_revoked := public.revoke_live_approval_request(v_id, 'human-2', 'withdrawn');
  if v_revoked->>'status' <> 'REVOKED' then raise exception 'revoke must return REVOKED'; end if;
  begin
    perform public.consume_live_approval_request(v_id, null, null, null, null);
    raise exception 'revoked consume must fail';
  exception when others then
    if sqlerrm not like '%REVOKED%' then raise; end if;
  end;

  v_created := public.create_live_approval_request(
    'RECORD', 'CREATE', 'agent-1', 'other', '{}'::jsonb, null, null, '{}', '{}'
  );
  v_other := (v_created->>'id')::uuid;
  perform public.decide_live_approval_request(v_other, 'admin-1', true, 'ok');
  if public.consume_live_approval_request(v_other, null, null, null, null)->>'status' <> 'CONSUMED' then
    raise exception 'unrelated approval must still consume';
  end if;

  -- CP1 claim / mark-started / finalize
  v_created := public.create_live_approval_request(
    'RECORD', 'CREATE', 'agent-1', 'claim path', '{}'::jsonb, null, null, '{}', '{}'
  );
  v_id := (v_created->>'id')::uuid;
  perform public.decide_live_approval_request(v_id, 'admin-1', true, 'ok');
  v_decided := public.claim_live_approval_request(v_id, 'RECORD', 'CREATE', 'agent-1', null, 'req-1');
  if v_decided->>'status' <> 'CLAIMED' then raise exception 'claim must return CLAIMED'; end if;
  if v_decided->>'liveExecutionId' is null then raise exception 'claim must mint liveExecutionId'; end if;
  if v_decided->>'claimedBy' <> 'agent-1' then raise exception 'claim must persist claimedBy'; end if;
  if public.get_live_approval_request(v_id)->>'status' <> 'CLAIMED' then
    raise exception 'claimed status must survive reload';
  end if;
  if public.get_live_approval_request(v_id)->>'liveExecutionId' is distinct from v_decided->>'liveExecutionId' then
    raise exception 'liveExecutionId must survive reload';
  end if;

  begin
    perform public.claim_live_approval_request(v_id, 'RECORD', 'CREATE', 'agent-1', null, null);
    raise exception 'second claim must fail';
  exception when others then
    if sqlerrm not like '%not APPROVED%' then raise; end if;
  end;

  begin
    perform public.claim_live_approval_request(
      '00000000-0000-4000-8000-000000000099', 'RECORD', 'CREATE', 'agent-1', null, null
    );
    raise exception 'missing claim must fail';
  exception when others then
    if sqlerrm not like '%not found%' then raise; end if;
  end;

  v_consumed := public.mark_live_approval_execution_started(
    v_id, (v_decided->>'liveExecutionId')::uuid
  );
  if v_consumed->>'executionStartedAt' is null then
    raise exception 'mark-started must set executionStartedAt';
  end if;
  if public.mark_live_approval_execution_started(
    v_id, (v_decided->>'liveExecutionId')::uuid
  )->>'executionStartedAt' is distinct from v_consumed->>'executionStartedAt' then
    raise exception 'mark-started must be idempotent for the same liveExecutionId';
  end if;
  if public.get_live_approval_request(v_id)->>'executionStartedAt' is null then
    raise exception 'executionStartedAt must survive reload';
  end if;
  begin
    perform public.mark_live_approval_execution_started(
      v_id, '00000000-0000-4000-8000-000000000099'
    );
    raise exception 'wrong liveExecutionId mark-started must fail';
  exception when others then
    if sqlerrm not like '%liveExecutionId%' then raise; end if;
  end;

  v_listed := public.finalize_live_approval_request(
    v_id,
    (v_decided->>'liveExecutionId')::uuid,
    'FULFILLED',
    null,
    '11111111-1111-4111-8111-111111111111',
    'ok'
  );
  if v_listed->>'status' <> 'FULFILLED' then raise exception 'finalize must return FULFILLED'; end if;
  if public.get_live_approval_request(v_id)->>'finalOutcome' <> 'FULFILLED' then
    raise exception 'terminal outcome must survive reload';
  end if;
  if public.finalize_live_approval_request(
    v_id,
    (v_decided->>'liveExecutionId')::uuid,
    'FULFILLED',
    null,
    '11111111-1111-4111-8111-111111111111',
    'ok'
  )->>'status' <> 'FULFILLED' then
    raise exception 'terminal replay must return stored FULFILLED';
  end if;
  begin
    perform public.finalize_live_approval_request(
      v_id,
      (v_decided->>'liveExecutionId')::uuid,
      'FAILED',
      'nope',
      null,
      null
    );
    raise exception 'conflicting terminal must fail';
  exception when others then
    if sqlerrm not like '%conflicting terminal%' then raise; end if;
  end;
  begin
    perform public.claim_live_approval_request(v_id, 'RECORD', 'CREATE', 'agent-1', null, null);
    raise exception 'reclaim after finalize must fail';
  exception when others then
    if sqlerrm not like '%not APPROVED%' then raise; end if;
  end;

  v_created := public.create_live_approval_request(
    'DOCUMENT', 'UPDATE', 'agent-alpha', 'claim bind', '{}'::jsonb, 'sha256:abc', null, '{}', '{}'
  );
  v_id := (v_created->>'id')::uuid;
  perform public.decide_live_approval_request(v_id, 'human-1', true, 'ok');
  begin
    perform public.claim_live_approval_request(v_id, 'RECORD', 'UPDATE', 'agent-alpha', 'sha256:abc', null);
    raise exception 'claim entity mismatch must fail';
  exception when others then
    if sqlerrm not like '%authorizes entityType%' then raise; end if;
  end;
  begin
    perform public.claim_live_approval_request(v_id, 'DOCUMENT', 'DELETE', 'agent-alpha', 'sha256:abc', null);
    raise exception 'claim action mismatch must fail';
  exception when others then
    if sqlerrm not like '%authorizes action%' then raise; end if;
  end;
  begin
    perform public.claim_live_approval_request(v_id, 'DOCUMENT', 'UPDATE', 'agent-beta', 'sha256:abc', null);
    raise exception 'claim executor mismatch must fail';
  exception when others then
    if sqlerrm not like '%cannot be claimed%' then raise; end if;
  end;
  begin
    perform public.claim_live_approval_request(v_id, 'DOCUMENT', 'UPDATE', 'agent-alpha', 'sha256:evil', null);
    raise exception 'claim artifact mismatch must fail';
  exception when others then
    if sqlerrm not like '%authorizes artifact%' then raise; end if;
  end;
  if public.claim_live_approval_request(
    v_id, 'DOCUMENT', 'UPDATE', 'agent-alpha', 'sha256:abc', null
  )->>'status' <> 'CLAIMED' then
    raise exception 'matching claim must succeed';
  end if;

  v_created := public.create_live_approval_request(
    'RECORD', 'CREATE', 'agent-1', 'pin', '{}'::jsonb, null, null, '{}', '{}'
  );
  v_id := (v_created->>'id')::uuid;
  perform public.decide_live_approval_request(v_id, 'admin-1', true, 'ok');
  if public.claim_live_approval_request(
    v_id, 'RECORD', 'CREATE', 'agent-1', 'sha256:pinned', null
  )->>'artifactHash' <> 'sha256:pinned' then
    raise exception 'unbound claim must pin presented artifact';
  end if;

  v_created := public.create_live_approval_request(
    'RECORD', 'CREATE', 'agent-1', 'expired claim', '{}'::jsonb, null, now() - interval '1 minute', '{}', '{}'
  );
  v_id := (v_created->>'id')::uuid;
  perform public.decide_live_approval_request(v_id, 'admin-1', true, 'ok');
  begin
    perform public.claim_live_approval_request(v_id, 'RECORD', 'CREATE', 'agent-1', null, null);
    raise exception 'expired claim must fail';
  exception when others then
    if sqlerrm not like '%expired at%' then raise; end if;
  end;

  v_created := public.create_live_approval_request(
    'RECORD', 'CREATE', 'agent-1', 'revoked claim', '{}'::jsonb, null, null, '{}', '{}'
  );
  v_id := (v_created->>'id')::uuid;
  perform public.decide_live_approval_request(v_id, 'admin-1', true, 'ok');
  perform public.revoke_live_approval_request(v_id, 'human-2', 'withdrawn');
  begin
    perform public.claim_live_approval_request(v_id, 'RECORD', 'CREATE', 'agent-1', null, null);
    raise exception 'revoked claim must fail';
  exception when others then
    if sqlerrm not like '%REVOKED%' then raise; end if;
  end;

  v_created := public.create_live_approval_request(
    'RECORD', 'CREATE', 'agent-1', 'fail finalize', '{}'::jsonb, null, null, '{}', '{}'
  );
  v_id := (v_created->>'id')::uuid;
  perform public.decide_live_approval_request(v_id, 'admin-1', true, 'ok');
  v_decided := public.claim_live_approval_request(v_id, 'RECORD', 'CREATE', 'agent-1', null, null);
  begin
    perform public.finalize_live_approval_request(
      v_id, (v_decided->>'liveExecutionId')::uuid, 'FAILED', null, null, null
    );
    raise exception 'FAILED without reason must fail';
  exception when others then
    if sqlerrm not like '%FAILED requires a reason%' then raise; end if;
  end;
  begin
    perform public.finalize_live_approval_request(
      v_id, (v_decided->>'liveExecutionId')::uuid, 'OUTCOME_UNKNOWN', 'not started', null, null
    );
    raise exception 'UNKNOWN without start must fail';
  exception when others then
    if sqlerrm not like '%OUTCOME_UNKNOWN requires execution to have started%' then raise; end if;
  end;
  begin
    perform public.finalize_live_approval_request(
      v_id, '00000000-0000-4000-8000-000000000099', 'FAILED', 'wrong', null, null
    );
    raise exception 'wrong liveExecutionId finalize must fail';
  exception when others then
    if sqlerrm not like '%liveExecutionId%' then raise; end if;
  end;
  if public.finalize_live_approval_request(
    v_id, (v_decided->>'liveExecutionId')::uuid, 'FAILED', 'known failure', null, null
  )->>'status' <> 'FAILED' then
    raise exception 'FAILED finalize must succeed';
  end if;

  v_created := public.create_live_approval_request(
    'RECORD', 'CREATE', 'agent-1', 'unknown finalize', '{}'::jsonb, null, null, '{}', '{}'
  );
  v_id := (v_created->>'id')::uuid;
  perform public.decide_live_approval_request(v_id, 'admin-1', true, 'ok');
  v_decided := public.claim_live_approval_request(v_id, 'RECORD', 'CREATE', 'agent-1', null, null);
  perform public.mark_live_approval_execution_started(v_id, (v_decided->>'liveExecutionId')::uuid);
  if public.finalize_live_approval_request(
    v_id, (v_decided->>'liveExecutionId')::uuid, 'OUTCOME_UNKNOWN', 'crash', null, null
  )->>'status' <> 'OUTCOME_UNKNOWN' then
    raise exception 'OUTCOME_UNKNOWN finalize must succeed after start';
  end if;

  begin
    perform public.mark_live_approval_execution_started(
      v_other, '00000000-0000-4000-8000-000000000099'
    );
    raise exception 'mark-started of non-CLAIMED must fail';
  exception when others then
    if sqlerrm not like '%not CLAIMED%' then raise; end if;
  end;
end;
$$;

rollback;
