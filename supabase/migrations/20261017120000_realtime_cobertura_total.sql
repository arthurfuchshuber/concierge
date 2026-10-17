-- COBERTURA TOTAL DO TEMPO REAL (17/10/2026)
-- Pedido: "toda e qualquer ação precisa atualizar INSTANTANEAMENTE para todos os
-- usuários". Antes, só as tabelas do Kanban/Dashboard estavam na publicação
-- `supabase_realtime`; as demais telas só atualizavam por polling ou no próximo
-- carregamento. Esta migration publica as tabelas de uso humano que faltavam.
--
-- Regras de segurança:
--  · só entra na publicação tabela que EXISTE e tem RLS LIGADA (o Realtime só
--    entrega ao usuário as linhas que a política dele permite; sem RLS, vazaria);
--  · tabelas com credenciais/segredos (host_integration_credentials, tokens,
--    push_subscriptions, channex_*) ficam de fora de propósito;
--  · idempotente: pode rodar de novo sem erro.
DO $$
DECLARE
  t text;
  alvo text[] := ARRAY[
    'property_details',
    'property_daily_tips',
    'property_listing_raw_data',
    'host_behavior',
    'host_knowledge',
    'ai_human_escalations',
    'chat_message_feedback',
    'ai_alerts',
    'ai_learning_candidates',
    'ai_prompt_change_candidates',
    'ai_tenant_knowledge',
    'account_member_permissions',
    'account_member_invites',
    'permission_assignments',
    'owner_ledger_entries',
    'owner_loose_documents',
    'clicksign_documents',
    'guest_itineraries',
    'reservation_records_trash',
    'stakeholder_link_aliases',
    'provider_categories'
  ];
BEGIN
  FOREACH t IN ARRAY alvo LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r' AND c.relrowsecurity
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
