-- Hybrid RAG closed loop — knowledge chunks + pgvector (local-hash dims=64 MVP).
-- Applied via Supabase migrations (mirrored under supabase/migrations/).
-- Service-role API dual-write bypasses RLS; authenticated clients may SELECT.

create extension if not exists "vector";

create table if not exists public.knowledge_chunks (
  id text primary key,
  title text not null,
  excerpt text not null,
  source_class text not null,
  url text,
  source_updated_at timestamptz,
  project_scoped boolean not null default false,
  content_hash text not null,
  embedding vector(64),
  embedding_provider text not null default 'local-hash',
  embedding_dims integer not null default 64,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_hash)
);

create index if not exists knowledge_chunks_embedding_hnsw_idx
  on public.knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

create index if not exists knowledge_chunks_fts_idx
  on public.knowledge_chunks
  using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(excerpt, '')));

alter table public.knowledge_chunks enable row level security;

drop policy if exists "knowledge_chunks_select_authenticated" on public.knowledge_chunks;
create policy "knowledge_chunks_select_authenticated"
  on public.knowledge_chunks for select
  to authenticated
  using (true);

-- Hybrid retrieve: vector cosine + simple keyword; empty set = INSUFFICIENT_EVIDENCE (no invent).
create or replace function public.match_knowledge_chunks(
  query_embedding vector(64),
  query_text text default '',
  match_threshold float default 0.2,
  match_count int default 40
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
      k.embedding is not null
      and (1 - (k.embedding <=> query_embedding)) >= match_threshold
    )
    or (
      coalesce(trim(query_text), '') <> ''
      and to_tsvector('simple', coalesce(k.title, '') || ' ' || coalesce(k.excerpt, ''))
        @@ plainto_tsquery('simple', query_text)
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

grant execute on function public.match_knowledge_chunks(vector, text, float, int) to authenticated;
grant execute on function public.match_knowledge_chunks(vector, text, float, int) to service_role;
