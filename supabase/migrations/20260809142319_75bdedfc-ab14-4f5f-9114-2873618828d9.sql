REVOKE ALL ON public.guest_arrival_status FROM anon;
REVOKE ALL ON public.property_owners FROM anon;
REVOKE ALL ON public.service_providers FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_arrival_status TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_owners TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_providers TO authenticated;
GRANT ALL ON public.guest_arrival_status TO service_role;
GRANT ALL ON public.property_owners TO service_role;
GRANT ALL ON public.service_providers TO service_role;