-- HISTÓRICO DA RESERVA: QUEM FEZ CADA AÇÃO (05/10/2026).
--
-- Pedido: "dizer quem fez aquela ação, que horas, etc.". `guest_arrival_status`
-- guarda carimbos de tempo, mas nenhuma coluna diz QUEM mexeu (check-in,
-- checkout, conclusão, previsão). Em vez de editar cada um dos escritores (o
-- quadro, a limpeza manual, o iCal, a reconciliação), um gatilho central grava
-- o evento com `auth.uid()`: quem chega por service role (sincronização,
-- rotinas) fica sem autor e aparece como "Sistema". Dados anteriores a esta
-- migração não têm evento — a tela mostra "Autor não registrado".
CREATE TABLE IF NOT EXISTS public.reservation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  log_id uuid,
  reservation_id uuid,
  -- checkin | no_show | checkout | concluded | previsao_hora | previsao_data
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reservation_events_log_idx ON public.reservation_events (log_id) WHERE log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservation_events_res_idx ON public.reservation_events (reservation_id) WHERE reservation_id IS NOT NULL;

ALTER TABLE public.reservation_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.reservation_events TO authenticated;
GRANT ALL ON public.reservation_events TO service_role;

DROP POLICY IF EXISTS "reservation_events_select" ON public.reservation_events;
CREATE POLICY "reservation_events_select" ON public.reservation_events
  FOR SELECT TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id));

CREATE OR REPLACE FUNCTION public.log_reservation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  old_done timestamptz;
  old_conc timestamptz;
  old_status text;
  old_time text;
  old_date text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_done := OLD.done_at;
    old_conc := OLD.concluded_at;
    old_status := OLD.status;
    old_time := OLD.arrival_time_override::text;
    old_date := OLD.arrival_date_override::text;
  END IF;

  IF NEW.kind = 'checkin' THEN
    IF NEW.done_at IS NOT NULL AND old_done IS NULL AND NEW.status IS DISTINCT FROM 'no_show' THEN
      INSERT INTO reservation_events (property_id, log_id, reservation_id, kind, actor_id)
      VALUES (NEW.property_id, NEW.log_id, NEW.reservation_id, 'checkin', actor);
    END IF;
    IF NEW.status = 'no_show' AND old_status IS DISTINCT FROM 'no_show' THEN
      INSERT INTO reservation_events (property_id, log_id, reservation_id, kind, actor_id)
      VALUES (NEW.property_id, NEW.log_id, NEW.reservation_id, 'no_show', actor);
    END IF;
  END IF;

  IF NEW.kind = 'checkout' THEN
    IF NEW.done_at IS NOT NULL AND old_done IS NULL THEN
      INSERT INTO reservation_events (property_id, log_id, reservation_id, kind, actor_id)
      VALUES (NEW.property_id, NEW.log_id, NEW.reservation_id, 'checkout', actor);
    END IF;
    IF NEW.concluded_at IS NOT NULL AND old_conc IS NULL THEN
      INSERT INTO reservation_events (property_id, log_id, reservation_id, kind, actor_id, detail)
      VALUES (
        NEW.property_id, NEW.log_id, NEW.reservation_id, 'concluded',
        COALESCE(NEW.cleaning_done_by, actor),
        jsonb_build_object('cleaning_type', NEW.cleaning_type, 'price_cents', NEW.cleaning_price_cents)
      );
    END IF;
  END IF;

  IF NEW.arrival_time_override::text IS DISTINCT FROM old_time
     AND (TG_OP = 'UPDATE' OR NEW.arrival_time_override IS NOT NULL) THEN
    INSERT INTO reservation_events (property_id, log_id, reservation_id, kind, actor_id, detail)
    VALUES (
      NEW.property_id, NEW.log_id, NEW.reservation_id, 'previsao_hora', actor,
      jsonb_build_object('side', NEW.kind, 'from', old_time, 'to', NEW.arrival_time_override::text)
    );
  END IF;

  IF NEW.arrival_date_override::text IS DISTINCT FROM old_date
     AND (TG_OP = 'UPDATE' OR NEW.arrival_date_override IS NOT NULL) THEN
    INSERT INTO reservation_events (property_id, log_id, reservation_id, kind, actor_id, detail)
    VALUES (
      NEW.property_id, NEW.log_id, NEW.reservation_id, 'previsao_data', actor,
      jsonb_build_object('side', NEW.kind, 'from', old_date, 'to', NEW.arrival_date_override::text)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_reservation_event ON public.guest_arrival_status;
CREATE TRIGGER trg_log_reservation_event
  AFTER INSERT OR UPDATE ON public.guest_arrival_status
  FOR EACH ROW EXECUTE FUNCTION public.log_reservation_event();
