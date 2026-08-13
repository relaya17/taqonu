# BYO Customer Cloud · Atlas Usage (storage model v2)

**Status:** Product rule — Storage Policy `2.0.0` · Platform `0.1.0`.

## Rule

Customers own the cloud that holds their data. Atlas does **not** subsidize free hosted storage.

```
Customer Cloudflare (free tier) / AWS / Azure / GCP / local disk / Git
                         ↓
                   Atlas connect (BYO)
                         ↓
         Evidence Graph refs + Verdict + Usage metering
                         ↓
   Free: limited Atlas *usage* · Pro: higher usage + optional evidence mirror
```

| Who stores | What |
| --- | --- |
| Customer Cloudflare (preferred) | Project data, Workers/R2/D1/KV/Pages — **their free tier** |
| Customer Git host | Source code |
| Atlas | Governance events, evidence *references*, verdicts |
| Atlas Pro (optional) | Evidence metadata mirror slots (not full blobs) |

Customers pay Cloudflare/GitHub/etc. They pay **Atlas** for truth/governance **usage** (audits, eval, agent), not for hosting.

## Free vs Pro

| | Free | Pro |
| --- | --- | --- |
| Customer cloud | Cloudflare free (theirs) | Same BYO model |
| Atlas evidence mirror slots | **0** | up to 100 |
| Usage axes | Lower daily ceilings | Higher ceilings |

Axes (see `PLAN_AXIS_LIMITS`): evidence · eval/day · process audits/day · agent messages/day · integrations · retention.

## APIs

- `GET /api/v1/platform` — version sync
- `GET /api/v1/onboarding/storage-policy` — policy v2 payload
- `GET /api/v1/byo-cloud/status`
- `POST /api/v1/byo-cloud/cloudflare/connect`
- `POST /api/v1/byo-cloud/cloudflare/disconnect`
- `GET /api/v1/billing/plan` · `GET /api/v1/billing/usage`

## UI

- `/he/plan` — Cloudflare BYO connect + usage quotas + Stripe
- `/he/welcome` — marketing story
- `/he/partners` — import + storage policy

## Security

- API tokens accepted on connect for future encrypted vault; **never** returned in responses or written plaintext to `store.json` in v1 (only `tokenConfigured` flag).
- Prefer account label + account id metadata until vault lands.
