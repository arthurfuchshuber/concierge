CREATE TABLE public.channex_ari_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channex_property_id uuid NOT NULL,
  room_type_id uuid NOT NULL,
  rate_plan_id uuid NOT NULL,
  date date NOT NULL,
  availability integer,
  rate numeric(12,2),
  min_stay integer,
  max_stay integer,
  stop_sell boolean,
  closed_to_arrival boolean,
  closed_to_departure boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rate_plan_id, date)
);
GRANT SELECT ON public.channex_ari_calendar TO authenticated;
GRANT ALL ON public.channex_ari_calendar TO service_role;
ALTER TABLE public.channex_ari_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SaaS admins read ari calendar" ON public.channex_ari_calendar FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.channex_ari_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('availability','restrictions')),
  channex_property_id uuid NOT NULL,
  room_type_id uuid,
  rate_plan_id uuid,
  date_from date NOT NULL,
  date_to date NOT NULL,
  payload jsonb NOT NULL,
  dedupe_key text NOT NULL,
  source text NOT NULL DEFAULT 'delta',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','superseded')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  batch_id uuid,
  task_id text,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX channex_ari_outbox_pending_idx ON public.channex_ari_outbox (status, next_attempt_at);
CREATE INDEX channex_ari_outbox_dedupe_idx ON public.channex_ari_outbox (dedupe_key) WHERE status = 'pending';
GRANT SELECT ON public.channex_ari_outbox TO authenticated;
GRANT ALL ON public.channex_ari_outbox TO service_role;
ALTER TABLE public.channex_ari_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SaaS admins read ari outbox" ON public.channex_ari_outbox FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.channex_api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,
  method text NOT NULL,
  endpoint text NOT NULL,
  is_ari boolean NOT NULL DEFAULT false,
  batch_id uuid,
  attempt integer NOT NULL DEFAULT 1,
  http_status integer,
  request jsonb,
  response jsonb,
  task_id text,
  error text,
  next_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX channex_api_logs_ari_idx ON public.channex_api_logs (is_ari, created_at DESC);
GRANT SELECT ON public.channex_api_logs TO authenticated;
GRANT ALL ON public.channex_api_logs TO service_role;
ALTER TABLE public.channex_api_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SaaS admins read channex logs" ON public.channex_api_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.channex_booking_acks (
  revision_id uuid PRIMARY KEY,
  booking_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acked','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  acked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.channex_booking_acks TO authenticated;
GRANT ALL ON public.channex_booking_acks TO service_role;
ALTER TABLE public.channex_booking_acks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SaaS admins read booking acks" ON public.channex_booking_acks FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
