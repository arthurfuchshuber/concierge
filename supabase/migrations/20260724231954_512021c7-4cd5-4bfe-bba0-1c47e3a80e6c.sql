-- Allow property owners and authorized account members to correct guest access log dates/times
CREATE POLICY "Owners can update their guide access logs" ON public.guide_access_logs
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = guide_access_logs.property_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = guide_access_logs.property_id AND p.owner_id = auth.uid()));

CREATE POLICY "Members can update guide access logs" ON public.guide_access_logs
  FOR UPDATE TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id))
  WITH CHECK (public.user_can_access_property(auth.uid(), property_id));