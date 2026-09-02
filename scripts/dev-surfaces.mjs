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

const turbo = spawn(
  "pnpm",
  [
    "exec",
    "turbo",
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
    shell: true,
    env: process.env,
  },
);

turbo.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
