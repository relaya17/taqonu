-- P0 persistence fix — verification script for
-- 20260905000000_audit_logs_canonical_chain.sql.
--
-- NOT EXECUTED IN THIS SESSION: this environment has no local Postgres,
-- Docker, or Supabase CLI (`which docker supabase psql` all resolve to
-- nothing), so this script could not be run against a real database this
-- pass. It is written to be run with `psql "$SUPABASE_DB_URL" -f
-- supabase/tests/20260905000000_audit_logs_canonical_chain.test.sql`
-- against a local `supabase start` instance (or CI's Postgres) with
-- 20260905000000_audit_logs_canonical_chain.sql applied, BEFORE this
-- migration is trusted as verified. Every assertion below was derived by
-- hand-tracing the trigger/policy SQL in that migration; it has not been
-- machine-checked.
--
-- The whole script runs inside one transaction and ends with ROLLBACK, so
-- it is always safe to run against a real (even non-disposable) dev
-- database -- nothing it does is retained.
--
-- P0 CORRECTION (2026-09-05): the migration's chain trigger moved from
-- BEFORE INSERT to AFTER INSERT (see the migration file's header comment
-- for the full root cause). Scenario 6 below is the new, decisive
-- regression test for exactly the bug that correction fixes: appending the
-- same id twice must not advance the chain tip on the second (discarded)
-- attempt. Scenarios 1-3 needed no logic change, only re-confirmation that
-- a post-insert SELECT (which is how this script and the real repository
-- both observe the chain values -- see AuditLogRepository.append(), which
-- now always re-reads by id) still sees the AFTER trigger's fully-applied
-- result.
--
-- Covers:
--   1. First insert chains from GENESIS; seq/prev_hash/hash populated
--      (observed via a post-insert SELECT, not the INSERT's own RETURNING --
--      an AFTER trigger's effects are never visible in RETURNING).
--   2. Second insert chains from the first row's hash (not GENESIS again) --
--      this is the property that makes the chain tamper-evident; true
--      concurrent-session locking (two backends racing the same tip row)
--      cannot be exercised from a single psql session/script and is called
--      out here as a known verification gap, not claimed as covered.
--   3. hash is a deterministic function of prev_hash + payload (recomputing
--      it by hand matches the trigger-computed value).
--   4. RLS: owner-scoped SELECT only returns the caller's own rows.
--   5. RLS: no INSERT policy exists for anon/authenticated -- only a
--      service-role (RLS-bypassing) connection can insert, exactly like
--      domain_events.
--   6. Duplicate append (ON CONFLICT DO NOTHING) does NOT advance the chain
--      tip -- the regression test for the BEFORE/AFTER INSERT correction.

begin;

create or replace function pg_temp.new_owner(out owner_id uuid) language plpgsql as $fn$
begin
  owner_id := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, aud, role)
  values (owner_id, owner_id::text || '@example.test', 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, 'authenticated', 'authenticated');
end;
$fn$;

-- ===================================================================
-- 1 & 2 & 3. Chain linkage and hash determinism across two inserts
-- ===================================================================
do $$
declare
  v_owner uuid; v_id1 uuid := gen_random_uuid(); v_id2 uuid := gen_random_uuid();
  v_row1 record; v_row2 record; v_expected_hash1 text; v_expected_hash2 text;
  v_tip_before text;
begin
  select owner_id into v_owner from pg_temp.new_owner();

  select tip_hash into v_tip_before from public.audit_logs_chain_tip where id = true;

  insert into public.audit_logs (id, owner_id, action, entity_type, entity_id, payload)
    values (v_id1, v_owner, 'test.action.one', 'RECORD', null, '{"n":1}'::jsonb);
  select * into v_row1 from public.audit_logs where id = v_id1;

  if v_row1.seq is null then raise exception 'FAIL 1: seq was not assigned'; end if;
  if v_row1.prev_hash is distinct from v_tip_before then
    raise exception 'FAIL 1: prev_hash (%) did not chain from the tip before this insert (%)', v_row1.prev_hash, v_tip_before;
  end if;
  v_expected_hash1 := encode(digest(v_tip_before || '|' || v_row1.payload::text, 'sha256'), 'hex');
  if v_row1.hash <> v_expected_hash1 then
    raise exception 'FAIL 1: hash (%) does not match hand-recomputed value (%)', v_row1.hash, v_expected_hash1;
  end if;
  raise notice 'PASS 1: first insert chains from prior tip (%) with a correctly-computed hash', v_tip_before;

  insert into public.audit_logs (id, owner_id, action, entity_type, entity_id, payload)
    values (v_id2, v_owner, 'test.action.two', 'RECORD', null, '{"n":2}'::jsonb);
  select * into v_row2 from public.audit_logs where id = v_id2;

  if v_row2.prev_hash <> v_row1.hash then
    raise exception 'FAIL 2: second insert prev_hash (%) did not chain from first insert''s hash (%) -- chain is broken', v_row2.prev_hash, v_row1.hash;
  end if;
  if v_row2.seq <= v_row1.seq then
    raise exception 'FAIL 2: seq did not advance monotonically (% then %)', v_row1.seq, v_row2.seq;
  end if;
  v_expected_hash2 := encode(digest(v_row1.hash || '|' || v_row2.payload::text, 'sha256'), 'hex');
  if v_row2.hash <> v_expected_hash2 then
    raise exception 'FAIL 3: second row hash (%) does not match hand-recomputed value (%)', v_row2.hash, v_expected_hash2;
  end if;
  raise notice 'PASS 2/3: second insert chains from the first row''s hash, not GENESIS again, and both hashes are independently reproducible';
  raise notice 'NOTE: true concurrent-session locking of the chain tip (two backends racing) is NOT exercised by this single-session script -- it is a hand-traced property of the trigger''s `for update` row lock, not a machine-verified one. Flag for a real multi-connection load test before treating concurrency safety as proven.';
end;
$$;

-- ===================================================================
-- 6. Duplicate append does NOT advance the chain tip (P0 correction
-- regression test). This is the exact bug: a BEFORE INSERT trigger would
-- have advanced audit_logs_chain_tip for the row below even though
-- ON CONFLICT DO NOTHING discards it. An AFTER INSERT trigger must not
-- fire for a discarded row at all.
-- ===================================================================
do $$
declare
  v_owner uuid; v_id uuid := gen_random_uuid();
  v_tip_before text; v_tip_after_first text; v_tip_after_duplicate text;
  v_row record; v_row_after_duplicate record;
begin
  select owner_id into v_owner from pg_temp.new_owner();

  select tip_hash into v_tip_before from public.audit_logs_chain_tip where id = true;

  insert into public.audit_logs (id, owner_id, action, entity_type, entity_id, payload)
    values (v_id, v_owner, 'test.action.dup', 'RECORD', null, '{"n":"dup"}'::jsonb)
    on conflict (id) do nothing;
  select tip_hash into v_tip_after_first from public.audit_logs_chain_tip where id = true;
  select * into v_row from public.audit_logs where id = v_id;

  if v_tip_after_first = v_tip_before then
    raise exception 'FAIL 6: tip did not advance on the genuine first insert (trigger did not fire at all)';
  end if;
  if v_row.hash is null or v_row.hash <> v_tip_after_first then
    raise exception 'FAIL 6: first insert''s row.hash (%) does not match the tip after it (%)', v_row.hash, v_tip_after_first;
  end if;

  -- Retry with the SAME id -- ON CONFLICT DO NOTHING must discard this row
  -- entirely, and the AFTER trigger must therefore never fire for it.
  insert into public.audit_logs (id, owner_id, action, entity_type, entity_id, payload)
    values (v_id, v_owner, 'test.action.dup', 'RECORD', null, '{"n":"dup-retry-should-be-ignored"}'::jsonb)
    on conflict (id) do nothing;
  select tip_hash into v_tip_after_duplicate from public.audit_logs_chain_tip where id = true;
  select * into v_row_after_duplicate from public.audit_logs where id = v_id;

  if v_tip_after_duplicate <> v_tip_after_first then
    raise exception 'FAIL 6: chain tip advanced on a duplicate/idempotent-retry insert (% -> %) -- this is exactly the corrected bug', v_tip_after_first, v_tip_after_duplicate;
  end if;
  if v_row_after_duplicate.payload->>'n' <> 'dup' then
    raise exception 'FAIL 6: the duplicate insert''s payload overwrote the original row -- ON CONFLICT DO NOTHING should have discarded it entirely';
  end if;

  -- A genuinely new row after the duplicate attempt must chain from the
  -- FIRST insert's hash, not from any phantom value the duplicate might
  -- have produced.
  declare
    v_id2 uuid := gen_random_uuid();
    v_row2 record;
  begin
    insert into public.audit_logs (id, owner_id, action, entity_type, entity_id, payload)
      values (v_id2, v_owner, 'test.action.after-dup', 'RECORD', null, '{"n":"after-dup"}'::jsonb)
      on conflict (id) do nothing;
    select * into v_row2 from public.audit_logs where id = v_id2;
    if v_row2.prev_hash <> v_row.hash then
      raise exception 'FAIL 6: row after the duplicate attempt chains from % instead of the first insert''s hash %', v_row2.prev_hash, v_row.hash;
    end if;
  end;

  raise notice 'PASS 6: duplicate/idempotent-retry insert does not advance the chain tip and does not corrupt subsequent linkage';
end;
$$;

-- ===================================================================
-- 4. RLS: owner-scoped SELECT isolation
-- ===================================================================
do $$
declare
  v_owner_a uuid; v_owner_b uuid; v_id uuid := gen_random_uuid();
  v_count_a int; v_count_b int;
begin
  select owner_id into v_owner_a from pg_temp.new_owner();
  select owner_id into v_owner_b from pg_temp.new_owner();

  insert into public.audit_logs (id, owner_id, action, entity_type, entity_id, payload)
    values (v_id, v_owner_a, 'test.action.isolation', 'RECORD', null, '{}'::jsonb);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count_a from public.audit_logs where id = v_id;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count_b from public.audit_logs where id = v_id;
  reset role;

  if v_count_a <> 1 then raise exception 'FAIL 4a: owner could not see their own audit_logs row via RLS (count=%)', v_count_a; end if;
  if v_count_b <> 0 then raise exception 'FAIL 4b: a different owner could see another owner''s audit_logs row via RLS (count=%)', v_count_b; end if;
  raise notice 'PASS 4: audit_logs_owner_select isolates rows correctly by owner_id';
end;
$$;

-- ===================================================================
-- 5. RLS: no INSERT policy for anon/authenticated -- writes are
-- service-role-only, exactly like domain_events.
-- ===================================================================
do $$
declare
  v_owner uuid; v_failed boolean := false;
begin
  select owner_id into v_owner from pg_temp.new_owner();
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.audit_logs (id, owner_id, action, entity_type, entity_id, payload)
      values (gen_random_uuid(), v_owner, 'test.action.should.fail', 'RECORD', null, '{}'::jsonb);
  exception when others then v_failed := true;
  end;
  reset role;
  if not v_failed then raise exception 'FAIL 5: an authenticated (non-service-role) insert into audit_logs succeeded -- RLS write policy is missing/too permissive'; end if;
  raise notice 'PASS 5: no INSERT policy exists for anon/authenticated -- audit_logs writes remain service-role-only';
end;
$$;

raise notice '=== audit_logs canonical chain verification script complete -- see individual PASS/FAIL/NOTE notices above ===';

rollback;
