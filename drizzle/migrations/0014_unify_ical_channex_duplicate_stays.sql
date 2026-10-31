CREATE OR REPLACE FUNCTION public.merge_duplicate_stay(_keep uuid, _dup uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record; k record;
BEGIN
  FOR d IN SELECT * FROM guest_arrival_status WHERE reservation_id = _dup LOOP
    SELECT * INTO k FROM guest_arrival_status WHERE reservation_id = _keep AND kind = d.kind LIMIT 1;
    IF k.id IS NULL THEN
      UPDATE guest_arrival_status SET reservation_id = _keep WHERE id = d.id;
    ELSE
      UPDATE guest_arrival_status SET
        status = CASE WHEN k.status = 'pending' AND d.status <> 'pending' THEN d.status ELSE k.status END,
        done_at = COALESCE(k.done_at, d.done_at),
        concluded_at = COALESCE(k.concluded_at, d.concluded_at),
        arrival_time_override = COALESCE(k.arrival_time_override, d.arrival_time_override),
        arrival_date_override = COALESCE(k.arrival_date_override, d.arrival_date_override),
        cleaning_type = COALESCE(k.cleaning_type, d.cleaning_type),
        cleaning_price_cents = COALESCE(k.cleaning_price_cents, d.cleaning_price_cents),
        cleaning_approval_status = COALESCE(k.cleaning_approval_status, d.cleaning_approval_status),
        note = COALESCE(k.note, d.note)
      WHERE id = k.id;
      DELETE FROM guest_arrival_status WHERE id = d.id;
    END IF;
  END LOOP;
  UPDATE property_reservations SET status = 'cancelled_duplicate' WHERE id = _dup;
END $$;

REVOKE ALL ON FUNCTION public.merge_duplicate_stay(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.unify_ical_channex_stay()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF lower(coalesce(NEW.status,'')) LIKE '%cancel%' OR lower(coalesce(NEW.status,'')) LIKE '%block%' THEN
    RETURN NEW;
  END IF;
  IF NEW.source = 'channex' THEN
    FOR r IN SELECT id FROM property_reservations
      WHERE property_id = NEW.property_id AND source = 'airbnb'
        AND checkin_date = NEW.checkin_date AND checkout_date = NEW.checkout_date
        AND lower(coalesce(status,'')) NOT LIKE '%cancel%' AND lower(coalesce(status,'')) NOT LIKE '%block%'
    LOOP
      PERFORM merge_duplicate_stay(NEW.id, r.id);
    END LOOP;
  ELSIF NEW.source = 'airbnb' THEN
    SELECT id INTO r FROM property_reservations
      WHERE property_id = NEW.property_id AND source = 'channex'
        AND checkin_date = NEW.checkin_date AND checkout_date = NEW.checkout_date
        AND lower(coalesce(status,'')) NOT LIKE '%cancel%'
      ORDER BY created_at DESC LIMIT 1;
    IF r.id IS NOT NULL THEN
      PERFORM merge_duplicate_stay(r.id, NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_unify_ical_channex_stay ON public.property_reservations;
CREATE TRIGGER trg_unify_ical_channex_stay
AFTER INSERT OR UPDATE OF status, checkin_date, checkout_date ON public.property_reservations
FOR EACH ROW EXECUTE FUNCTION public.unify_ical_channex_stay();

-- Backfill: unify every existing duplicate pair.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT c.id AS keep, a.id AS dup FROM property_reservations c
    JOIN property_reservations a ON a.property_id = c.property_id AND a.source = 'airbnb'
      AND a.checkin_date = c.checkin_date AND a.checkout_date = c.checkout_date
    WHERE c.source = 'channex'
      AND lower(coalesce(c.status,'')) NOT LIKE '%cancel%'
      AND lower(coalesce(a.status,'')) NOT LIKE '%cancel%' AND lower(coalesce(a.status,'')) NOT LIKE '%block%'
  LOOP PERFORM public.merge_duplicate_stay(p.keep, p.dup); END LOOP;
END $$;