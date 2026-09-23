import type { FastifyInstance } from "fastify";
import { APPLICATION_LEARNING_PROPOSAL_PATH, AtlasError } from "@atlas/shared";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth-guards.js";
import {
  createApplicationLearningProposal,
  decideApplicationLearningProposal,
  getApplicationLearningProposal,
} from "../services/application-learning-proposal.js";

export async function registerApplicationLearningProposalRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(APPLICATION_LEARNING_PROPOSAL_PATH, async (request, reply) => {
    await requireAdmin(app, request);
    const result = createApplicationLearningProposal({
      rawBody: request.body,
    });
    return reply.status(result.status).send(result.body);
  });

  app.get(`${APPLICATION_LEARNING_PROPOSAL_PATH}/:id`, async (request) => {
    await requireAdmin(app, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const item = getApplicationLearningProposal(id);
    if (!item) {
      throw new AtlasError(
        "NOT_FOUND",
        `Learning proposal ${id} was not found`,
        { statusCode: 404 },
      );
    }
    return item;
  });

  app.post(
    `${APPLICATION_LEARNING_PROPOSAL_PATH}/:id/decide`,
    async (request, reply) => {
      const user = await requireAdmin(app, request);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const result = decideApplicationLearningProposal({
        proposalId: id,
        rawBody: request.body,
        decidedBy: user.id,
      });
      return reply.status(result.status).send(result.body);
    },
  );
}
