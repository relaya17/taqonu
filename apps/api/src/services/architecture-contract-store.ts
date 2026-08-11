import type { ArchitectureContract } from "@atlas/shared";
import { architectureContractSchema } from "@atlas/shared";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defaultArchitectureContract } from "@atlas/code-intelligence";

function contractPath(projectId: string | null): string {
  const key = projectId ?? "default";
  let dir = process.cwd();
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return resolve(dir, ".atlas", "contracts", `${key}.json`);
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return resolve(process.cwd(), ".atlas", "contracts", `${key}.json`);
    }
    dir = parent;
  }
}

export function loadArchitectureContract(
  projectId: string | null,
): ArchitectureContract {
  const path = contractPath(projectId);
  if (!existsSync(path)) {
    return defaultArchitectureContract(projectId);
  }
  try {
    return architectureContractSchema.parse(
      JSON.parse(readFileSync(path, "utf8")),
    );
  } catch {
    return defaultArchitectureContract(projectId);
  }
}

export function saveArchitectureContract(
  contract: ArchitectureContract,
): ArchitectureContract {
  const parsed = architectureContractSchema.parse({
    ...contract,
    createdAt: contract.createdAt || new Date().toISOString(),
  });
  const path = contractPath(parsed.projectId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(parsed, null, 2), "utf8");
  return parsed;
}
