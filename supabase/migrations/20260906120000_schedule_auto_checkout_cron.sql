-- Agenda o job "auto-checkout-scan": confirma automaticamente o checkout de
-- um card assim que o horário PREVISTO (definido pelo anfitrião no card, ou
-- informado pelo hóspede) chega, no fuso horário local de cada imóvel — sem
-- precisar de clique manual em "Confirmar checkout". Pedido explícito
-- (06/09/2026). Ver `runAutoCheckoutScan` em `src/lib/auto-checkout.server.ts`
-- para a lógica completa (reaproveita a mesma ação do botão manual).
--
-- Cadência de 5 minutos: "pontualmente no horário previsto" pede mais
-- precisão do que os 30 minutos do job de push operacional (ops-push-scan) —
-- o objetivo aqui é a AÇÃO em si (mudar o card de status), não só um aviso,
-- então o atraso entre o horário previsto e a confirmação automática deve
-- ficar pequeno. Mesmo timeout de 30s do http_post usado no job de ops-push,
-- pelo mesmo motivo (a varredura percorre TODOS os imóveis da plataforma a
-- cada execução).
SELECT cron.unschedule('auto-checkout-scan')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-checkout-scan');

SELECT cron.schedule(
  'auto-checkout-scan',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/auto-checkout',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'UiKfyYqTqxI-3zrXDuFwikiJwD-9rwqk5P0GtrGNdQd70t-qqRaAtMgL_Y3FMrmv'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
