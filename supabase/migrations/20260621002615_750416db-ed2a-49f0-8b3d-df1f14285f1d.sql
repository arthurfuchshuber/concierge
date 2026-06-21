ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS max_guides_override integer;

COMMENT ON COLUMN public.subscriptions.max_guides_override IS
  'When set, overrides PLANS[plan].maxGuides for this subscription. Used for custom Enterprise contracts.';