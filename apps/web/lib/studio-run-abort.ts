/**
 * R12 — one AbortController for the in-flight Studio ask-agent / loop fetch.
 * A new start() replaces any previous controller so only one run is live.
 *
 * R12 DoD (Master Plan F31 / §10 R12): the recorded gap is
 * "No AbortController in Studio app" and the plane is "Studio plane only".
 * Cancel stops the Studio client wait/request. Server-side abort of
 * runEngineeringLoop / createProposal is not in this DoD (F32 is patch
 * SoD/rollback, already SATISFIED; F06 in-flight Control abort is
 * INTENTIONAL / NOT A GAP). A second server execution path is not added.
 */

export function createStudioRunAbort(): {
  start: () => AbortSignal;
  cancel: () => boolean;
  isPending: () => boolean;
} {
  let current: AbortController | null = null;
  return {
    start() {
      current?.abort();
      current = new AbortController();
      return current.signal;
    },
    cancel() {
      if (!current || current.signal.aborted) return false;
      current.abort();
      current = null;
      return true;
    },
    isPending() {
      return current != null && !current.signal.aborted;
    },
  };
}
