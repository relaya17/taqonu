# Supply chain — SBOM, provenance, signing

Do not treat an unsigned provenance file as a signed release.

## Commands

| Command | What it proves |
| --- | --- |
| `pnpm sbom:generate` | CycloneDX 1.5 SBOM + **unsigned** in-toto/SLSA provenance bound to the SBOM SHA-256 |
| `pnpm supply-chain:verify` | SBOM parseable; provenance digest matches; missing sig is `UNSIGNED`; leftover sig without identity is `INVALID` |
| `pnpm supply-chain:sign` | Refuses placeholder signatures. Real `cosign sign-blob` runs only when `ATLAS_SIGNING_IDENTITY` is set **and** `cosign` is on PATH |

CI runs generate + verify + sign-refusal. Unsigned is expected.
`ATLAS_REQUIRE_SIGNED_RELEASE=1` fails verify/sign while `releaseReady` is false.

## Status classes

| Component | Current enforceable state |
| --- | --- |
| SBOM | VALID when generated |
| Provenance | Unsigned SLSA-shaped statement (`signed: false`) |
| Signing implementation | Fail-closed planner + CLI |
| Signing identity | External (`ATLAS_SIGNING_IDENTITY`) |
| Signature | Absent unless a real cosign ceremony succeeds |
| Verification | `VERIFIED` is never emitted without a deployed Sigstore/cosign verifier |
| Release readiness | `releaseReady: false` until identity + verifier exist |

## Negative cases

- Missing SBOM → not a release
- Invalid CycloneDX → `INVALID`
- Provenance `signed: true` while unsigned builder → rejected
- SBOM digest mismatch → rejected
- Signature file without identity → `INVALID`
- Identity without cosign → refuse, do not mint a blob

Artifacts live under `.atlas/sbom/` (gitignored). Do not commit signatures.
