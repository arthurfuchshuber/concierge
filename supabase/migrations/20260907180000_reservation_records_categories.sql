-- Categorias do registro + vínculo com a pendência gerada (pedido explícito,
-- 07/09/2026). A etiqueta do registro deixa de ser "de onde ele nasceu"
-- (card_mode, que continua gravado como informação secundária) e passa a ser
-- O QUE ele é.
--
-- Ordem definida pelo cliente, e é a ordem em que aparecem no seletor:
--   1. forgotten       → Objetos Esquecidos     (gera pendência)
--   2. damage          → Danos ou Incidentes    (gera pendência, prioridade alta)
--   3. cleaning_audit  → Auditoria de Limpeza
--   4. maintenance     → Manutenção             (gera pendência)
--   5. other           → Observação / Outros
--
-- `task_id` guarda a pendência criada automaticamente para as três
-- categorias que geram tarefa. É a MESMA linha de `tasks` exibida no botão
-- PENDÊNCIAS do Kanban — não uma cópia — por isso concluir num lugar
-- reflete no outro. ON DELETE SET NULL: apagar a pendência não apaga o
-- registro (a foto/áudio da auditoria continua valendo como prova).
--
-- IDEMPOTENTE: este SQL foi aplicado direto no banco em 07/09/2026 e também
-- vive aqui como migração; rodar de novo não pode quebrar nada.
ALTER TABLE public.reservation_records
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS task_id uuid NULL REFERENCES public.tasks(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservation_records_category_chk'
  ) THEN
    ALTER TABLE public.reservation_records
      ADD CONSTRAINT reservation_records_category_chk
      CHECK (category IN ('forgotten','damage','cleaning_audit','maintenance','other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS reservation_records_task_id_idx ON public.reservation_records (task_id) WHERE task_id IS NOT NULL;
