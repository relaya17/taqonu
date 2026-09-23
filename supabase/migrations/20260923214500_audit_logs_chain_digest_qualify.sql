-- Qualify pgcrypto digest so the existing audit-chain AFTER INSERT trigger
-- resolves under SET search_path = public (Supabase installs pgcrypto in
-- schema extensions). Does not change hash algorithm, tip locking, or
-- same-transaction audit insertion.

create or replace function public.audit_logs_chain_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_tip text;
  computed_hash text;
begin
  select tip_hash into current_tip
    from public.audit_logs_chain_tip
    where id = true
    for update;

  if current_tip is null then
    current_tip := 'GENESIS';
  end if;

  computed_hash := encode(
    extensions.digest(current_tip || '|' || coalesce(new.payload::text, '{}'), 'sha256'),
    'hex'
  );

  update public.audit_logs
    set prev_hash = current_tip, hash = computed_hash
    where id = new.id;

  update public.audit_logs_chain_tip set tip_hash = computed_hash where id = true;

  return null;
end;
$$;
