/**
 * One Atlas product, four surfaces on separate origins (ADR-021 amended).
 * Do not merge these into a single port or a single Vercel project.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const web = "http://localhost:3000";
const sentinel = "http://127.0.0.1:3100";
const admin = "http://127.0.0.1:3200";
const api = "http://localhost:4000";

console.log(`
Atlas surfaces (keep these origins separate)
  Atlas product / Studio .... ${web}
  Atlas Control ............. ${sentinel}
  Atlas Admin ............... ${admin}
  Tenant API (not a UI) ..... ${api}
`);

// Do not `pnpm exec turbo` here. Turbo 2.10.9 on Windows takes a native
// Ctrl+C pipe (`shouldOwnWindowsCtrlC`) when npm_* env is set AND `--ui`
// is not `tui`. That path aborts turbo.exe with STATUS_STACK_BUFFER_OVERRUN
// (exit 3221226505) immediately after the version banner — the same crash
// `scripts/turbo-run.mjs` already documents and strips for build/lint/test.
const turbo = spawn(
  process.execPath,
  [
    join(root, "scripts", "turbo-run.mjs"),
    "run",
    "dev",
    "--filter=@atlas/web",
    "--filter=@atlas/api",
    "--filter=@atlas/admin",
    "--filter=@atlas/control-plane",
    "--filter=@atlas/worker",
    "--parallel",
    "--ui=stream",
  ],
  {
    cwd: root,
    stdio: "inherit",
  },
);

turbo.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
