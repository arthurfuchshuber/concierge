
-- Members can read properties of accounts they belong to
CREATE POLICY "properties member read"
ON public.properties FOR SELECT
TO authenticated
USING (public.is_account_member(auth.uid(), owner_id));

-- Members can read guide access logs of properties they can access
CREATE POLICY "guide_access_logs member read"
ON public.guide_access_logs FOR SELECT
TO authenticated
USING (public.user_can_access_property(auth.uid(), property_id));

-- Members can read reservations of properties they can access
CREATE POLICY "property_reservations member read"
ON public.property_reservations FOR SELECT
TO authenticated
USING (public.user_can_access_property(auth.uid(), property_id));

-- Members can read section events (guide analytics) for properties they can access
CREATE POLICY "guide_section_events member read"
ON public.guide_section_events FOR SELECT
TO authenticated
USING (public.user_can_access_property(auth.uid(), property_id));
