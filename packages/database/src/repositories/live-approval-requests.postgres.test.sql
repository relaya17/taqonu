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
end;
$$;

rollback;
