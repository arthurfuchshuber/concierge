UPDATE public.subscriptions
SET is_manual = true,
    updated_at = now()
WHERE is_manual = false
  AND (
    paddle_subscription_id LIKE 'manual_%'
    OR paddle_customer_id LIKE 'manual_%'
  );