import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
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

export async function linkWorkspaceRoot(
  request: APIRequestContext,
  projectId: string,
  workspaceRoot: string,
): Promise<void> {
  const api = stage9ApiBase();
  const res = await request.put(`${api}/api/v1/projects/${projectId}/workspace-root`, {
    data: { workspaceRoot },
    headers: { "content-type": "application/json" },
  });
  if (!res.ok()) {
    throw new Error(
      `Stage 9 workspace-root failed: ${res.status()} ${await res.text()}`,
    );
  }
}

export async function createMarkerWorkspace(input: {
  readonly fileName: string;
  readonly contents: string;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "atlas-stage9-"));
  await writeFile(join(root, input.fileName), input.contents, "utf8");
  return root;
}

export async function selectStudioProject(page: Page, name: string): Promise<void> {
  const picker = page.getByRole("combobox", { name: /project/i });
  await expect(picker).toBeVisible();
  await picker.click();
  const option = page
    .locator('[role="option"], [role="menuitem"]')
    .filter({ hasText: name });
  await expect(option.first()).toBeVisible({ timeout: 20_000 });
  await option.first().click();
  await expect(picker).toContainText(name);
}

export { stage9ApiBase };
