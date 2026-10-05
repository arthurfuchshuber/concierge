-- LIXEIRA OCULTA DOS REGISTROS (pedido explícito, 04/10/2026).
--
-- "Excluir" em Registros precisa sumir NA HORA de todo o sistema (aba
-- Registros, clipe da reserva, card de limpeza, pendências) e, ainda assim,
-- ficar guardado por 30 dias antes de ser apagado de vez.
--
-- A linha excluída sai de `reservation_records` (assim nenhuma consulta,
-- contador ou tela precisa saber que existe lixeira) e uma cópia completa
-- — registros do grupo, pendência automática que morreu junto e caminhos dos
-- arquivos no storage — fica aqui, por 30 dias (`purge_at`). Os arquivos NÃO
-- saem do storage durante esse prazo.
--
-- OCULTA DE PROPÓSITO: RLS ligado e NENHUMA política. Cliente (navegador)
-- não lê, não grava, não apaga; só o servidor, com a chave de serviço
-- (excluir, desfazer e a varredura diária de limpeza definitiva).
CREATE TABLE IF NOT EXISTS public.reservation_records_trash (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  records jsonb NOT NULL,
  tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  storage_paths text[] NOT NULL DEFAULT '{}',
  deleted_by uuid NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  purge_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS reservation_records_trash_purge_at_idx
  ON public.reservation_records_trash (purge_at);
CREATE INDEX IF NOT EXISTS reservation_records_trash_property_idx
  ON public.reservation_records_trash (property_id);

ALTER TABLE public.reservation_records_trash ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_records_trash FROM anon, authenticated;

-- Varredura diária (03:17 UTC) que apaga de vez o que passou de 30 dias.
-- lovable-cron-fallback-reviewed: limpeza diária da lixeira de registros; o endpoint só apaga linhas com purge_at vencido
SELECT cron.unschedule('purge-record-trash')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-record-trash');

SELECT cron.schedule(
  'purge-record-trash',
  '17 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/purge-record-trash',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
<<<<<<< HEAD
);
=======
);
>>>>>>> 810215cd043a2903e8c29d83960bc640411e344a
