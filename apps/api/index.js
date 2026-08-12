/**
 * Vercel Fastify entry — static import of the esbuild bundle only.
 * The bundle is built with process.env.VERCEL defined so parent-dir FS
 * walks are eliminated and apps/web never enters the NFT/TS graph.
 */
import "fastify";
import "./dist/vercel-server.js";
