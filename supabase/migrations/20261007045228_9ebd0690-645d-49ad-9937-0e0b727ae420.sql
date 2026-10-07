CREATE TABLE public.property_listing_raw_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL UNIQUE REFERENCES public.properties(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'channex_airbnb',
  channex_channel_id text,
  channex_property_id text,
  channex_room_type_id text,
  channex_rate_plan_id text,
  airbnb_listing_id text NOT NULL,
  listing_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.property_listing_raw_data TO authenticated;
GRANT ALL ON public.property_listing_raw_data TO service_role;
ALTER TABLE public.property_listing_raw_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner, members and admins read listing data"
ON public.property_listing_raw_data FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.member_can_see_property(auth.uid(), owner_id, property_id)
);
CREATE INDEX idx_plrd_listing ON public.property_listing_raw_data(airbnb_listing_id);