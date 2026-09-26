ALTER TABLE public.reservation_records DROP CONSTRAINT IF EXISTS reservation_records_category_check;
DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.reservation_records'::regclass AND pg_get_constraintdef(oid) ILIKE '%category = ANY%' LOOP
    EXECUTE format('ALTER TABLE public.reservation_records DROP CONSTRAINT %I', c);
  END LOOP; END $$;
ALTER TABLE public.reservation_records ADD CONSTRAINT reservation_records_category_check
  CHECK (category = ANY (ARRAY['forgotten','damage','incident','cleaning_audit','maintenance','other']));