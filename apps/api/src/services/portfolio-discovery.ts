import type { Project } from "@atlas/shared";
import { projectSchema } from "@atlas/shared";
import {
  githubDiscoverSchema,
  slugFromFullName,
  buildObservationFromSyncPayload,
} from "@atlas/integrations-github";
import { osStore } from "../store/os-store.js";
import {
  ingestGitHubSync,
  runStateReconciliation,
} from "./state-reconciliation.js";

export function discoverGitHubPortfolio(raw: unknown): {
  projects: Project[];
  created: number;
  updated: number;
} {
  const body = githubDiscoverSchema.parse(raw);
  let created = 0;
  let updated = 0;
  const projects: Project[] = [];

  for (const repo of body.repositories) {
    const slug = slugFromFullName(repo.fullName);
    const existing = osStore.getProjectBySlug(slug);
    const now = new Date().toISOString();
    const name = repo.name ?? (repo.fullName.split("/").pop() ?? slug);

    const project = projectSchema.parse({
      id: existing?.id ?? crypto.randomUUID(),
      slug,
      name,
      description: repo.description ?? existing?.description ?? null,
      status: "ACTIVE",
      techStack: repo.techStack ?? existing?.techStack ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }
    osStore.upsertProject(project);
    projects.push(project);

    const observation = buildObservationFromSyncPayload({
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      private: repo.private,
      htmlUrl: repo.htmlUrl,
    });
    ingestGitHubSync(project.id, {
      fullName: observation.fullName,
      defaultBranch: observation.defaultBranch,
      private: observation.private,
      htmlUrl: observation.htmlUrl,
      headSha: observation.headSha,
      openPrCount: observation.openPrCount,
      openIssueCount: observation.openIssueCount,
      dependencyManifests: [...observation.dependencyManifests],
      hasCiConfig: observation.hasCiConfig,
      architectureDocPaths: [...observation.architectureDocPaths],
      hasTestDirectory: observation.hasTestDirectory,
      recentCiStatus: observation.recentCiStatus,
      hasDependabot: observation.hasDependabot,
      hasCodeowners: observation.hasCodeowners,
      observedAt: observation.observedAt,
    });

    if (body.reconcile) {
      runStateReconciliation(project.id);
    }
  }

  osStore.recordEvent({
    type: "github.discover.completed",
    created,
    updated,
    count: projects.length,
    installationId: body.installationId ?? null,
    occurredAt: new Date().toISOString(),
  });

  return { projects, created, updated };
}
