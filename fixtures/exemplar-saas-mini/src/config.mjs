export function loadConfig(env = process.env) {
  const cookieSecret = env.COOKIE_SECRET?.trim() || "";
  if (cookieSecret.length < 32) {
    throw new Error("COOKIE_SECRET must be at least 32 characters");
  }
  const port = Number(env.PORT?.trim() || "3210");
  return {
    port: Number.isFinite(port) && port > 0 ? port : 3210,
    cookieSecret,
    version: env.APP_VERSION?.trim() || "1.0.0",
  };
}
