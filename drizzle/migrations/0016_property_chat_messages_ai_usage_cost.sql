-- Migração 1: custo da IA também nas mensagens do chat do Airbnb/Channex
alter table public.property_chat_messages
  add column if not exists ai_tokens_in integer,
  add column if not exists ai_tokens_out integer,
  add column if not exists ai_cost_usd numeric(12,6),
  add column if not exists ai_models jsonb;
