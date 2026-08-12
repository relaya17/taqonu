/**
 * CI eval gate runner — exit 0 green, 1 blocking failure.
 * Pure store + redaction checks (no live secrets required).
 */
import { evaluateCiGateForTests } from "../routes/eval-ci-gate.js";

process.env.ATLAS_SKIP_AUDIT_LOG ??= "1";
process.env.ATLAS_SKIP_METRICS_LOG ??= "1";

const result = evaluateCiGateForTests();
console.log(JSON.stringify(result, null, 2));
process.exit(result.exitCode);
