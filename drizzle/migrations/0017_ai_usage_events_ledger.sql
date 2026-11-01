-- Migração 2: livro-caixa de custo da IA (uma linha por chamada paga ao gateway)
create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  task text not null,
  model text not null,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd numeric(12,6) not null default 0,
  owner_id uuid,
  property_id uuid,
  conversation_id uuid,
  surface text
);
grant all on public.ai_usage_events to service_role;
create index if not exists ai_usage_events_created_idx on public.ai_usage_events (created_at desc);
create index if not exists ai_usage_events_property_idx on public.ai_usage_events (property_id, created_at desc);
create index if not exists ai_usage_events_owner_idx on public.ai_usage_events (owner_id, created_at desc);
alter table public.ai_usage_events enable row level security;
<<<<<<< HEAD
-- Sem políticas: gravação e leitura só pelo servidor (service_role).
=======
-- Sem políticas: gravação e leitura só pelo servidor (service_role).
>>>>>>> 9508e6622f378186a98b7d37962b0279eeb12a31
