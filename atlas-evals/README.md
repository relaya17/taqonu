# Atlas Evals — Proof & Autonomy benchmarks

Permanent engineering benchmark suite for **Atlas 1.1**.

## Layout

```
atlas-evals/
├── code-generation/
├── bug-fixing/
├── refactoring/
├── test-generation/
├── security/
├── architecture/
├── qa/
├── evidence/
├── regression/
├── results/          # suite run JSON (gitignored optional)
└── baselines/        # last known-good suite for regression compare
```

Each task JSON:

| Field | Purpose |
| --- | --- |
| Task | Natural-language request |
| Expected behavior | What Atlas should do |
| Repository version | Golden pin (e.g. brokerOS-main) |
| Allowed tools | analyze / patch / experts / … |
| Required evidence | Paths/signals that must appear |
| Expected tests | Test artifacts when applicable |
| Risk level | LOW…CRITICAL |
| Acceptance criteria | Pass/fail checklist |

## Golden Project

**BrokerOS** (`C:\Users\User\Desktop\game\brokerOS-main` by default via `ATLAS_GOLDEN_PROJECT_ROOT`).
If that path is missing, Atlas uses the in-repo fixture `fixtures/golden-brokeros`.

Tasks A–F live under `bug-fixing/`, `qa/`, `test-generation/`, `architecture/`.

## Run

```bash
# One-command golden Proof 1.1 (gates A–F → evidence report)
# Uses ATLAS_GOLDEN_PROJECT_ROOT, else brokerOS-main, else fixtures/golden-brokeros
pnpm proof:run

# API (with `pnpm dev` API on :4000)
POST /api/v1/proof/run
{}
GET  /api/v1/proof/status

# Or suite-only
POST /api/v1/benchmarks/run
{ "workspaceRoot": "<brokerOS or fixture path>" }

# Regression vs previous suite
POST /api/v1/benchmarks/regression
{ "previousSuiteId": "...", "currentSuiteId": "..." }
```

UI: `/he/proof` → **Run Proof 1.1 (gates A–F)**.

### Golden root resolution

1. `workspaceRoot` body / `ATLAS_GOLDEN_PROJECT_ROOT`
2. Sibling `brokerOS-main` (lab path)
3. In-repo `fixtures/golden-brokeros` (always available)

### Gates A–F checklist

| Gate | Task id |
| --- | --- |
| A | `brokeros-A-optimistic-locking` |
| B | `brokeros-B-commission-inconsistency` |
| C | `brokeros-C-commission-regression-tests` |
| D | `brokeros-D-production-blockers` |
| E | `brokeros-E-approved-bugfix` |
| F | `brokeros-F-duplicate-detection-impact` |

Pass requires all gates PASS and **zero unauthorized writes**.

## Success metric (product)

Not “looks smart” — e.g.:

> Atlas solved N/M engineering tasks, with X% test correctness and **zero unauthorized writes**.
