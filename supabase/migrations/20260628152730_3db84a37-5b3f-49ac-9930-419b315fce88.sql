-- Restore anon SELECT on city_references.property_id so that Postgres
-- Realtime postgres_changes filters of the form `property_id=eq.<id>`
-- work for the public guide (anon role). RLS still gates which rows are
-- delivered (is_hidden = false), and the public loader continues to
-- project only safe columns.
GRANT SELECT (property_id) ON public.city_references TO anon;