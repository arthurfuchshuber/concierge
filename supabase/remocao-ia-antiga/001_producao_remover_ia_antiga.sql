-- =====================================================================
-- EXCLUSÃO DEFINITIVA DA IMPLEMENTAÇÃO ANTIGA DE IA DE ATENDIMENTO — CONCIERGEIA — PRODUÇÃO
-- Arquivo: supabase/remocao-ia-antiga/001_producao_remover_ia_antiga.sql
-- Data:    01/11/2026
--
-- Por decisão de 01/11/2026 (19h38): exclusão TOTAL, SEM backup e SEM rollback.
-- Não existe ambiente de homologação. Este script roda uma única vez, à mão,
-- na produção, numa única sessão, SOMENTE DEPOIS que o código sem a IA de
-- atendimento (ZIP v2) estiver PUBLICADO — com o código antigo no ar, derrubar
-- estas tabelas quebraria o chat do guia, o WhatsApp e as respostas do Airbnb.
--
-- NÃO ESTÁ EM supabase/migrations DE PROPÓSITO: nunca deve ser aplicado
-- automaticamente.
--
-- Pré-requisito na mesma sessão:
--   SET conciergeia.remocao_ia = 'confirmo-producao';
--
-- O QUE FAZ (tudo numa transação; se qualquer passo falhar, nada é aplicado):
--   1. Desagenda os 7 jobs do pg_cron cujas rotas deixaram de existir: os 6 exclusivos da
--      IA antiga + `refresh-city-references-weekly` (rota removida no lote 2 da limpeza
--      global; o job já estava desligado desde 24/09/2026 e só dispararia 404).
--   2. Apaga as linhas exclusivas da IA em tabelas compartilhadas
--      (ai_system_events, ops_push_log, ai_alerts).
--   3. Derruba políticas, funções e as 29 tabelas exclusivas (+3 condicionais),
--      em ordem de dependência, sem CASCADE.
--   4. Remove as 7 colunas exclusivas em tabelas compartilhadas.
--   5. Confere que não sobrou nada e imprime as contagens.
--
-- O QUE NÃO TOCA (preservado por decisão):
--   - Assistente do Painel: assistant_threads, assistant_messages, ai_system_docs
--     (+ match_ai_system_docs, search_ai_system_docs_text, can_read_system_doc),
--     profiles.assistant_auto_confirm, job reindex-system-knowledge, extensão vector
--   - property_chat_conversations.ai_paused / paused_until (controle de pausa)
--   - property_listing_raw_data.airbnb_ai_enabled / airbnb_ai_toggled_* (chave por anúncio)
--   - enums chat_conversation_status ('ai') e member_permission (ai_train/ai_view)
--   - ai_alerts (falhas de entrega) e ai_system_events (trilha de auditoria do SaaS)
--   - host_whatsapp_config, whatsapp_templates, ops_push_log, guest_arrival_status
--   - todas as tabelas do Dossiê
--   - segredos: AI_COST_ALERT_*, AI_EVALUATION_PROPERTY_IDS saem no painel do Lovable
-- =====================================================================

BEGIN;

-- 0. Guarda
DO $$
BEGIN
  IF current_setting('conciergeia.remocao_ia', true) IS DISTINCT FROM 'confirmo-producao' THEN
    RAISE EXCEPTION 'Exclusão NÃO executada: faltou SET conciergeia.remocao_ia = ''confirmo-producao'' na mesma sessão (só após publicar o código v2).';
  END IF;
END $$;

-- 1. Inventário (só o que existe neste banco)
CREATE TEMP TABLE _tabelas_ia (nome text PRIMARY KEY, ordem int) ON COMMIT DROP;
INSERT INTO _tabelas_ia VALUES
  ('ai_messages', 10), ('ai_learning_candidates', 11), ('chat_message_feedback', 12),
  ('ai_agent_evaluations', 20), ('ai_agent_learning_metrics', 21), ('ai_agent_logs', 22), ('ai_agent_metrics', 23),
  ('ai_channel_connections', 24), ('ai_conversation_channels', 25), ('ai_conversation_summaries', 26),
  ('ai_conversations', 27), ('ai_global_intelligence', 28), ('ai_guest_memory', 29), ('ai_host_corrections', 30),
  ('ai_human_escalations', 31), ('ai_kb_chunks', 32), ('ai_knowledge_gaps', 33), ('ai_learning_impact_logs', 34),
  ('ai_memories', 35), ('ai_operational_memory', 36), ('ai_precedents', 37), ('ai_proactive_actions', 38),
  ('ai_prompt_change_candidates', 39), ('ai_property_playbooks', 40), ('ai_tenant_knowledge', 42),
  ('ai_usage_events', 43), ('host_behavior', 45), ('host_faqs', 46), ('host_knowledge', 47),
  ('ai_knowledge_events', 50), ('ai_learning_decisions', 51), ('guest_itineraries', 52);
DELETE FROM _tabelas_ia t WHERE NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = t.nome);

DO $$
DECLARE t record; n bigint;
BEGIN
  FOR t IN SELECT nome FROM _tabelas_ia ORDER BY ordem LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t.nome) INTO n;
    RAISE NOTICE 'antes  tabela % = % linhas', t.nome, n;
  END LOOP;
END $$;

-- 2. Jobs do pg_cron
DO $$
DECLARE r record; n int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR r IN SELECT jobid, jobname FROM cron.job
             WHERE jobname IN ('proactive-concierge-hourly','guest-followup-hourly','learning-loop-daily',
                               'ai-evaluation-suite-weekly','channex-ai-reply-due','ai-cost-alert-hourly',
                               'refresh-city-references-weekly') LOOP
      PERFORM cron.unschedule(r.jobid);
      n := n + 1;
      RAISE NOTICE 'job desagendado: % (%)', r.jobname, r.jobid;
    END LOOP;
  END IF;
  RAISE NOTICE 'jobs desagendados: %', n;
