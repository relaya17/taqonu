import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { APPLICATION_PREFLIGHT_PATH } from "@atlas/shared";
import { evaluateApplicationPreflight } from "../services/application-preflight.js";

type RawBodyRequest = FastifyRequest & { rawBody?: string };

export async function registerApplicationPreflightRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    APPLICATION_PREFLIGHT_PATH,
    {
      preParsing: async (request, _reply, payload) => {
        const chunks: Buffer[] = [];
        for await (const chunk of payload) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const rawBuf = Buffer.concat(chunks);
        (request as RawBodyRequest).rawBody = rawBuf.toString("utf8");
        return Readable.from(rawBuf);
      },
    },
    async (request, reply) => {
      const rawBody =
        (request as RawBodyRequest).rawBody ??
        (typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body ?? {}));
      const result = await evaluateApplicationPreflight({
        rawBody,
        headers: request.headers,
      });
      return reply.status(result.status).send(result.body);
    },
  );
}
