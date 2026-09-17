import { HttpEmbeddingProvider } from "./http-provider.js";
import {
  getDefaultEmbeddingProvider,
  type EmbeddingProvider,
} from "./provider.js";

/**
 * Embedding configuration. Distinct from chat `OPENAI_API_KEY`: a chat key
 * alone does not enable embeddings (avoids surprise billing). Set the
 * embedding-specific vars below, or `ATLAS_EMBEDDING_PROVIDER=openai` plus
 * `OPENAI_API_KEY`.
 *
 * Env vars:
 * - `ATLAS_EMBEDDING_PROVIDER` — `openai` | `http` | `ollama` | `hash` | `local-hash`
 * - `ATLAS_EMBEDDING_API_KEY` — bearer token (falls back to `OPENAI_API_KEY` for openai)
 * - `ATLAS_EMBEDDING_BASE_URL` — OpenAI-compatible root, including `/v1` if required
 * - `ATLAS_EMBEDDING_MODEL` — default `text-embedding-3-small` (openai) or `nomic-embed-text` (ollama)
 */
export interface EmbeddingEnv {
  readonly ATLAS_EMBEDDING_PROVIDER?: string | undefined;
  readonly ATLAS_EMBEDDING_API_KEY?: string | undefined;
  readonly ATLAS_EMBEDDING_BASE_URL?: string | undefined;
  readonly ATLAS_EMBEDDING_MODEL?: string | undefined;
  readonly OPENAI_API_KEY?: string | undefined;
  readonly OPENAI_BASE_URL?: string | undefined;
  readonly OLLAMA_BASE_URL?: string | undefined;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function withOpenAiV1(baseUrl: string): string {
  const trimmed = trimSlash(baseUrl);
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function httpProvider(input: {
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
}): HttpEmbeddingProvider {
  return new HttpEmbeddingProvider({
    name: input.name,
    baseUrl: input.baseUrl,
    model: input.model,
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
  });
}

/**
 * Resolve the embedding provider from config.
 * No semantic provider configured → lexical-hash fallback (never labeled semantic).
 */
export function resolveEmbeddingProvider(
  env: EmbeddingEnv = {},
): EmbeddingProvider {
  const explicit = (env.ATLAS_EMBEDDING_PROVIDER ?? "").trim().toLowerCase();

  if (
    explicit === "hash" ||
    explicit === "local-hash" ||
    explicit === "lexical-hash"
  ) {
    return getDefaultEmbeddingProvider();
  }

  if (explicit === "openai") {
    const apiKey = env.ATLAS_EMBEDDING_API_KEY ?? env.OPENAI_API_KEY;
    if (!apiKey) {
      return getDefaultEmbeddingProvider();
    }
    return httpProvider({
      name: "openai-embeddings",
      apiKey,
      baseUrl:
        env.ATLAS_EMBEDDING_BASE_URL ??
        env.OPENAI_BASE_URL ??
        "https://api.openai.com/v1",
      model: env.ATLAS_EMBEDDING_MODEL ?? "text-embedding-3-small",
    });
  }

  if (explicit === "http") {
    const baseUrl = env.ATLAS_EMBEDDING_BASE_URL ?? env.OPENAI_BASE_URL;
    if (!baseUrl) {
      return getDefaultEmbeddingProvider();
    }
    const apiKey = env.ATLAS_EMBEDDING_API_KEY ?? env.OPENAI_API_KEY;
    return httpProvider({
      name: "http-embeddings",
      baseUrl,
      model: env.ATLAS_EMBEDDING_MODEL ?? "text-embedding-3-small",
      ...(apiKey ? { apiKey } : {}),
    });
  }

  if (explicit === "ollama") {
    const host =
      env.ATLAS_EMBEDDING_BASE_URL ??
      env.OLLAMA_BASE_URL ??
      "http://127.0.0.1:11434";
    return httpProvider({
      name: "ollama-embeddings",
      baseUrl: withOpenAiV1(host),
      model: env.ATLAS_EMBEDDING_MODEL ?? "nomic-embed-text",
      ...(env.ATLAS_EMBEDDING_API_KEY
        ? { apiKey: env.ATLAS_EMBEDDING_API_KEY }
        : {}),
    });
  }

  // Embedding-specific key/URL without a named provider → HTTP semantic path.
  if (env.ATLAS_EMBEDDING_API_KEY || env.ATLAS_EMBEDDING_BASE_URL) {
    const apiKey = env.ATLAS_EMBEDDING_API_KEY ?? env.OPENAI_API_KEY;
    const baseUrl =
      env.ATLAS_EMBEDDING_BASE_URL ??
      env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1";
    return httpProvider({
      name: "http-embeddings",
      baseUrl,
      model: env.ATLAS_EMBEDDING_MODEL ?? "text-embedding-3-small",
      ...(apiKey ? { apiKey } : {}),
    });
  }

  return getDefaultEmbeddingProvider();
}
