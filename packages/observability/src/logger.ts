import { redactLogValue, redactSecrets } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  readonly [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | readonly (string | number | boolean | null)[];
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function sanitizeFields(fields?: LogFields): LogFields | undefined {
  if (!fields) return undefined;
  const out: Record<string, LogFields[string]> = {};
  for (const [key, value] of Object.entries(fields)) {
    const redacted = redactLogValue(value);
    out[key] = redacted as LogFields[string];
  }
  return out;
}

export function createLogger(options: {
  service: string;
  level?: LogLevel;
  base?: LogFields;
}): Logger {
  const minLevel = options.level ?? "info";
  const base = { service: options.service, ...options.base };

  const write = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
      return;
    }
    const safeFields = sanitizeFields(fields);
    const entry = {
      level,
      message: redactSecrets(message),
      timestamp: new Date().toISOString(),
      ...sanitizeFields(base),
      ...safeFields,
    };
    const line = JSON.stringify(entry);
    if (level === "error") {
      console.error(line);
      return;
    }
    if (level === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    child: (fields) =>
      createLogger({
        service: options.service,
        level: minLevel,
        base: { ...base, ...fields },
      }),
  };
}
