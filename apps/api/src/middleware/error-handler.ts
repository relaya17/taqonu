import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { AtlasError } from "@atlas/shared";
import { ZodError } from "zod";

export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
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
