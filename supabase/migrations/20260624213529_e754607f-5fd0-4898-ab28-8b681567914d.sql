
ALTER TABLE public.subscriptions 
  ADD COLUMN IF NOT EXISTS billing_anchor_day integer,
  ADD COLUMN IF NOT EXISTS enterprise_request boolean DEFAULT false;
