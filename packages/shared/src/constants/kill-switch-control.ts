/**
 * Task 7 -- Runtime Kill Switch Control.
 *
 * CP SERVICE bearer -> apps/api's durable kill-switch runtime-override
 * store. Same shape and same existing authorization boundary as
 * `AGENT_RUNTIME_CONTROL_PATH` (`constants/atlas-self.ts`): a Control-Plane-
 * service-authenticated write surface, not a new auth mechanism. The
 * category enum itself is NOT duplicated here -- `packages/agent-core`'s
 * `KILL_SWITCH_CATEGORIES` remains the single source of truth for what a
 * category IS and what it gates; this path's GET response carries the
 * current category list as data, so callers (Control's dashboard) render
 * whatever the server returns rather than needing their own copy of the
 * enum.
 */
export const KILL_SWITCH_CONTROL_PATH = "/api/v1/internal/kill-switches";
