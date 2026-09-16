-- OS RELÓGIOS ESTAVAM MORRENDO AOS 5 SEGUNDOS (11/09/2026).
--
-- Esta migration nasceu para agendar o laço de aprendizado e virou outra coisa
-- quando os dados do banco desmentiram a hipótese. Vale registrar as duas.
--
-- HIPÓTESE ERRADA: "o laço de aprendizado nunca rodou".
-- Falso. O job `learning-loop-daily` existe no banco desde agosto e roda todo
-- dia às 05:00 UTC — `cron.job_run_details` mostra sucesso em 07, 08, 09, 10 e
-- 11/09. O que não existia era o job NA MIGRATION: ele foi criado direto no
-- banco e nunca versionado, então um rebuild do banco o perderia sem aviso.
-- O mesmo vale para outros. A pasta de migrations e o `cron.job` real
-- divergiram: há migration sem job (a de ops-push, a da suíte de avaliação) e
-- job sem migration (learning-loop).
--
-- O QUE OS DADOS MOSTRARAM DE VERDADE, e é grave:
-- `net._http_response` está cheio de "Timeout of 5000 ms reached". O
-- `net.http_post` usa 5 segundos por padrão, e só TRÊS dos quinze agendamentos
-- passavam `timeout_milliseconds`. Ou seja: todo cron que faz trabalho de
-- verdade — varrer imóveis, chamar o modelo, sincronizar calendário — era
-- cortado no meio, todo dia, silenciosamente. O "sucesso" que aparece em
-- `cron.job_run_details` é só o disparo do pedido, não o resultado dele.
--
-- Isso explica o que a auditoria tinha atribuído a outra causa: o motor
-- proativo foi agendado ontem e `ai_proactive_actions` continuou em zero. Ele
-- estava rodando e morrendo aos 5 segundos, de hora em hora.
--
-- Abaixo, todos os agendamentos que chamam o app são recriados com um teto de
-- tempo compatível com o trabalho que cada um faz. Os horários originais são
-- preservados exatamente — nada de "aproveitar para mudar".

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  base text := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/';
  segredo text := 'UiKfyYqTqxI-3zrXDuFwikiJwD-9rwqk5P0GtrGNdQd70t-qqRaAtMgL_Y3FMrmv';
  j record;
BEGIN
  FOR j IN
    SELECT * FROM (VALUES
      -- nome do job,                        agenda,        endpoint,                   teto (ms)
      ('conversation-reminders-15min',       '*/15 * * * *', 'conversation-reminders',     30000),
      ('ops-push-scan',                      '*/30 * * * *', 'ops-push',                   30000),
      ('sync-airbnb-ical-30min',             '*/30 * * * *', 'sync-airbnb-ical',           60000),
      -- Os pesados: varrem imóveis e chamam o modelo.
      ('proactive-concierge-hourly',         '0 * * * *',    'proactive-concierge',       120000),
      ('guest-followup-hourly',              '25 * * * *',   'guest-followup',            120000),
      ('learning-loop-daily',                '0 5 * * *',    'learning-loop',             120000),
      ('refresh-guide-recommendations-daily','0 6 * * *',    'refresh-recommendations',   120000),
      ('refresh-city-news-daily',            '0 13 * * *',   'refresh-city-news',         120000),
      ('refresh-city-references-weekly',     '0 3 * * 0',    'refresh-city-references',   120000)
    ) AS t(nome, agenda, rota, teto)
  LOOP
    BEGIN
      PERFORM cron.unschedule(j.nome)
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j.nome);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    PERFORM cron.schedule(
      j.nome,
      j.agenda,
      format(
        $fmt$SELECT net.http_post(
          url := %L,
          headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L),
          body := '{}'::jsonb,
          timeout_milliseconds := %s
        ) AS request_id;$fmt$,
        base || j.rota, segredo, j.teto
      )
    );
  END LOOP;
END $$;

-- `auto-checkout-scan` (30s) e `reindex-system-knowledge` (120s) já tinham teto
-- e ficam como estão.

-- A SUÍTE DE AVALIAÇÃO, AGENDADA — semanal, não diária.
--
-- Ela nunca esteve em `cron.job`: a migration 20260824010000 existe na pasta e
-- nunca foi aplicada no banco vivo. Roda segunda-feira às 7h UTC (4h de
-- Brasília), com teto de 5 minutos — são 21 cenários passando pelo pipeline
-- real, cada um com várias chamadas de modelo.
--
-- Semanal, e não diária, por uma razão simples: cada execução custa dinheiro em
-- tokens, e uma medição por semana já pega regressão antes de o hóspede pegar.
-- Para passar a diária, troque '0 7 * * 1' por '0 7 * * *'.
--
-- ENQUANTO `AI_EVALUATION_PROPERTY_IDS` não for definida no projeto, ela roda
-- em no-op — mas agora abre um alerta no painel em vez de sumir num log.
DO $$ BEGIN
  PERFORM cron.unschedule('ai-evaluation-suite-weekly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-evaluation-suite-weekly');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'ai-evaluation-suite-weekly',
  '0 7 * * 1',
  $$SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/evaluation-suite',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'UiKfyYqTqxI-3zrXDuFwikiJwD-9rwqk5P0GtrGNdQd70t-qqRaAtMgL_Y3FMrmv'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  ) AS request_id;$$
);
