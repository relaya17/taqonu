import type { CreateProject, Project } from "@atlas/shared";
import { projectSchema } from "@atlas/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export class ProjectRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<readonly Project[]> {
    const { data, error } = await this.client
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => mapProject(row));
  }

  async listByOwner(ownerId: string): Promise<readonly Project[]> {
    const { data, error } = await this.client
      .from("projects")
      .select("*")
      .eq("owner_id", ownerId)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => mapProject(row));
  }

  async countByOwner(ownerId: string): Promise<number> {
    const { count, error } = await this.client
      .from("projects")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", ownerId);

    if (error) {
      throw error;
    }

    return count ?? 0;
  }

  async create(input: CreateProject, ownerId: string): Promise<Project> {
    const { data, error } = await this.client
      .from("projects")
      .insert({
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        tech_stack: input.techStack ?? [],
        owner_id: ownerId,
        status: "ACTIVE",
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return mapProject(data);
  }
}

function mapProject(row: Record<string, unknown>): Project {
  return projectSchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    techStack: row.tech_stack ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
