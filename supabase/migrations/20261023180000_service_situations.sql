-- Aba "Serviços": situações (Limpeza/Manutenção/Danos/Outro = do sistema; as demais, criadas pelo usuário).
CREATE TABLE IF NOT EXISTS public.service_situations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  detail text CHECK (detail IS NULL OR char_length(detail) <= 300),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS service_situations_owner_idx ON public.service_situations (account_owner_id) WHERE deleted_at IS NULL;
ALTER TABLE public.service_situations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Account can manage situations" ON public.service_situations;
CREATE POLICY "Account can manage situations" ON public.service_situations
  FOR ALL TO authenticated
  USING (auth.uid() = account_owner_id OR public.is_account_member(auth.uid(), account_owner_id))
  WITH CHECK (auth.uid() = account_owner_id OR public.is_account_member(auth.uid(), account_owner_id));

-- Situação da tarefa: chave do sistema (cleaning|maintenance|damage|other) ou uuid de situação própria.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS situation text;
ALTER TABLE public.reservation_records ADD COLUMN IF NOT EXISTS situation_id uuid REFERENCES public.service_situations(id) ON DELETE SET NULL;

UPDATE public.tasks SET situation = CASE
  WHEN category = 'cleaning' THEN 'cleaning'
  WHEN category = 'maintenance' OR title ILIKE 'Manuten%' THEN 'maintenance'
  WHEN title ILIKE 'Dano%' THEN 'damage'
  ELSE 'other' END
WHERE situation IS NULL;
CREATE INDEX IF NOT EXISTS tasks_situation_idx ON public.tasks (account_owner_id, situation);
