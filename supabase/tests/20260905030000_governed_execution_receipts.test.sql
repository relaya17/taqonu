-- P0.1 — verification script for
-- 20260905030000_governed_execution_receipts.sql.
--
-- NOT EXECUTED IN THIS SESSION: this environment has no local Postgres,
-- Docker, or Supabase CLI (`which docker supabase psql` all resolve to
-- nothing), so this script could not be run against a real database this
-- pass. It is written to be run with `psql "$SUPABASE_DB_URL" -f
-- supabase/tests/20260905030000_governed_execution_receipts.test.sql`
-- against a local `supabase start` instance (or CI's Postgres) with
-- 20260905030000_governed_execution_receipts.sql applied, BEFORE this
-- migration or the repository built on top of it is trusted as verified.
-- Every assertion below was derived by hand-tracing the table/index/RLS SQL
-- in that migration and the claim/finalize/reclaim SQL in
-- packages/database/src/repositories/governed-execution-receipt.ts; none of
-- it has been machine-checked.
--
-- The whole script runs inside one transaction and ends with ROLLBACK, so
-- it is always safe to run against a real (even non-disposable) dev
-- database -- nothing it does is retained.
--
-- Covers:
--   1. Claim: a plain insert with a fresh idempotency_key succeeds with
--      status='STARTED'.
--   2. Duplicate claim: a second insert with the SAME idempotency_key (even
--      a different id/artifact_hash) is rejected by the unique index --
--      this is the entire safety property the P0.1 claim step depends on.
--   3. Finalize: a conditional `update ... where idempotency_key = $1 and
--      status = 'STARTED'` succeeds exactly once; a second attempt against
--      the now-EXECUTED row affects zero rows (the race-safety property the
--      repository's finalize() depends on).
--   4. Concurrent-unique: two different idempotency_keys claim
--      independently and do not interfere with each other.
--   5. Reclaim-after-failure: a row finalized to FAILED can be reclaimed
--      (status set back to STARTED) by a conditional update, but a second
--      concurrent reclaim attempt against the same FAILED row affects zero
--      rows once the first has won.
--   6. status check constraint rejects a value outside
--      STARTED/EXECUTED/FAILED/OUTCOME_UNKNOWN.
--   7. RLS: no INSERT/SELECT policy exists for anon/authenticated --
--      service-role only, exactly like tool_calls/agent_steps.

begin;

create or replace function pg_temp.new_owner(out owner_id uuid) language plpgsql as $fn$
begin
  owner_id := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, aud, role)
  values (owner_id, owner_id::text || '@example.test', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, 'authenticated', 'authenticated');
end;
$fn$;

-- ===================================================================
-- 1 & 2. Claim succeeds once; a duplicate idempotency_key is rejected
-- ===================================================================
do $$
declare
  v_owner uuid; v_key text := 'test-key-' || gen_random_uuid()::text;
  v_id1 uuid := gen_random_uuid(); v_id2 uuid := gen_random_uuid();
  v_row record; v_conflict boolean := false;
begin
  select owner_id into v_owner from pg_temp.new_owner();

  insert into public.governed_execution_receipts
      (id, idempotency_key, owner_id, project_id, entity_type, action, artifact_hash, status)
    values (v_id1, v_key, v_owner, null, 'RECORD', 'create', 'hash-one', 'STARTED');
  select * into v_row from public.governed_execution_receipts where id = v_id1;

  if v_row.status <> 'STARTED' then
    raise exception 'FAIL 1: fresh claim did not default to STARTED (got %)', v_row.status;
  end if;
  if v_row.finalized_at is not null then
    raise exception 'FAIL 1: fresh claim already has finalized_at set';
  end if;
  raise notice 'PASS 1: fresh idempotency_key claims a STARTED row';

  begin
    insert into public.governed_execution_receipts
        (id, idempotency_key, owner_id, project_id, entity_type, action, artifact_hash, status)
      values (v_id2, v_key, v_owner, null, 'RECORD', 'create', 'hash-two', 'STARTED');
  exception when unique_violation then v_conflict := true;
  end;
  if not v_conflict then
    raise exception 'FAIL 2: a second insert with the SAME idempotency_key (%) succeeded -- the unique index is missing or too narrow', v_key;
  end if;
  raise notice 'PASS 2: a duplicate idempotency_key is rejected by the unique index, even with a different id/artifact_hash';
end;
$$;

-- ===================================================================
-- 3. Finalize is race-safe: only the first STARTED->terminal transition
-- can ever match; a second attempt against the same row is a no-op.
-- ===================================================================
do $$
declare
  v_owner uuid; v_key text := 'test-key-' || gen_random_uuid()::text; v_id uuid := gen_random_uuid();
  v_updated_first int; v_updated_second int; v_row record;
begin
  select owner_id into v_owner from pg_temp.new_owner();
  insert into public.governed_execution_receipts
      (id, idempotency_key, owner_id, project_id, entity_type, action, artifact_hash, status)
    values (v_id, v_key, v_owner, null, 'RECORD', 'create', 'hash-three', 'STARTED');

  with updated as (
    update public.governed_execution_receipts
      set status = 'EXECUTED', outcome = '{"stage":"EXECUTION","status":"EXECUTED","output":"ok"}'::jsonb, finalized_at = now()
      where idempotency_key = v_key and status = 'STARTED'
      returning 1
  )
  select count(*) into v_updated_first from updated;
  if v_updated_first <> 1 then
    raise exception 'FAIL 3a: first finalize (STARTED -> EXECUTED) did not affect exactly one row (affected %)', v_updated_first;
  end if;

  -- A second finalize attempt (simulating a racing/duplicate finalizer, or
  -- a caller mistakenly finalizing twice) must be a pure no-op: the WHERE
  -- clause's `status = 'STARTED'` predicate no longer matches.
  with updated as (
    update public.governed_execution_receipts
      set status = 'FAILED', outcome = '{"stage":"EXECUTION","status":"FAILED","reason":"should never apply"}'::jsonb, finalized_at = now()
      where idempotency_key = v_key and status = 'STARTED'
      returning 1
  )
  select count(*) into v_updated_second from updated;
  if v_updated_second <> 0 then
    raise exception 'FAIL 3b: second finalize attempt against an already-finalized row affected % rows -- finalize is not race-safe', v_updated_second;
  end if;

  select * into v_row from public.governed_execution_receipts where idempotency_key = v_key;
  if v_row.status <> 'EXECUTED' then
    raise exception 'FAIL 3c: row status was overwritten by the second (should-be-no-op) finalize attempt (got %)', v_row.status;
  end if;
  raise notice 'PASS 3: finalize is race-safe -- only the first STARTED->terminal transition applies, a second attempt is a no-op';
end;
$$;

-- ===================================================================
-- 4. Concurrent-unique: two different idempotency_keys do not interfere
-- ===================================================================
do $$
declare
  v_owner uuid; v_key_a text := 'test-key-a-' || gen_random_uuid()::text; v_key_b text := 'test-key-b-' || gen_random_uuid()::text;
  v_count int;
begin
  select owner_id into v_owner from pg_temp.new_owner();
  insert into public.governed_execution_receipts
      (id, idempotency_key, owner_id, project_id, entity_type, action, artifact_hash, status)
    values (gen_random_uuid(), v_key_a, v_owner, null, 'RECORD', 'create', 'hash-a', 'STARTED');
  insert into public.governed_execution_receipts
      (id, idempotency_key, owner_id, project_id, entity_type, action, artifact_hash, status)
    values (gen_random_uuid(), v_key_b, v_owner, null, 'RECORD', 'create', 'hash-b', 'STARTED');

  select count(*) into v_count from public.governed_execution_receipts where idempotency_key in (v_key_a, v_key_b);
  if v_count <> 2 then
    raise exception 'FAIL 4: two distinct idempotency_keys did not both claim independently (count=%)', v_count;
  end if;
  raise notice 'PASS 4: distinct idempotency_keys claim independently without interference';
end;
$$;

-- ===================================================================
-- 5. Reclaim-after-failure: FAILED -> STARTED is a valid, race-safe retry
-- transition; a second concurrent reclaim attempt is a no-op once the
-- first has won.
-- ===================================================================
do $$
declare
  v_owner uuid; v_key text := 'test-key-' || gen_random_uuid()::text; v_id uuid := gen_random_uuid();
  v_reclaimed_first int; v_reclaimed_second int; v_row record;
begin
  select owner_id into v_owner from pg_temp.new_owner();
  insert into public.governed_execution_receipts
      (id, idempotency_key, owner_id, project_id, entity_type, action, artifact_hash, status, outcome, finalized_at)
    values (v_id, v_key, v_owner, null, 'RECORD', 'create', 'hash-retry', 'FAILED', '{"stage":"EXECUTION","status":"FAILED","reason":"first attempt failed"}'::jsonb, now());

  with reclaimed as (
    update public.governed_execution_receipts
      set status = 'STARTED', outcome = null, finalized_at = null, started_at = now()
      where idempotency_key = v_key and status = 'FAILED'
      returning 1
  )
  select count(*) into v_reclaimed_first from reclaimed;
  if v_reclaimed_first <> 1 then
    raise exception 'FAIL 5a: reclaim of a FAILED row did not affect exactly one row (affected %)', v_reclaimed_first;
  end if;

  with reclaimed as (
    update public.governed_execution_receipts
      set status = 'STARTED', outcome = null, finalized_at = null, started_at = now()
      where idempotency_key = v_key and status = 'FAILED'
      returning 1
  )
  select count(*) into v_reclaimed_second from reclaimed;
  if v_reclaimed_second <> 0 then
    raise exception 'FAIL 5b: a second, racing reclaim attempt affected % rows -- reclaim is not race-safe', v_reclaimed_second;
  end if;

  select * into v_row from public.governed_execution_receipts where idempotency_key = v_key;
  if v_row.status <> 'STARTED' or v_row.outcome is not null or v_row.finalized_at is not null then
    raise exception 'FAIL 5c: reclaimed row is not in a clean STARTED state (status=%, outcome=%, finalized_at=%)', v_row.status, v_row.outcome, v_row.finalized_at;
  end if;
  raise notice 'PASS 5: a FAILED receipt can be reclaimed to STARTED exactly once, race-safely, enabling a safe retry after a clean failure';
end;
$$;

-- ===================================================================
-- 6. status check constraint rejects an invalid value
-- ===================================================================
do $$
declare
  v_owner uuid; v_failed boolean := false;
begin
  select owner_id into v_owner from pg_temp.new_owner();
  begin
    insert into public.governed_execution_receipts
        (id, idempotency_key, owner_id, project_id, entity_type, action, artifact_hash, status)
      values (gen_random_uuid(), 'test-key-' || gen_random_uuid()::text, v_owner, null, 'RECORD', 'create', 'hash-bad-status', 'NOT_A_REAL_STATUS');
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 6: an insert with an invalid status value succeeded -- the check constraint is missing/too permissive';
  end if;
  raise notice 'PASS 6: the status check constraint rejects values outside STARTED/EXECUTED/FAILED/OUTCOME_UNKNOWN';
end;
$$;

-- ===================================================================
-- 7. RLS: no INSERT/SELECT policy for anon/authenticated -- service-role
-- only, exactly like tool_calls/agent_steps/security_events.
-- ===================================================================
do $$
declare
  v_owner uuid; v_insert_failed boolean := false; v_select_count int;
  v_id uuid := gen_random_uuid();
begin
  select owner_id into v_owner from pg_temp.new_owner();

  -- Seed one row as the (RLS-bypassing) owning session, then confirm an
  -- authenticated role can neither read nor write this table at all.
  insert into public.governed_execution_receipts
      (id, idempotency_key, owner_id, project_id, entity_type, action, artifact_hash, status)
    values (v_id, 'test-key-' || gen_random_uuid()::text, v_owner, null, 'RECORD', 'create', 'hash-rls', 'STARTED');

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.governed_execution_receipts
        (id, idempotency_key, owner_id, project_id, entity_type, action, artifact_hash, status)
      values (gen_random_uuid(), 'test-key-' || gen_random_uuid()::text, v_owner, null, 'RECORD', 'create', 'hash-rls-2', 'STARTED');
  exception when others then v_insert_failed := true;
  end;

  select count(*) into v_select_count from public.governed_execution_receipts where id = v_id;
  reset role;

  if not v_insert_failed then
    raise exception 'FAIL 7a: an authenticated (non-service-role) insert into governed_execution_receipts succeeded -- RLS write policy is missing/too permissive';
  end if;
  if v_select_count <> 0 then
    raise exception 'FAIL 7b: an authenticated (non-service-role) select against governed_execution_receipts returned % rows -- RLS read policy is missing/too permissive (this table intentionally has none)', v_select_count;
  end if;
  raise notice 'PASS 7: governed_execution_receipts has no anon/authenticated policy at all -- reads and writes both remain service-role-only';
end;
$$;

raise notice '=== governed_execution_receipts verification script complete -- see individual PASS/FAIL/NOTE notices above ===';

rollback;
