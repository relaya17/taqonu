import { ApplicationGovernanceRepository } from "@atlas/database";
import {
  createApplicationGovernanceMemory,
  createInProcessApplicationGovernanceClient,
  type ApplicationGovernanceMemory,
} from "../../../../packages/database/src/repositories/application-governance.in-process.js";
import { configureApplicationGovernanceStore } from "./application-governance-store.js";

export {
  createApplicationGovernanceMemory,
  createInProcessApplicationGovernanceClient,
};

/**
 * Test-only installer for a shared in-process application-governance backend.
 * Production services never import this client.
 */
export function installApplicationGovernanceStoreForTests(
  memory: ApplicationGovernanceMemory = createApplicationGovernanceMemory(),
): {
  readonly repository: ApplicationGovernanceRepository;
  readonly memory: ApplicationGovernanceMemory;
} {
  const repository = new ApplicationGovernanceRepository(
    createInProcessApplicationGovernanceClient(memory),
  );
  configureApplicationGovernanceStore(repository);
  return { repository, memory };
}
