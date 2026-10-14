-- Janela de consolidação das mensagens picadas do hóspede (Airbnb via Channex).
-- Cada mensagem é gravada na hora; a IA só responde quando passa a janela sem mensagem nova.
ALTER TABLE public.property_chat_conversations
  ADD COLUMN IF NOT EXISTS ai_reply_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_reply_ctx jsonb;
CREATE INDEX IF NOT EXISTS property_chat_conversations_ai_reply_due_idx
  ON public.property_chat_conversations (ai_reply_due_at)
  WHERE ai_reply_due_at IS NOT NULL;

-- Batida curta: responde as conversas cuja janela de consolidação (15 s) fechou.
-- pg_cron novo aceita "15 seconds"; se a versão não aceitar, cai para 1 minuto.
-- lovable-cron-fallback-reviewed: processa só linhas com ai_reply_due_at vencido
DO $$
BEGIN
  PERFORM cron.unschedule('channex-ai-reply-due') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'channex-ai-reply-due');
  BEGIN
    PERFORM cron.schedule('channex-ai-reply-due', '15 seconds', $job$
      SELECT net.http_post(
        url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/channex-ari-retry?only=ai',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 30000) AS request_id;
    $job$);
  EXCEPTION WHEN OTHERS THEN
    PERFORM cron.schedule('channex-ai-reply-due', '* * * * *', $job$
      SELECT net.http_post(
        url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/channex-ari-retry?only=ai',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 30000) AS request_id;
    $job$);
  END;
END $$;
