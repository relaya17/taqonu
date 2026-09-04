-- Knowledge retrieve must not return another tenant's project-scoped chunks.
-- Historical Decision: match_knowledge_chunks(vector, text, float, int) had
-- no scope filters and did not return metadata.
-- Superseded By: this function (same name, additional optional filters + metadata).
-- Current Decision: unscoped reference rows remain visible; project-scoped rows
-- fail closed unless owner/tenant/project/application metadata matches.

drop function if exists public.match_knowledge_chunks(vector, text, float, int);

create or replace function public.match_knowledge_chunks(
  query_embedding vector(64),
  query_text text default '',
  match_threshold float default 0.2,
  match_count int default 40,
  filter_owner_id text default null,
  filter_tenant_id text default null,
  filter_project_id text default null,
  filter_application_id text default null
)
returns table (
  id text,
  title text,
  excerpt text,
  source_class text,
  url text,
  source_updated_at timestamptz,
  project_scoped boolean,
  content_hash text,
  embedding vector(64),
  embedding_provider text,
  embedding_dims integer,
  metadata jsonb,
  similarity float,
  keyword_rank float
)
language sql
stable
as $$
  select
    k.id,
    k.title,
    k.excerpt,
    k.source_class,
    k.url,
    k.source_updated_at,
    k.project_scoped,
    k.content_hash,
    k.embedding,
    k.embedding_provider,
    k.embedding_dims,
    k.metadata,
    case
      when k.embedding is null then 0::float
      else greatest(0::float, (1 - (k.embedding <=> query_embedding))::float)
    end as similarity,
    case
      when coalesce(trim(query_text), '') = '' then 0::float
      else ts_rank(
        to_tsvector('simple', coalesce(k.title, '') || ' ' || coalesce(k.excerpt, '')),
        plainto_tsquery('simple', query_text)
      )::float
    end as keyword_rank
  from public.knowledge_chunks k
  where
    (
      k.project_scoped = false
      or (
        coalesce(filter_owner_id, '') <> ''
        and coalesce(k.metadata->>'owner_id', '') = filter_owner_id
        and coalesce(k.metadata->>'tenant_id', '') = filter_tenant_id
        and coalesce(k.metadata->>'project_id', '') = filter_project_id
        and coalesce(k.metadata->>'application_id', '') = filter_application_id
      )
    )
    and (
      (
        k.embedding is not null
        and (1 - (k.embedding <=> query_embedding)) >= match_threshold
      )
      or (
        coalesce(trim(query_text), '') <> ''
        and to_tsvector('simple', coalesce(k.title, '') || ' ' || coalesce(k.excerpt, ''))
          @@ plainto_tsquery('simple', query_text)
      )
    )
  order by
    (case
      when k.embedding is null then 0::float
      else greatest(0::float, (1 - (k.embedding <=> query_embedding))::float)
    end) * 0.7
    + (case
      when coalesce(trim(query_text), '') = '' then 0::float
      else ts_rank(
        to_tsvector('simple', coalesce(k.title, '') || ' ' || coalesce(k.excerpt, '')),
        plainto_tsquery('simple', query_text)
      )::float
    end) * 0.3
    desc
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_knowledge_chunks(vector, text, float, int, text, text, text, text) to authenticated;
grant execute on function public.match_knowledge_chunks(vector, text, float, int, text, text, text, text) to service_role;
