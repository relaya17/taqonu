import { PersonalSupervisingAgentRepository } from "@atlas/database";
import { createInProcessPersonalSupervisingAgentStore } from "../../../../packages/database/src/repositories/personal-supervising-agents.in-process.js";
import {
  configurePersonalSupervisingAgentStore,
  restoreDefaultPsaObservationSourceForTests,
} from "./personal-supervising-agent.js";

export { createInProcessPersonalSupervisingAgentStore };

/**
 * Test-only installer for an isolated durable in-process PSA backend.
 * Production never imports or constructs this client.
 */
export function resetPersonalSupervisingAgentForTests(): void {
  configurePersonalSupervisingAgentStore(
    new PersonalSupervisingAgentRepository(createInProcessPersonalSupervisingAgentStore()),
  );
  restoreDefaultPsaObservationSourceForTests();
}
