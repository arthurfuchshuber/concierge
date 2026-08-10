ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS airbnb_ical_url_2 text;
ALTER TABLE public.property_reservations ADD COLUMN IF NOT EXISTS feed_index smallint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_property_reservations_feed ON public.property_reservations (property_id, feed_index);