-- Exclusive STARTED occupancy: a second mark for the same liveExecutionId
-- must fail closed so two API processes cannot both run executeOnce.
-- Replaces the idempotent RETURN of 20260903010000.

create or replace function public.mark_live_approval_execution_started(
  p_id uuid,
  p_live_execution_id uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_row public.live_approval_requests%rowtype;
begin
  select * into v_row from public.live_approval_requests where id = p_id for update;
  if not found then
    raise exception 'Approval request % not found', p_id;
  end if;
  if v_row.status <> 'CLAIMED' then
    raise exception 'Approval request % is not CLAIMED (status=%) and cannot mark execution started', p_id, v_row.status;
  end if;
  if v_row.live_execution_id is distinct from p_live_execution_id then
    raise exception 'liveExecutionId does not match';
  end if;
  if v_row.execution_started_at is not null then
    raise exception 'Approval request % already has execution started and cannot be marked started again', p_id;
  end if;
  update public.live_approval_requests
    set execution_started_at = now()
    where id = p_id
    returning * into v_row;
  return public.live_approval_request_to_json(v_row);
end;
$$;
