-- Custo por resposta da IA também nas mensagens do chat do Airbnb/Channex (31/10/2026).
-- Só REGISTRO (sem tela e sem nenhum limite de uso): tokens, custo estimado em USD e modelos usados.
alter table public.property_chat_messages
  add column if not exists ai_tokens_in integer,
  add column if not exists ai_tokens_out integer,
  add column if not exists ai_cost_usd numeric(12,6),
  add column if not exists ai_models jsonb;
