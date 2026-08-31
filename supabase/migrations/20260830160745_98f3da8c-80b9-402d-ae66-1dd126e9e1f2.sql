CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  owner_contact_id uuid REFERENCES public.property_owners(id) ON DELETE SET NULL,
  log_id uuid,
  reservation_id uuid,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'other',
  priority text NOT NULL DEFAULT 'medium',
  due_date date,
  show_in_cleaning boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  amount_spent_cents integer,
  recurrence_days integer,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_account_owner_idx ON public.tasks(account_owner_id, status);
CREATE INDEX IF NOT EXISTS tasks_property_idx ON public.tasks(property_id);

CREATE TABLE IF NOT EXISTS public.task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  log_id uuid,
  reservation_id uuid,
  amount_spent_cents integer,
  completed_by uuid,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_completions_task_idx ON public.task_completions(task_id, completed_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_completions TO authenticated;
GRANT ALL ON public.task_completions TO service_role;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Account can manage tasks" ON public.tasks FOR ALL TO authenticated
USING (auth.uid() = account_owner_id OR public.is_account_member(auth.uid(), account_owner_id))
WITH CHECK (auth.uid() = account_owner_id OR public.is_account_member(auth.uid(), account_owner_id));

CREATE POLICY "Account can manage task completions" ON public.task_completions FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND (auth.uid() = t.account_owner_id OR public.is_account_member(auth.uid(), t.account_owner_id))))
WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND (auth.uid() = t.account_owner_id OR public.is_account_member(auth.uid(), t.account_owner_id))));

CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.set_permission_migration_updated_at();