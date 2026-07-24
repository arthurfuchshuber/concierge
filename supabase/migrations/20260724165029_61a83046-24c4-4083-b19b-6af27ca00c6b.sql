
CREATE TABLE IF NOT EXISTS public.guest_arrival_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid NOT NULL REFERENCES public.guide_access_logs(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('checkin','checkout')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  note text,
  arrival_time_override text,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (log_id, kind)
);

CREATE INDEX IF NOT EXISTS guest_arrival_status_property_idx ON public.guest_arrival_status(property_id, kind);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_arrival_status TO authenticated;
GRANT ALL ON public.guest_arrival_status TO service_role;

ALTER TABLE public.guest_arrival_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "arrival_status_select_property_access"
  ON public.guest_arrival_status FOR SELECT
  TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id));

CREATE POLICY "arrival_status_insert_property_access"
  ON public.guest_arrival_status FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_access_property(auth.uid(), property_id));

CREATE POLICY "arrival_status_update_property_access"
  ON public.guest_arrival_status FOR UPDATE
  TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id))
  WITH CHECK (public.user_can_access_property(auth.uid(), property_id));

CREATE POLICY "arrival_status_delete_property_access"
  ON public.guest_arrival_status FOR DELETE
  TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id));

CREATE TRIGGER guest_arrival_status_touch
  BEFORE UPDATE ON public.guest_arrival_status
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
