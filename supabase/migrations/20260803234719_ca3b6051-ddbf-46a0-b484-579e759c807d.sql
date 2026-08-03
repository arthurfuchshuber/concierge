ALTER TABLE public.ai_agent_logs
  ADD COLUMN IF NOT EXISTS plan jsonb,
  ADD COLUMN IF NOT EXISTS reflection jsonb,
  ADD COLUMN IF NOT EXISTS prompt_versions jsonb,
  ADD COLUMN IF NOT EXISTS confidence_tier text,
  ADD COLUMN IF NOT EXISTS source_weight numeric;