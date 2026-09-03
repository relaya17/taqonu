-- Phase 13: Atlas-self approvals cannot be decided by the requester.
-- Reuses live_approval_requests.context.applicationId / projectId.
-- Does not change non-self decide behavior.

create or replace function public.decide_live_approval_request(
  p_id uuid,
  p_decided_by text,
  p_approve boolean,
  p_decision_reason text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_row public.live_approval_requests%rowtype;
  v_status text;
  v_application_id text;
  v_project_id text;
begin
  select * into v_row from public.live_approval_requests where id = p_id for update;
  if not found then
    raise exception 'Approval request % not found', p_id;
  end if;
  if v_row.status <> 'PENDING' then
    raise exception 'Approval request % has already been decided (status=%)', p_id, v_row.status;
  end if;
  v_application_id := v_row.context ->> 'applicationId';
  v_project_id := v_row.context ->> 'projectId';
  if (
    v_application_id = 'def-000'
    or v_project_id = '00000000-0000-4000-8000-def000000001'
  ) and p_decided_by = v_row.requested_by then
    raise exception 'Approval request % was requested by % -- separation of duties forbids the same identity from also deciding an Atlas-self approval',
      p_id, v_row.requested_by;
  end if;
  v_status := case when p_approve then 'APPROVED' else 'REJECTED' end;
  update public.live_approval_requests
    set status = v_status,
        decided_by = p_decided_by,
        decided_at = now(),
        decision_reason = p_decision_reason
    where id = p_id
    returning * into v_row;
  return public.live_approval_request_to_json(v_row);
end;
$$;
