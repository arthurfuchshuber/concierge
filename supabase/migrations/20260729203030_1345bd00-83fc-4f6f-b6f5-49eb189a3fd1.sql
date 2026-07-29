DROP POLICY IF EXISTS "guide_section_events deny client writes" ON public.guide_section_events;
CREATE POLICY "guide_section_events deny client insert" ON public.guide_section_events AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "guide_section_events deny client update" ON public.guide_section_events AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false);
CREATE POLICY "guide_section_events deny client delete" ON public.guide_section_events AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);
GRANT SELECT ON public.guide_section_events TO authenticated;
GRANT ALL ON public.guide_section_events TO service_role;