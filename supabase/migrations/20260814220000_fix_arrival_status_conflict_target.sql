-- BUG CRÍTICO: o índice único de reservation_id era PARCIAL
-- (WHERE reservation_id IS NOT NULL). O Postgres não aceita um índice
-- parcial como alvo de "ON CONFLICT (reservation_id, kind)" a menos que o
-- próprio INSERT repita a mesma cláusula WHERE — o que o upsert do
-- Supabase JS não permite configurar. Resultado: TODO clique em "check" de
-- um card baseado em reserva (a maioria) quebrava com
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- Corrige convertendo para uma constraint única "cheia" — numa coluna
-- opcional, o Postgres já trata NULL como sempre distinto de qualquer outro
-- valor (múltiplos NULLs continuam permitidos), então o comportamento
-- prático é idêntico ao índice parcial antigo, só que compatível com
-- ON CONFLICT sem cláusula WHERE.
DO $$
BEGIN
  DROP INDEX IF EXISTS public.guest_arrival_status_reservation_kind_uidx;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guest_arrival_status_reservation_id_kind_key'
  ) THEN
    ALTER TABLE public.guest_arrival_status
      ADD CONSTRAINT guest_arrival_status_reservation_id_kind_key UNIQUE (reservation_id, kind);
  END IF;
END $$;
