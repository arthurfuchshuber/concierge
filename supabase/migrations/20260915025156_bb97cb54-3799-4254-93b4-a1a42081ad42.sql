CREATE TABLE public.reservas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  propriedade_id uuid REFERENCES public.propriedades(id) ON DELETE SET NULL,
  codigo_reserva_channex text NOT NULL UNIQUE,
  channex_booking_id uuid,
  channex_revision_id uuid,
  channex_room_type_id uuid,
  channex_rate_plan_id uuid,
  nome_hospede text,
  email_hospede text,
  data_checkin date,
  data_checkout date,
  valor_total numeric(12,2),
  moeda text,
  status text NOT NULL DEFAULT 'new',
  ota_name text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservas TO authenticated;
GRANT ALL ON public.reservas TO service_role;

ALTER TABLE public.reservas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage reservas"
ON public.reservas FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_reservas_updated_at
BEFORE UPDATE ON public.reservas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_reservas_propriedade ON public.reservas(propriedade_id);
CREATE INDEX idx_reservas_checkin ON public.reservas(data_checkin);

CREATE TABLE public.fila_webhooks_channex (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payload jsonb NOT NULL,
  evento text,
  processado boolean NOT NULL DEFAULT false,
  tentativas integer NOT NULL DEFAULT 0,
  erro text,
  processado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.fila_webhooks_channex TO authenticated;
GRANT ALL ON public.fila_webhooks_channex TO service_role;

ALTER TABLE public.fila_webhooks_channex ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read fila_webhooks_channex"
ON public.fila_webhooks_channex FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_fila_channex_pendentes ON public.fila_webhooks_channex(processado, id) WHERE processado = false;
