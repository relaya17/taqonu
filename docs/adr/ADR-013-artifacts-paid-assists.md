# ADR-013: Artifact feeds + paid AI assists (draft)

## Status

PROPOSED

## Context

ArletOS lacks multimodal input. Expert/QA reviews stay INFERRED without
screenshots or documents. Users want to feed images/docs to helpful external
AIs, with those assists billed.

## Decision

### 1. Artifacts → Evidence (free core path)

```
Upload → MIME/size/secret gate → store blob
      → EvidenceRecord
           FACT: hash, uri, mime, bytes
           INFERRED: optional local caption (echo/Ollama) — never silent FACT
```

Artifacts exist **before** paid AI. Experts (UI/UX, Visual Design, QA) consume
`evidenceIds`.

### 2. Paid Assists (metered)

```
AssistRun {
  expertId, provider, model, artifactIds, projectId
  status, findings[], usage { tokens, credits, usd }
}
```

- Providers: OpenAI / Anthropic / Gemini / … (admin-enabled)
- Output epistemic: INFERRED | PROPOSED only
- WRITE tools remain blocked until eval write-gate + human APPROVE
- Billing: credit packs / Stripe; free OS core stays usable offline

### 3. Non-goals

- Do not become a general ChatGPT home
- Do not auto-FACT AI captions
- Do not require paid AI for local checklist reviews

## API sketch

- `POST /api/v1/artifacts`
- `POST /api/v1/assists/runs`
- `GET /api/v1/billing/usage`

## Consequences

Extends freemium (ADR-011) and experts (ADR-010). Requires AuthZ on uploads
(ADR-012 hardening) before public exposure.
