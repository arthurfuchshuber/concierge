CREATE INDEX IF NOT EXISTS poi_engagement_prop_created_idx ON public.poi_engagement_events (property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_feedback_property_created_idx ON public.chat_message_feedback (property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS city_daily_news_key_date_idx ON public.city_daily_news (city_key, date DESC);