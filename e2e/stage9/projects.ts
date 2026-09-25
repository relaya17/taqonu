import type { APIRequestContext } from "@playwright/test";
import { stage9ApiBase } from "./local-api";

export interface Stage9Project {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export async function createStage9Project(
  request: APIRequestContext,
  name: string,
): Promise<Stage9Project> {
  const api = stage9ApiBase();
  const slug = `s9-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await request.post(`${api}/api/v1/projects`, {
    data: { slug, name, description: "Stage 9 local test project" },
    headers: { "content-type": "application/json" },
  });
  if (!res.ok()) {
    throw new Error(`Stage 9 create project failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { id?: string; slug?: string; name?: string };
  if (!body.id || !body.slug || !body.name) {
    throw new Error(`Stage 9 create project returned an incomplete body: ${JSON.stringify(body)}`);
  }
  return { id: body.id, slug: body.slug, name: body.name };
}

export function studioProjectUrl(projectId: string, locale = "en"): string {
  return `/${locale}/studio?project=${encodeURIComponent(projectId)}`;
}

export { stage9ApiBase };
