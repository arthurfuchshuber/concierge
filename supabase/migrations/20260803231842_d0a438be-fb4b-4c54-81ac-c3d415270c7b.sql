create extension if not exists vector;

-- ============ Base de conhecimento vetorial (Hybrid RAG) ============
create table if not exists public.ai_kb_chunks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  property_id uuid references public.properties(id) on delete cascade,
  source text not null,
  source_id text,
  title text,
  content text not null,
  confidence numeric not null default 0.9,
  embedding vector(3072),
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_kb_chunks
  add column if not exists tsv tsvector
  generated always as (to_tsvector('portuguese', coalesce(title,'') || ' ' || coalesce(content,''))) stored;

create index if not exists ai_kb_chunks_owner_idx on public.ai_kb_chunks(owner_id);
create index if not exists ai_kb_chunks_prop_idx on public.ai_kb_chunks(property_id);
create index if not exists ai_kb_chunks_src_idx on public.ai_kb_chunks(source, source_id);
create index if not exists ai_kb_chunks_tsv_idx on public.ai_kb_chunks using gin(tsv);
create index if not exists ai_kb_chunks_embedding_idx
  on public.ai_kb_chunks using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

grant select on public.ai_kb_chunks to authenticated;
grant all on public.ai_kb_chunks to service_role;
alter table public.ai_kb_chunks enable row level security;

drop policy if exists "kb owners read" on public.ai_kb_chunks;
create policy "kb owners read" on public.ai_kb_chunks
  for select to authenticated using (owner_id = auth.uid());

-- ============ Logs de observabilidade do agente ============
create table if not exists public.ai_agent_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  property_id uuid,
  conversation_id uuid,
  surface text not null default 'guide_chat',
  intent jsonb,
  context_keys jsonb,
  tools_used jsonb,
  sources jsonb,
  confidence numeric,
  validation jsonb,
  models jsonb,
  tokens jsonb,
  cost_estimate numeric,
  latency_ms integer,
  needs_human boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists ai_agent_logs_owner_idx on public.ai_agent_logs(owner_id, created_at desc);
create index if not exists ai_agent_logs_conv_idx on public.ai_agent_logs(conversation_id, created_at desc);

grant select on public.ai_agent_logs to authenticated;
grant all on public.ai_agent_logs to service_role;
alter table public.ai_agent_logs enable row level security;

drop policy if exists "agent logs owners read" on public.ai_agent_logs;
create policy "agent logs owners read" on public.ai_agent_logs
  for select to authenticated using (owner_id = auth.uid());

-- ============ Memória inteligente por hóspede ============
create table if not exists public.ai_guest_memory (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  property_id uuid references public.properties(id) on delete cascade,
  guest_key text not null,
  guest_name text,
  language text,
  summary text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, guest_key)
);

create index if not exists ai_guest_memory_owner_idx on public.ai_guest_memory(owner_id);

grant select on public.ai_guest_memory to authenticated;
grant all on public.ai_guest_memory to service_role;
alter table public.ai_guest_memory enable row level security;

drop policy if exists "guest memory owners read" on public.ai_guest_memory;
create policy "guest memory owners read" on public.ai_guest_memory
  for select to authenticated using (owner_id = auth.uid());

-- ============ Resumos automáticos de conversa ============
create table if not exists public.ai_conversation_summaries (
  conversation_id uuid primary key,
  owner_id uuid,
  property_id uuid,
  summary text,
  sentiment text,
  risk text,
  language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.ai_conversation_summaries to authenticated;
grant all on public.ai_conversation_summaries to service_role;
alter table public.ai_conversation_summaries enable row level security;

drop policy if exists "conv summaries owners read" on public.ai_conversation_summaries;
create policy "conv summaries owners read" on public.ai_conversation_summaries
  for select to authenticated using (owner_id = auth.uid());

-- ============ Busca híbrida ============
create or replace function public.match_ai_kb_chunks(
  query_embedding vector(3072),
  _owner_id uuid,
  _property_id uuid default null,
  match_count int default 8
)
returns table (
  id uuid,
  source text,
  source_id text,
  title text,
  content text,
  confidence numeric,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.source, c.source_id, c.title, c.content, c.confidence,
         1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) as similarity
  from public.ai_kb_chunks c
  where c.owner_id = _owner_id
    and c.embedding is not null
    and (c.property_id is null or _property_id is null or c.property_id = _property_id)
  order by c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  limit match_count;
$$;

revoke all on function public.match_ai_kb_chunks(vector, uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.match_ai_kb_chunks(vector, uuid, uuid, int) to service_role;

create or replace function public.search_ai_kb_chunks_text(
  _query text,
  _owner_id uuid,
  _property_id uuid default null,
  match_count int default 8
)
returns table (
  id uuid,
  source text,
  source_id text,
  title text,
  content text,
  confidence numeric,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.source, c.source_id, c.title, c.content, c.confidence,
         ts_rank(c.tsv, websearch_to_tsquery('portuguese', _query)) as rank
  from public.ai_kb_chunks c
  where c.owner_id = _owner_id
    and (c.property_id is null or _property_id is null or c.property_id = _property_id)
    and c.tsv @@ websearch_to_tsquery('portuguese', _query)
  order by rank desc
  limit match_count;
$$;

revoke all on function public.search_ai_kb_chunks_text(text, uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.search_ai_kb_chunks_text(text, uuid, uuid, int) to service_role;