END $$;

-- 3. Linhas exclusivas da IA em tabelas compartilhadas
DELETE FROM public.ai_system_events
  WHERE actor_type = 'AI_AGENT' OR event_category IN ('AI_DECISION','LEARNING','MEMORY');
DELETE FROM public.ops_push_log
  WHERE kind IN ('ai-reply-slot','human-answer-delivery','needs-human-followup','resume-gate','silent-close','unanswered-sweep');
DELETE FROM public.ai_alerts WHERE kind <> 'delivery_failure';

-- 4. Políticas das tabelas que vão sair (algumas usam funções que também vão sair)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.policyname, p.tablename FROM pg_policies p JOIN _tabelas_ia t ON t.nome = p.tablename WHERE p.schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- 5. Funções exclusivas (antes das tabelas: devolvem SETOF delas)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure::text AS assinatura FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
           WHERE ns.nspname = 'public' AND p.proname IN ('match_ai_kb_chunks','match_ai_memories','match_ai_precedents',
             'search_ai_kb_chunks_text','search_ai_memories_text','bump_memory_usage') LOOP
    EXECUTE format('DROP FUNCTION %s', r.assinatura);
  END LOOP;
END $$;

-- 6. Tabelas exclusivas (filhas antes das referenciadas; sem CASCADE)
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT nome FROM _tabelas_ia ORDER BY ordem LOOP
    EXECUTE format('DROP TABLE public.%I', t.nome);
  END LOOP;
END $$;

-- 7. Colunas exclusivas em tabelas compartilhadas
ALTER TABLE public.property_chat_conversations DROP COLUMN IF EXISTS ai_reply_due_at, DROP COLUMN IF EXISTS ai_reply_ctx;
ALTER TABLE public.property_chat_messages
  DROP COLUMN IF EXISTS ai_cost_usd, DROP COLUMN IF EXISTS ai_tokens_in, DROP COLUMN IF EXISTS ai_tokens_out, DROP COLUMN IF EXISTS ai_models;
ALTER TABLE public.properties DROP COLUMN IF EXISTS ai_evaluation_target;

-- 8. Conferência final (aborta a transação se sobrou algo)
DO $$
DECLARE n bigint; m bigint;
BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r'
     AND (c.relname LIKE 'ai\_%' OR c.relname IN ('chat_message_feedback','host_behavior','host_faqs','host_knowledge','guest_itineraries'))
     AND c.relname NOT IN ('ai_alerts','ai_system_events','ai_system_docs');
  IF n <> 0 THEN RAISE EXCEPTION 'Sobraram % tabelas da IA antiga — revertendo.', n; END IF;

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname IN ('match_ai_kb_chunks','match_ai_memories','match_ai_precedents',
     'search_ai_kb_chunks_text','search_ai_memories_text','bump_memory_usage');
  IF n <> 0 THEN RAISE EXCEPTION 'Sobraram % funções da IA antiga — revertendo.', n; END IF;

  SELECT count(*) INTO n FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND NOT a.attisdropped
     AND a.attname IN ('ai_reply_due_at','ai_reply_ctx','ai_cost_usd','ai_tokens_in','ai_tokens_out','ai_models','ai_evaluation_target');
  IF n <> 0 THEN RAISE EXCEPTION 'Sobraram % colunas da IA antiga — revertendo.', n; END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    EXECUTE $q$SELECT count(*) FROM cron.job WHERE jobname IN ('proactive-concierge-hourly','guest-followup-hourly','learning-loop-daily','ai-evaluation-suite-weekly','channex-ai-reply-due','ai-cost-alert-hourly','refresh-city-references-weekly')$q$ INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'Sobraram % jobs da IA antiga — revertendo.', n; END IF;
  END IF;

  -- preservados: precisam continuar existindo
  SELECT count(*) INTO m FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('ai_alerts','ai_system_events','ai_system_docs','assistant_threads','assistant_messages',
                       'properties','property_playbook_entries','property_faqs','property_chat_conversations','property_chat_messages');
  IF m <> 10 THEN RAISE EXCEPTION 'Tabela preservada sumiu (esperado 10, achado %) — revertendo.', m; END IF;

  SELECT count(*) INTO m FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND NOT a.attisdropped
     AND ((c.relname = 'property_chat_conversations' AND a.attname IN ('ai_paused','paused_until'))
       OR (c.relname = 'property_listing_raw_data' AND a.attname = 'airbnb_ai_enabled')
       OR (c.relname = 'profiles' AND a.attname = 'assistant_auto_confirm'));
  IF m <> 4 THEN RAISE EXCEPTION 'Coluna de controle preservada sumiu (esperado 4, achado %) — revertendo.', m; END IF;

  RAISE NOTICE 'depois ai_system_events = %', (SELECT count(*) FROM public.ai_system_events);
  RAISE NOTICE 'depois ops_push_log     = %', (SELECT count(*) FROM public.ops_push_log);
  RAISE NOTICE 'depois ai_alerts        = %', (SELECT count(*) FROM public.ai_alerts);
  RAISE NOTICE 'depois properties/playbook/faqs = % / % / %',
    (SELECT count(*) FROM public.properties), (SELECT count(*) FROM public.property_playbook_entries), (SELECT count(*) FROM public.property_faqs);
  RAISE NOTICE 'depois policies/functions public = % / %',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'),
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public');
END $$;

COMMIT;
