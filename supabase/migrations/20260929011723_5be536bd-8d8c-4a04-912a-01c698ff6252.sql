DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recs_category_repair_20260924','recs_dedupe_backup_20260924','recs_radius_cleanup_20260924','recs_orphan_cleanup_20260924','property_rec_exclusions','city_daily_pulse','city_daily_news']
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY "SaaS admin reads" ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''admin''))', t);
  END LOOP;
END $$;
