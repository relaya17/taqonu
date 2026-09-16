-- Step 4 Decision B: API-owned durable authority for agent runtime controls.
--
-- Durable subset only: PAUSED, QUARANTINED, REVOKED, DISABLED. SUSPENDED and
-- DEGRADED remain Control Plane's own ephemeral, in-memory overlay
-- (apps/control-plane/src/services/agent-registry.ts) -- unchanged by this
-- migration. Absence of a row for a given agent_id means "no durable
-- override", read by callers as ACTIVE-for-this-subset, mirroring today's
-- Map-based default in Control Plane.
--
-- Written only via the Control-Plane-service-authenticated endpoint
-- (apps/api/src/routes/agent-runtime-controls.ts, guarded by
-- requireControlPlaneService, same bearer contract as the existing
-- governed-lifecycle-handoff and atlas-self-control routes). Read
-- in-process by resolveGovernedAgentIdentity / dispatchAgentAction -- no
-- network hop to Control Plane for this subset. See
-- step4-architectural-decision-audit.md Sec 2 for the full design.
create table public.agent_runtime_controls (
  agent_id text primary key check (char_length(agent_id) between 1 and 200),
  status text not null check (status in ('PAUSED', 'QUARANTINED', 'REVOKED', 'DISABLED')),
  set_by text not null check (char_length(set_by) between 1 and 200),
  reason text not null check (char_length(reason) between 1 and 2000),
  set_at timestamptz not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create index agent_runtime_controls_status_idx
  on public.agent_runtime_controls (status);

alter table public.agent_runtime_controls enable row level security;
-- No policies: only the service role (which bypasses RLS) may read or
-- write this table, exactly like public.live_approval_requests. There is
-- no end-user-facing access path to this table.

comment on table public.agent_runtime_controls is
  'Durable subset (PAUSED/QUARANTINED/REVOKED/DISABLED) of agent runtime status, owned by apps/api as the single durable authority (Step 4 Decision B). SUSPENDED/DEGRADED remain Control Plane in-memory only.';
