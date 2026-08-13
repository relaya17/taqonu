# P2.2 — Benchmarking seed (versions / teams)

**Status:** PARTIAL seed — product counters exist; comparative UI later.

## What we measure today (per workspace)

From `.atlas/metrics/truth-counters.json` + cycle history:

| Metric | Why |
|---|---|
| `analyzed` | Observe cycles run |
| `risks` | HIGH/CRITICAL surfaced with evidence |
| `confirmed` | Verified / human-confirmed findings |
| `caughtBeforeProd` | Findings caught via continuous observe / checks |

## Team / version comparison (v0 recipe)

1. Snapshot counters after each release tag or Friday.  
2. Diff: risks opened vs confirmed vs still open.  
3. Annotate stack majors (Node / Next / React) from Oracle version detector.  
4. Do **not** rank teams publicly without partner consent.

## Next product slice (deferred)

- Portfolio view across projects for one org  
- Normalize by LOC / routes / deploy frequency  
- Export CSV for DP weekly review
