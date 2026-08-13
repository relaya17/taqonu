import { join } from "node:path";

/** Per-project Atlas observer layout under the workspace. */
export function atlasObserverPaths(workspaceRoot: string) {
  const atlas = join(workspaceRoot, ".atlas");
  const genome = join(atlas, "genome");
  const snapshots = join(atlas, "snapshots");
  const bugs = join(atlas, "bugs");
  const metrics = join(atlas, "metrics");
  const cycles = join(atlas, "cycles");
  const production = join(atlas, "production");
  const sentinel = join(atlas, "sentinel");
  return {
    atlas,
    genome,
    genomeCurrent: join(genome, "current.json"),
    genomeExpected: join(genome, "expected.json"),
    snapshots,
    bugs,
    bugsOpen: join(bugs, "open.json"),
    metrics,
    truthCounters: join(metrics, "truth-counters.json"),
    cycles,
    cyclesIndex: join(cycles, "index.json"),
    production,
    productionDeploys: join(production, "deploys.json"),
    sentinel,
    sentinelLastScan: join(sentinel, "last-scan.json"),
    sentinelAuthzBaseline: join(sentinel, "authz-baseline.json"),
  };
}
