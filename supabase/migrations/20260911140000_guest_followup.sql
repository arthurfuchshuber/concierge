-- ACOMPANHAMENTO DO CASO ABERTO (pedido explícito, 11/09/2026).
--
-- A IA passa a voltar sozinha na conversa para saber se o que ficou pendente
-- resolveu ("o técnico chegou?", "conseguiu entrar?"). Esta coluna é o ritmo:
-- no máximo UM acompanhamento por dia e por conversa — sem ela, um caso que
-- demora três dias vira três dias de "e aí?".
alter table public.property_chat_conversations
  add column if not exists last_guest_followup_at timestamptz;

comment on column public.property_chat_conversations.last_guest_followup_at is
  'Última vez que a IA voltou sozinha para acompanhar um caso aberto com o hóspede. Segura o ritmo: no máximo um acompanhamento por dia.';
