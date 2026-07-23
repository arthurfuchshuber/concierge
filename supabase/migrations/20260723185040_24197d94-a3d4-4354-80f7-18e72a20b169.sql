UPDATE public.guide_access_logs
SET checkout_date = checkin_date + INTERVAL '1 day'
WHERE checkout_date IS NULL;