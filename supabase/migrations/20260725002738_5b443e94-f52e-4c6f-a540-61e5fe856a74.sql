ALTER TABLE public.guest_arrival_status
  ADD COLUMN IF NOT EXISTS reservation_id uuid REFERENCES public.property_reservations(id) ON DELETE CASCADE;

ALTER TABLE public.guest_arrival_status
  ALTER COLUMN log_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guest_arrival_status_target_check'
      AND conrelid = 'public.guest_arrival_status'::regclass
  ) THEN
    ALTER TABLE public.guest_arrival_status
      ADD CONSTRAINT guest_arrival_status_target_check
      CHECK (log_id IS NOT NULL OR reservation_id IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS guest_arrival_status_reservation_kind_uidx
  ON public.guest_arrival_status (reservation_id, kind)
  WHERE reservation_id IS NOT NULL;