ALTER TABLE public.property_listing_raw_data
  ADD COLUMN IF NOT EXISTS airbnb_ai_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS airbnb_ai_toggled_at timestamptz,
  ADD COLUMN IF NOT EXISTS airbnb_ai_toggled_by uuid;
CREATE INDEX IF NOT EXISTS idx_plrd_channex_property ON public.property_listing_raw_data(channex_property_id);