# Legal · Media & Communications specialist

**Status:** MVP  
**Hard rule:** Atlas is **not a lawyer** and does **not** give legal advice.

## Purpose

Simulate a media/communications counsel **prep** pass over an application:

- Indicate `READY_FOR_COUNSEL` · `NEEDS_FIXES` · `INSUFFICIENT_EVIDENCE`
- List engineering fixes before briefing a licensed attorney
- Cite only allow-listed **government / university / official** sources (IL + EU + US + intl)

## Surfaces

| Surface | Path |
| --- | --- |
| UI | `/[locale]/legal-media` |
| Expert lane | `LEGAL_MEDIA` in Expert Council |
| Fabric agent | `LEGAL_MEDIA_COMMS` |
| API | `GET /api/v1/legal-media/sources` · `POST /api/v1/legal-media/review` |

## Source policy

See `packages/shared/src/constants/legal-media-sources.ts`. Do not add blogs, aggregators, or unofficial “legal tip” sites.
