-- Esquema mínimo para exercitar `copilot_claim_generation` (teto por anúncio e conta). Complementa o ambiente tipo
-- Supabase (que já cria properties, conversas, mensagens e property_listing_raw_data). Não substitui a suíte completa.
alter table public.property_listing_raw_data add column if not exists property_id uuid;
alter table public.property_listing_raw_data add column if not exists airbnb_ai_enabled boolean not null default true;
create table public.guest_ai_copilot_suggestions (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  conversation_id uuid not null, trigger_message_id uuid not null, surface text not null,
  state text not null default 'generating', outcome_kind text, outcome_code text,
  gateway_cost_usd numeric not null default 0, generation_started_at timestamptz not null default now(),
  generation_finished_at timestamptz, generation_attempts int not null default 1,
  updated_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '14 days',
  unique (conversation_id, trigger_message_id));
create function public.guest_ai_copilot_summary(r public.guest_ai_copilot_suggestions) returns jsonb
  language sql as $$ select to_jsonb(r) $$;
