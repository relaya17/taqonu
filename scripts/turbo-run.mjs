#!/usr/bin/env node
// Windows + pnpm workaround.
// Verified against Turbo 2.10.9's actual bin/turbo source: shouldOwnWindowsCtrlC()
// checks npm_command, npm_lifecycle_event, AND npm_config_user_agent (all three).
//
// On this Windows environment, `pnpm run <script>` / `pnpm exec` inject
// `npm_command` and `npm_config_user_agent` into the child process env.
// Turbo 2.10.9 detects those and takes its Windows Ctrl+C ownership/forwarding
// code path (it sets `__TURBO_WINDOWS_CTRL_C_FD` and launches the native
// turbo.exe with an extra stdio pipe for signal forwarding). On this machine
// that path crashes immediately after the version banner
// (STATUS_STACK_BUFFER_OVERRUN, exit 3221226505) before any task runs.
//
// Running the exact same `node node_modules/turbo/bin/turbo run <args>`
// directly from an interactive shell (no npm_command / npm_config_user_agent
// set) does not hit this path and completes normally (verified: 30/30 tasks
// successful). This wrapper reproduces that working invocation from inside
// a pnpm script by stripping the two variables before spawning Turbo, so
// `pnpm build` / `pnpm lint` / `pnpm test` / `pnpm dev` (via
// scripts/dev-surfaces.mjs) behave the same as the verified direct call.
// `--ui=stream` is what makes this path lethal: turbo.json defaults to TUI,
// and shouldOwnWindowsCtrlC() returns false for `--ui=tui`. Dev previously
// spawned `pnpm exec turbo ... --ui=stream` and crashed every time.
//
// Safe to remove once upstream Turbo fixes/guards this Windows code path.
import { spawnSync } from "node:child_process";

const env = { ...process.env };
delete env.npm_command;
delete env.npm_config_user_agent;
delete env.npm_lifecycle_event;

const args = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  ["node_modules/turbo/bin/turbo", ...args],
  { stdio: "inherit", env },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
