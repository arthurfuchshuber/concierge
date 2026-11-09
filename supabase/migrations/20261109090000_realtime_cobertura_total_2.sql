-- COBERTURA TOTAL DO TEMPO REAL, 2ª PARTE (09/11/2026)
-- Pedido: "ABSOLUTAMENTE TODOS os dados precisam ter instantaneidade" (filtros são locais de cada tela).
-- Publica em `supabase_realtime` as tabelas de uso humano que ainda faltavam (continuação de
-- 20261017120000_realtime_cobertura_total.sql). Mesmas regras de segurança:
--  · só entra tabela que EXISTE e tem RLS LIGADA (o Realtime só entrega as linhas que a política permite);
--  · ficam de fora, de propósito: tabelas com segredo/credencial em coluna (host_whatsapp_config,
--    ai_channel_connections, host_integration_credentials,
--    push_subscriptions, guest_push_subscriptions), filas/logs técnicos (channex_*_outbox/logs/raw,
--    fila_webhooks_channex, email_*, ops_push_log, public_rate_hits, audit_logs) e backups recs_*;
--  · idempotente: pode rodar de novo sem erro.
DO $$
DECLARE
  t text;
  alvo text[] := ARRAY[
    'airbnb_accounts',
    'assistant_threads',
    'assistant_messages',
    'channex_twin_links',
    'channex_account_settings',
    'full_connect_conductors',
    'guest_ai_ops_actions',
    'guest_ai_learning_entries',
    'host_faqs',
    'service_situations',
    'profiles',
    'subscriptions',
    'user_roles',
    'property_playbook_entries',
    'ai_property_playbooks',
    'property_rec_exclusions',
    'ai_conversations',
    'ai_conversation_channels',
    'ai_conversation_summaries',
    'ai_messages',
    'ai_knowledge_gaps',
    'ai_precedents',
    'ai_memories',
    'ai_host_corrections',
    'ai_proactive_actions',
    'ai_guest_memory',
    'permission_nodes',
    'poi_categories',
    'poi_tags',
    'sigma_city_faqs',
    'sigma_city_marketplace',
    'sigma_city_packs',
    'sigma_city_recommendations',
    'city_daily_news'
  ];
BEGIN
  FOREACH t IN ARRAY alvo LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r' AND c.relrowsecurity
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Sugestões do copiloto: publicadas COM LISTA DE COLUNAS, sem `send_token` (chave de envio nunca viaja no
-- evento). PostgreSQL 15+ (o projeto roda 17). A chave primária `id` está na lista (exigida em UPDATE/DELETE).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'guest_ai_copilot_suggestions' AND c.relkind = 'r' AND c.relrowsecurity
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'guest_ai_copilot_suggestions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_ai_copilot_suggestions (
      id, tenant_id, property_id, conversation_id, trigger_message_id, surface, state, suggested_text, edited_text,
      internal_question, intents, strategy, handoff_needed, handoff_urgency, outcome_kind, outcome_code, warnings,
      context_stay_phase, context_reservation_linked, context_history_messages, context_dossier_entries,
      context_credential_policy, context_sender_identity, context_human_in_command, model_id, gateway_cost_usd,
      gateway_latency_ms, gateway_error, generation_attempts, generation_started_at, generation_finished_at,
      edited_at, edited_by, discarded_at, discarded_by, send_claimed_at, send_claimed_by, send_attempts, sent_at,
      sent_by, sent_message_id, sent_channel, sent_provider_message_id, send_error, created_at, updated_at, expires_at
    );
  END IF;
END $$;
