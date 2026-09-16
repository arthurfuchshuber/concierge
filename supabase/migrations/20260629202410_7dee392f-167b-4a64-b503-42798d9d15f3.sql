
-- 1. city_references: hide property_id from anon while keeping it for authenticated
REVOKE SELECT ON public.city_references FROM anon;
GRANT SELECT (id, city_key, city_label, state, country, category, type, place_id, name, note, address, rating, user_ratings_total, primary_type, lat, lng, image_url, maps_url, opening_hours, source, is_hidden, display_order, last_synced_at, created_at, updated_at, group_id) ON public.city_references TO anon;

-- 2. Set fixed search_path on email queue helper functions
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;

-- 3. Revoke anon EXECUTE on SECURITY DEFINER functions that are not meant to be public
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_owns_property_in_city(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_is_group_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
