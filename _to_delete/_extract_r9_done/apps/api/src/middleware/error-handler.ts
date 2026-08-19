import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { AtlasError } from "@atlas/shared";
import { defaultErrorAggregator } from "@atlas/observability";
import { ZodError } from "zod";

/**
 * Best-effort error code for aggregation purposes only (does not affect the
 * HTTP response). Falls back to whatever `code` a Fastify/plugin error
 * carries (e.g. `FST_ERR_...`, `@fastify/rate-limit`'s thrown error), then
 * to a generic bucket.
 */
function resolveAggregationCode(error: FastifyError | Error): string {
  if (error instanceof AtlasError) return error.code;
  if (error instanceof ZodError) return "VALIDATION_ERROR";
  if ("code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as FastifyError).code;
  }
  return "INTERNAL_ERROR";
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Record every handled error for aggregation/observability before
  // responding, regardless of which branch below ultimately handles it.
  defaultErrorAggregator.record(resolveAggregationCode(error), error.message, {
    requestId: request.id,
  });

  if (error instanceof AtlasError) {
    void reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    void reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: { issues: error.issues },
      },
    });
    return;
  }

  const statusCode =
    "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;

  void reply.status(statusCode).send({
    error: {
      code: "INTERNAL_ERROR",
      message:
        statusCode === 500 ? "Internal server error" : error.message,
      details: null,
    },
  });
}
