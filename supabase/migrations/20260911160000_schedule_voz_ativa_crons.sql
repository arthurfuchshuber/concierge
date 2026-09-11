-- OS DOIS RELÓGIOS DA VOZ ATIVA (11/09/2026).
--
-- Descoberta desta entrega, olhando `cron.job` no banco de produção: o job
-- 'proactive-concierge-hourly' NÃO EXISTE. A migration que o criava
-- (20260824010500) nunca chegou a rodar no banco vivo. Ou seja: o motor
-- proativo inteiro — boas-vindas antes do check-in, instruções de saída,
-- hóspede silencioso — nunca foi executado uma única vez. Bate com o que a
-- auditoria encontrou: `ai_proactive_actions` com ZERO linhas desde sempre.
-- Não era regra ruim nem canal errado; era um relógio que ninguém deu corda.
--
-- Esta migration cria (ou recria) os dois:
--
--  · proactive-concierge-hourly — de hora em hora, varre reservas, gera as
--    ações e agora ENTREGA de verdade pelo chat do guia + push;
--  · guest-followup-hourly — de hora em hora, procura caso aberto parado há
--    mais de 4h em que a última palavra foi nossa, e faz a IA voltar no
--    hóspede para saber se resolveu. No máximo uma vez por dia por conversa.
--
-- Ambos rodam de hora em hora de propósito: as janelas das regras são de
-- 24-48h e as travas de horário/repetição vivem no código
-- (`speak.server.ts`). O que é barrado às 3h da manhã volta às 8h sozinho, na
-- varredura seguinte — por isso a frequência alta não vira incômodo.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('proactive-concierge-hourly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'proactive-concierge-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('guest-followup-hourly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'guest-followup-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'proactive-concierge-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/proactive-concierge',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'UiKfyYqTqxI-3zrXDuFwikiJwD-9rwqk5P0GtrGNdQd70t-qqRaAtMgL_Y3FMrmv'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'guest-followup-hourly',
  '25 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/guest-followup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'UiKfyYqTqxI-3zrXDuFwikiJwD-9rwqk5P0GtrGNdQd70t-qqRaAtMgL_Y3FMrmv'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
