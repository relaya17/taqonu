# Mini SaaS teaching exemplar

Complete small SaaS for **display and learning**. Not a production company product.

## Run

```bash
set COOKIE_SECRET=12345678901234567890123456789012
node src/server.mjs
```

Health: `GET http://localhost:3210/health`

## Test

```bash
node --test src/auth.test.mjs src/payments.test.mjs
```

## Clone map (Atlas)

`atlas-exemplar.json` lists units. Clone **WHOLE** or a unit such as **AUTH** or **PAYMENTS** (PAYMENTS depends on AUTH). Clone proposes a Patch — Approve then Apply.
