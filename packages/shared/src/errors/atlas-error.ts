export type AtlasErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "QUOTA_EXCEEDED"
  | "APPROVAL_REQUIRED"
  | "SECRET_DETECTED"
  | "POLICY_VIOLATION"
  | "INTEGRATION_ERROR"
  | "WEBHOOK_INVALID"
  | "CONFIG_ERROR"
  | "INTERNAL_ERROR";

export class AtlasError extends Error {
  readonly code: AtlasErrorCode;
  readonly statusCode: number;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: AtlasErrorCode,
    message: string,
    options?: {
      statusCode?: number;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AtlasError";
    this.code = code;
    this.statusCode = options?.statusCode ?? defaultStatus(code);
    this.details = options?.details !== undefined ? options.details : undefined;
  }
}

function defaultStatus(code: AtlasErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
    case "APPROVAL_REQUIRED":
    case "POLICY_VIOLATION":
    case "SECRET_DETECTED":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "QUOTA_EXCEEDED":
      return 402;
    case "WEBHOOK_INVALID":
      return 401;
    case "CONFIG_ERROR":
    case "INTEGRATION_ERROR":
    case "INTERNAL_ERROR":
    default:
      return 500;
  }
}
