-- RELATO DO PRESTADOR NA PENDÊNCIA (14/11/2026, mockups "DECIDIR · C1" aprovados).
-- O prestador conclui a pendência pela janela dele (Resolvido / Não consegui, valor a receber, como foi
-- resolvido e anexos). Isso NÃO fecha a pendência: com "Resolvido" ela fica "Aguardando aprovação" e o
-- anfitrião aprova (janela financeira de sempre, agora com o relato no topo) ou devolve ao prestador.
-- Com "Não consegui" ela continua aberta, presa ao próximo checkout, e o anfitrião vê o motivo.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS provider_report_status text CHECK (provider_report_status IN ('resolved', 'failed')),
  ADD COLUMN IF NOT EXISTS provider_report_amount_cents integer CHECK (provider_report_amount_cents IS NULL OR provider_report_amount_cents >= 0),
  ADD COLUMN IF NOT EXISTS provider_report_note text,
  ADD COLUMN IF NOT EXISTS provider_report_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_report_by_name text,
  ADD COLUMN IF NOT EXISTS provider_report_at timestamptz;

CREATE INDEX IF NOT EXISTS tasks_provider_report_pending_idx
  ON public.tasks(account_owner_id)
  WHERE provider_report_status = 'resolved' AND status = 'pending';
