-- ============================================================
-- Pendências: valor gasto (em centavos, mesmo padrão já usado em
-- dashboard-arrival-types.ts/properties.functions.ts) e recorrência em dias.
--
-- amount_spent_cents em "tasks" cobre:
--   - pendências PONTUAIS (log_id/reservation_id na própria linha): uma
--     única conclusão fecha a tarefa, então o gasto vive na própria linha.
--   - pendências com RECURRENCE_DAYS (nova recorrência por tempo, indepen-
--     dente do modelo "recorrente por limpeza" que já existia): guarda o
--     valor do ciclo mais recente.
--
-- Pendências "recorrentes por limpeza" (sem log/reservation na própria
-- linha, resetam sozinhas a cada limpeza via task_completions) guardam o
-- gasto de CADA ocorrência em task_completions.amount_spent_cents, porque
-- limpezas diferentes podem ter gastos diferentes.
-- ============================================================

ALTER TABLE public.tasks
  ADD COLUMN amount_spent_cents integer,
  ADD COLUMN recurrence_days integer;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_amount_spent_cents_check CHECK (amount_spent_cents IS NULL OR amount_spent_cents >= 0);
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_recurrence_days_check CHECK (recurrence_days IS NULL OR recurrence_days > 0);

ALTER TABLE public.task_completions
  ADD COLUMN amount_spent_cents integer;
ALTER TABLE public.task_completions
  ADD CONSTRAINT task_completions_amount_spent_cents_check CHECK (amount_spent_cents IS NULL OR amount_spent_cents >= 0);

-- Nenhuma política de RLS muda: os dois novos campos são só mais colunas de
-- dados nas mesmas linhas já protegidas por task_link_visible()/
-- task_completion_visible() (ver 20260830000000_create_tasks_pendencias.sql).
