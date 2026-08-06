CREATE TABLE public.ops_push_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  kind text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb,
  sent_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ops_push_log_dedupe_idx ON public.ops_push_log (dedupe_key);
CREATE INDEX ops_push_log_owner_created_idx ON public.ops_push_log (owner_id, created_at DESC);

GRANT ALL ON public.ops_push_log TO service_role;

ALTER TABLE public.ops_push_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their own ops push log"
  ON public.ops_push_log FOR SELECT TO authenticated
  USING (owner_id = auth.uid());