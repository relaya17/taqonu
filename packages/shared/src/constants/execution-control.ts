/**
 * Control Plane SERVICE hop → apps/api live agent-run store.
 *
 * Same bearer boundary as `KILL_SWITCH_CONTROL_PATH`. Control never reads
 * `osStore` directly. Canonical execution rows stay on the tenant API.
 */
export const EXECUTION_CONTROL_PATH = "/api/v1/internal/executions";
