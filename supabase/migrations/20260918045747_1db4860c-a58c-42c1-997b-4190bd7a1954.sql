ALTER PUBLICATION supabase_realtime DROP TABLE public.guide_access_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.guide_access_logs (id, property_id, checkin_date, checkout_date, created_at);
ALTER PUBLICATION supabase_realtime DROP TABLE public.property_owners;
ALTER PUBLICATION supabase_realtime ADD TABLE public.property_owners (id, account_owner_id, status, created_at, updated_at);
ALTER PUBLICATION supabase_realtime DROP TABLE public.service_providers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.service_providers (id, account_owner_id, member_user_id, status, created_at, updated_at);