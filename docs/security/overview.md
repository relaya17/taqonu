# Security overview

- Supabase RLS on exposed application tables
- Service-role keys server-side only
- Secret detection before embedding, logging, memory write, and LLM transmission
- Deployment env tools expose metadata only — never secret values
- Write tools require explicit approval
- Webhook signature verification for GitHub
- Untrusted external content (repos, web) cannot redefine system policy
- **PRIVATE-BY-DEFAULT** (ADR-021): non-public API routes require a session; robots/noindex are not access control
- **SEPARATE-CONTROL-PLANE**: `owner`/`operator` vs customer `admin`; Control Plane :3100 requires a bearer token
- Atlas may propose self-fixes; it cannot silently weaken security or rewrite audit history
