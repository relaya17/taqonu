/**
 * Vercel Fastify entrypoint (preferred over src/*).
 *
 * Must stay plain JS with only static imports so @vercel/nft does not
 * expand into the monorepo (apps/web) and skip the broken per-file TS pass
 * on API/web sources. Turbo build must produce dist/server.js first.
 */
import "fastify";
import "./dist/server.js";
