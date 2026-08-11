import { z } from "zod";

export const discoverRepoSchema = z.object({
  fullName: z.string().min(3).max(200),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  defaultBranch: z.string().max(200).nullable().optional(),
  private: z.boolean().optional(),
  htmlUrl: z.string().url().nullable().optional(),
  techStack: z.array(z.string().min(1).max(64)).optional(),
});

export const githubDiscoverSchema = z.object({
  installationId: z.string().min(1).max(64).optional(),
  /** Observed repos from GitHub App / manual portfolio import. */
  repositories: z.array(discoverRepoSchema).min(1).max(500),
  reconcile: z.boolean().default(false),
});

export type GitHubDiscoverInput = z.infer<typeof githubDiscoverSchema>;

export function slugFromFullName(fullName: string): string {
  const repo = fullName.split("/").pop() ?? fullName;
  return repo
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}
