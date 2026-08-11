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

Tasks A–F live under `bug-fixing/`, `qa/`, `test-generation/`, `architecture/`.

## Run

```bash
# API
POST /api/v1/benchmarks/run
{ "workspaceRoot": "<brokerOS path>" }

# Regression vs previous suite
POST /api/v1/benchmarks/regression
{ "previousSuiteId": "...", "currentSuiteId": "..." }
```

## Success metric (product)

Not “looks smart” — e.g.:

> Atlas solved N/M engineering tasks, with X% test correctness and **zero unauthorized writes**.
