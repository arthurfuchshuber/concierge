-- ============================================================================
-- Assistente do Painel (pedido explícito, 07/09/2026)
--
-- IA interna que responde sobre o próprio sistema, consulta os dados da conta
-- e executa ações. Duas coisas novas aqui:
--
--   1. `ai_system_docs` — a base de conhecimento SOBRE O SISTEMA. Deliberadamente
--      separada de `ai_kb_chunks`: aquela é por conta (`owner_id not null`) e
--      alimenta o agente do hóspede; esta é global e igual para todo mundo.
--      Misturar as duas na mesma tabela abriria caminho pra doc interna vazar
--      numa resposta ao hóspede — o filtro por owner é justamente o que impede.
--
--   2. `assistant_threads` / `assistant_messages` — o histórico de conversa de
--      cada usuário com o assistente. Privado: ninguém lê a conversa de ninguém,
--      nem o dono da conta.
--
-- Idempotente: pode rodar novamente sem efeito colateral.
-- ============================================================================

create extension if not exists vector;

-- ============ Conhecimento sobre o sistema (global) ============
create table if not exists public.ai_system_docs (
  id uuid primary key default gen_random_uuid(),
  -- Chave estável do trecho (ex.: "route:/admin/dashboard/kanban" ou
  -- "rule:defaultShowInCleaning"). É por ela que a reindexação sabe o que
  -- atualizar em vez de duplicar.
  doc_key text not null unique,
  -- "route" = o que a tela faz | "rule" = regra de negócio e seu porquê
  -- | "guide" = passo a passo escrito à mão.
  kind text not null default 'route',
  title text not null,
  content text not null,
  -- Caminho do arquivo de onde saiu, pra rastrear a origem de uma resposta.
  source_path text,
  -- Só usuários com estes papéis recebem este trecho. Vazio = todo mundo.
  -- Evita explicar a tela de faturamento pra quem só enxerga limpeza.
  audience text[] not null default '{}'::text[],
  embedding vector(3072),
  content_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.ai_system_docs
  add column if not exists tsv tsvector
  generated always as (to_tsvector('portuguese', coalesce(title,'') || ' ' || coalesce(content,''))) stored;

create index if not exists ai_system_docs_kind_idx on public.ai_system_docs(kind);
create index if not exists ai_system_docs_tsv_idx on public.ai_system_docs using gin(tsv);
create index if not exists ai_system_docs_embedding_idx
  on public.ai_system_docs using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

grant select on public.ai_system_docs to authenticated;
grant all on public.ai_system_docs to service_role;
alter table public.ai_system_docs enable row level security;

-- Conhecimento do produto é igual para todos os usuários logados: leitura
-- liberada, escrita só pelo processo de indexação (service_role).
drop policy if exists "system docs read" on public.ai_system_docs;
create policy "system docs read" on public.ai_system_docs
  for select to authenticated using (true);

-- ============ Busca híbrida sobre o conhecimento do sistema ============
create or replace function public.match_ai_system_docs(
  query_embedding vector(3072),
  match_count int default 8
)
returns table (
  id uuid,
  doc_key text,
  kind text,
  title text,
  content text,
  source_path text,
  audience text[],
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.doc_key, d.kind, d.title, d.content, d.source_path, d.audience,
         1 - (d.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) as similarity
  from public.ai_system_docs d
  where d.embedding is not null
  order by d.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  limit match_count;
$$;

revoke all on function public.match_ai_system_docs(vector, int) from public, anon, authenticated;
grant execute on function public.match_ai_system_docs(vector, int) to service_role;

create or replace function public.search_ai_system_docs_text(
  _query text,
  match_count int default 8
)
returns table (
  id uuid,
  doc_key text,
  kind text,
  title text,
  content text,
  source_path text,
  audience text[],
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.doc_key, d.kind, d.title, d.content, d.source_path, d.audience,
         ts_rank(d.tsv, websearch_to_tsquery('portuguese', _query)) as rank
  from public.ai_system_docs d
  where d.tsv @@ websearch_to_tsquery('portuguese', _query)
  order by rank desc
  limit match_count;
$$;

revoke all on function public.search_ai_system_docs_text(text, int) from public, anon, authenticated;
grant execute on function public.search_ai_system_docs_text(text, int) to service_role;

-- ============ Conversas do assistente ============
create table if not exists public.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_threads_user_idx
  on public.assistant_threads(user_id, updated_at desc);

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.assistant_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  -- Fontes citadas, ferramentas acionadas e a ação executada (quando houve).
  -- Guardar isso é o que permite auditar depois "quem mandou o sistema fazer".
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assistant_messages_thread_idx
  on public.assistant_messages(thread_id, created_at);

grant select, insert, update, delete on public.assistant_threads to authenticated;
grant select, insert on public.assistant_messages to authenticated;
grant all on public.assistant_threads to service_role;
grant all on public.assistant_messages to service_role;

alter table public.assistant_threads enable row level security;
alter table public.assistant_messages enable row level security;

-- A conversa é de quem conversou. Sem exceção de dono de conta: o assistente
-- é uma ferramenta de trabalho pessoal, não um canal supervisionado.
drop policy if exists "assistant threads own" on public.assistant_threads;
create policy "assistant threads own" on public.assistant_threads
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "assistant messages own" on public.assistant_messages;
create policy "assistant messages own" on public.assistant_messages
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
