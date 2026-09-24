EMPTY BY OBSERVATION — NOT BY OMISSION

Run: RUN-2026-09-24-PROD-01

This directory holds production audit records retrieved during the run.
It is empty because no production audit record could be retrieved.

Cause:
  - GET https://taqonu-control-plane.vercel.app/api/v1/audit        -> 401
  - GET https://taqonu-control-plane.vercel.app/api/v1/audit/count  -> 401
  - GET https://taqonu-control-plane.vercel.app/api/v1/audit/verify -> 401
    (no production ATLAS_CONTROL_PLANE_TOKEN held by this operator)
  - No production action was executed that could have produced an audit record,
    because every route on https://taqonu-api.vercel.app returns 503.

The local repository audit chain (.atlas/audit/audit.ndjson) was NOT read into
this directory and was NOT modified. Local audit data is not production evidence
and was deliberately not substituted for it.

See: 02-observations/control-plane-readonly-probes.txt
     05-results/R-008.md, R-009.md
