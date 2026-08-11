# BYO Source · Atlas Evidence (storage model)

**Status:** Product rule — Commercial Validation v1.

## Rule

Customer repositories are **bring-your-own**. Lab names (BrokerOS, …) are demos only.

```
Local disk / GitHub / GitLab / other remote
                 ↓
          Atlas Import
                 ↓
     Evidence Graph + Verdict
                 ↓
   Optional freemium cloud slots
   (project metadata / evidence — NOT full source)
```

| Who stores | What |
| --- | --- |
| Customer / Git host | Source code, CI, deploy artifacts |
| Atlas (free slots) | Evidence graph, verdicts, audit, optional project metadata |
| Atlas Pro | Higher evidence / eval / cloud-slot quotas |

Customers pay **GitHub/cloud/CI** to those vendors. They pay **Atlas** for truth/governance usage — not for hosting their monorepo.

## APIs

- `GET /api/v1/onboarding/storage-policy`
- `POST /api/v1/onboarding/import` — `source: local | github | remote`
- Legacy: `POST /api/v1/onboarding/connect-repo` (local only)

## UI

`/he/partners` — three import tabs + optional “sync evidence to Atlas cloud”.
