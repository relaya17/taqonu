# Legal · Media & Communications specialist

**Status:** MVP  
**Hard rule:** Atlas is **not a lawyer** and does **not** give legal advice.

## Purpose

Engineering **counsel briefing pack** for a high-tech lawyer doing software due diligence — not a law-firm product and not legal advice.

- Indicate `READY_FOR_COUNSEL` · `NEEDS_FIXES` · `INSUFFICIENT_EVIDENCE`
- List engineering fixes (privacy, license, secrets, auth, UGC) before briefing a licensed attorney
- Downloadable Markdown brief (`briefMarkdown`)
- Cite only allow-listed **government / university / official** sources (IL + EU + US + intl)
- IL includes Justice, Privacy Protection Authority, Communications, Judicial Authority, INCD
- EU includes GDPR, AI Act, DSA, EDPB, EDPS (EUR-Lex / europa.eu)
- US includes FTC, FCC, DOJ, Copyright Office, California CPPA

## Surfaces

| Surface | Path |
| --- | --- |
| UI | `/[locale]/legal-media` |
| Expert lane | `LEGAL_MEDIA` in Expert Council |
| Fabric agent | `LEGAL_MEDIA_COMMS` |
| API | `GET /api/v1/legal-media/sources` · `POST /api/v1/legal-media/review` |

## Source policy

See `packages/shared/src/constants/legal-media-sources.ts`. Do not add blogs, aggregators, or unofficial “legal tip” sites.
