import type { FastifyInstance, FastifyRequest } from "fastify";
import { resolveOwnerId } from "./plan-quota.js";
import { resolveRequestIdentityAsync } from "./resolve-identity.js";

export interface CloudIdentity {
  readonly ownerId: string;
  readonly userAccessToken: string | null;
  readonly setCookie: string | null;
  /** Where identity was resolved from when authenticated. */
  readonly source: "supabase_auth" | "local_session" | null;
}

/**
 * Cloud identity for the current request: when Supabase is live, prefer the
 * Auth JWT subject (+ access token) so cloud writes are tagged per-tenant and
 * RLS-constrained (`auth.uid() = owner_id`). Local session is offline/dev
 * fallback. Unauthenticated / system work falls back to stub owner +
 * service-role client.
 */
export async function resolveCloudIdentity(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<CloudIdentity> {
  const { identity, setCookie, accessToken } = await resolveRequestIdentityAsync(
    app,
    request,
  );

  return {
    ownerId: resolveOwnerId(app.atlasEnv, identity?.user.id ?? null),
    userAccessToken: accessToken,
    setCookie,
    source: identity?.source ?? null,
  };
}
