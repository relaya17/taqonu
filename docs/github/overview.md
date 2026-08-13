# GitHub

GitHub App integration: least-privilege permissions, webhook signature verification, staged sync → memory, and continuous Truth.

## Continuous Truth (TRUTH-10)

1. Webhook `push` / `pull_request` → match project → `tryContinuousObserve`
2. When App credentials + installation + `headSha` exist → **Check Run** named `Atlas Truth`
3. Requires App permission **`checks:write`** (accept permission update on install)

See: `packages/integrations/github/src/truth-check-run.ts` · ADR-003 · `ATLAS-TRUTH-10.md` item 1.6
