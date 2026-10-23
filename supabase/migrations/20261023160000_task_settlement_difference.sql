-- 23/10/2026 — "Concluir pendência" (mockups 0i/0j/0k): prestação de contas
-- completa da despesa. Colunas ADITIVAS e anuláveis (nada existente muda):
--   amount_due_cents      → "Valor a pagar" (pode divergir do valor da resolução)
--   resolution_received   → botão "Não recebeu / Já recebeu" (valor da resolução)
--   difference_cents      → diferença com sinal: valor a pagar − valor da resolução
--   difference_to / _id   → para quem vai a diferença (proprietário, anfitrião,
--                           prestador ou hóspede). "company" = anfitrião (conta).
-- "Quem deve pagar / quem pagou / valor pago" já existiam (cost_payer*, paid_by*,
-- amount_paid_cents).
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS amount_due_cents integer CHECK (amount_due_cents IS NULL OR amount_due_cents >= 0),
  ADD COLUMN IF NOT EXISTS resolution_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS difference_cents integer,
  ADD COLUMN IF NOT EXISTS difference_to text CHECK (difference_to IS NULL OR difference_to IN ('company','owner','provider','guest')),
  ADD COLUMN IF NOT EXISTS difference_to_id uuid;

-- Pendência RECORRENTE marcada no checklist da limpeza grava a baixa em
-- task_completions (uma por ocorrência) — a mesma prestação de contas precisa
-- caber ali, senão a despesa dessa ocorrência não seria contabilizada.
ALTER TABLE public.task_completions
  ADD COLUMN IF NOT EXISTS amount_due_cents integer CHECK (amount_due_cents IS NULL OR amount_due_cents >= 0),
  ADD COLUMN IF NOT EXISTS resolution_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cost_payer text CHECK (cost_payer IS NULL OR cost_payer IN ('company','owner','provider','guest')),
  ADD COLUMN IF NOT EXISTS cost_payer_id uuid,
  ADD COLUMN IF NOT EXISTS paid_by text CHECK (paid_by IS NULL OR paid_by IN ('company','owner','provider','guest')),
  ADD COLUMN IF NOT EXISTS paid_by_id uuid,
  ADD COLUMN IF NOT EXISTS amount_paid_cents integer CHECK (amount_paid_cents IS NULL OR amount_paid_cents >= 0),
  ADD COLUMN IF NOT EXISTS difference_cents integer,
  ADD COLUMN IF NOT EXISTS difference_to text CHECK (difference_to IS NULL OR difference_to IN ('company','owner','provider','guest')),
  ADD COLUMN IF NOT EXISTS difference_to_id uuid;
