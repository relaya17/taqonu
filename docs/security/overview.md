# Security overview

- Supabase RLS on exposed application tables
- Service-role keys server-side only
- Secret detection before embedding, logging, memory write, and LLM transmission
- Deployment env tools expose metadata only — never secret values
- Write tools require explicit approval
- Webhook signature verification for GitHub
- Untrusted external content (repos, web) cannot redefine system policy
- **PRIVATE-BY-DEFAULT** (ADR-021): non-public API routes require a session; robots/noindex are not access control
- **SEPARATE-CONTROL-PLANE**: `owner`/`operator` vs customer `admin`; Control Plane :3100 requires a bearer token; Owner UI is `apps/admin` (:3200), not `apps/web/app/admin`
- Atlas Gateway is the only Control Plane ↔ application/agent integration boundary
- Atlas may propose self-fixes; it cannot silently weaken security or rewrite audit history
- LLM egress is classified and policy-gated (secrets never go to external providers)
- Internal suites (`governance-adversarial`, `production:live-proof`, Control Plane auth tests) are **not** an external penetration test. Externally tested: none until an Owner-authorized engagement.
- Loopback private-plane success (`127.0.0.1` / `localhost`) is **LOCAL PRIVATE PLANE**, not production Tailscale/systemd exposure proof.
- Admin `GET /` is a public promo page; privileged Admin JSON (`/api/v1/platform/hierarchy` and writes) remains bearer-gated.
