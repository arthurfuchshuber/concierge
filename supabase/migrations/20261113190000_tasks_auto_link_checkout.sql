-- Toda situação que entra no checklist da limpeza precisa estar presa a um card de checkout (13/11/2026).
-- `auto_link_checkout` marca as pendências cujo checkout é ESCOLHIDO PELO SISTEMA (o mais próximo da data,
-- mesma regra das recorrências). Elas são religadas sozinhas quando o checkout muda ou é cancelado, e a que
-- não tem checkout à frente fica guardada (reservation_id nulo) até surgir uma reserva.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS auto_link_checkout boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS tasks_auto_link_checkout_idx
  ON public.tasks(property_id)
  WHERE auto_link_checkout AND status = 'pending';
