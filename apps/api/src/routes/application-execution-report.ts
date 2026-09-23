import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { APPLICATION_EXECUTION_REPORT_PATH } from "@atlas/shared";
import { evaluateApplicationExecutionReport } from "../services/application-execution-report.js";

type RawBodyRequest = FastifyRequest & { rawBody?: string };

export async function registerApplicationExecutionReportRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    APPLICATION_EXECUTION_REPORT_PATH,
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
      const result = await evaluateApplicationExecutionReport({
        rawBody,
        headers: request.headers,
      });
      return reply.status(result.status).send(result.body);
    },
  );
}
