-- Livro-caixa de custo da IA (31/10/2026): uma linha por chamada paga ao gateway. Só registro; sem limites.
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
-- Sem políticas: gravação só pelo servidor (service_role). A leitura por tela virá depois, com regras próprias.
