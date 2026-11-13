-- RECORRÊNCIAS DE MANUTENÇÃO E LIMPEZA (13/11/2026)
-- Pedido: "Repetir" na Nova situação. A série vive em `task_recurrences`; cada ocorrência é uma
-- pendência comum (`tasks`) ligada à série por `recurrence_id`, então tudo que já existe (checklist da
-- limpeza, concluir, pular, custo, histórico) continua valendo sem caminho paralelo.
-- Com "Entra no checklist de limpeza = Sim", a pendência nasce ligada (reservation_id) ao checkout mais
-- próximo da data prevista; com "Não", fica solta, na própria data.

CREATE TABLE IF NOT EXISTS public.task_recurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('maintenance', 'cleaning')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 50),
  description text,
  unit text NOT NULL CHECK (unit IN ('day', 'week', 'month', 'year')),
  interval_n integer NOT NULL DEFAULT 1 CHECK (interval_n BETWEEN 1 AND 365),
  -- dia do mês de referência ("todo mês, dia 12"); mês mais curto usa o último dia.
  anchor_day integer NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
  start_date date NOT NULL,
  -- próxima data AINDA NÃO transformada em pendência.
  next_date date,
  ends_on date,
  in_cleaning_checklist boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_recurrences_account_idx ON public.task_recurrences(account_owner_id);
CREATE INDEX IF NOT EXISTS task_recurrences_property_idx ON public.task_recurrences(property_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_recurrences TO authenticated;
GRANT ALL ON public.task_recurrences TO service_role;
REVOKE ALL ON public.task_recurrences FROM anon;

ALTER TABLE public.task_recurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_recurrences_select" ON public.task_recurrences;
DROP POLICY IF EXISTS "task_recurrences_insert" ON public.task_recurrences;
DROP POLICY IF EXISTS "task_recurrences_update" ON public.task_recurrences;
DROP POLICY IF EXISTS "task_recurrences_delete" ON public.task_recurrences;

CREATE POLICY "task_recurrences_select" ON public.task_recurrences FOR SELECT TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id));
CREATE POLICY "task_recurrences_insert" ON public.task_recurrences FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_property(auth.uid(), property_id));
CREATE POLICY "task_recurrences_update" ON public.task_recurrences FOR UPDATE TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id))
  WITH CHECK (public.user_can_access_property(auth.uid(), property_id));
CREATE POLICY "task_recurrences_delete" ON public.task_recurrences FOR DELETE TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id));

DROP TRIGGER IF EXISTS task_recurrences_touch ON public.task_recurrences;
CREATE TRIGGER task_recurrences_touch BEFORE UPDATE ON public.task_recurrences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Ligação ocorrência → série. Uma data nunca vira duas pendências da mesma série.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS recurrence_id uuid REFERENCES public.task_recurrences(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tasks_recurrence_idx ON public.tasks(recurrence_id);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_recurrence_date_uq
  ON public.tasks(recurrence_id, due_date) WHERE recurrence_id IS NOT NULL;

-- Tempo real (regra do projeto: toda tabela editável pelo usuário publica no realtime).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'task_recurrences'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_recurrences;
  END IF;
END $$;
