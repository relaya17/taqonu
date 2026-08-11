# Security overview

- Supabase RLS on exposed application tables
- Service-role keys server-side only
- Secret detection before embedding, logging, memory write, and LLM transmission
- Deployment env tools expose metadata only — never secret values
- Write tools require explicit approval
- Webhook signature verification for GitHub
- Untrusted external content (repos, web) cannot redefine system policy
