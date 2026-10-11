CREATE TABLE public.channex_twin_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  channel_id text NOT NULL,
  primary_listing_id text NOT NULL,
  primary_title text,
  primary_channex_property_id text NOT NULL,
  primary_room_type_id text NOT NULL,
  primary_rate_plan_id text NOT NULL,
  twin_listing_id text NOT NULL UNIQUE,
  twin_title text,
  twin_channex_property_id text NOT NULL,
  twin_room_type_id text NOT NULL,
  twin_rate_plan_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_sync_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX channex_twin_links_property_idx ON public.channex_twin_links(property_id);
CREATE INDEX channex_twin_links_owner_idx ON public.channex_twin_links(owner_id);

GRANT SELECT ON public.channex_twin_links TO authenticated;
GRANT ALL ON public.channex_twin_links TO service_role;

ALTER TABLE public.channex_twin_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Twin links visible to owner, members and admins"
  ON public.channex_twin_links FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR owner_id = auth.uid()
    OR (owner_id IS NOT NULL AND public.is_account_member(auth.uid(), owner_id))
  );