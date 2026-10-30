ALTER TABLE public.ai_precedents
  ADD COLUMN IF NOT EXISTS topic text,
  ADD COLUMN IF NOT EXISTS phases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS superseded_by uuid,
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS retired_reason text;
CREATE INDEX IF NOT EXISTS ai_precedents_topic_idx ON public.ai_precedents(owner_id, scope, topic) WHERE status = 'active';

DROP FUNCTION IF EXISTS public.match_ai_precedents(vector, uuid, uuid, integer);
CREATE FUNCTION public.match_ai_precedents(query_embedding vector, _owner_id uuid, _property_id uuid, match_count integer)
RETURNS TABLE(id uuid, scope text, property_id uuid, situation text, conduct text, example_reply text, why text, source text, confidence numeric, success_count integer, failure_count integer, similarity double precision, topic text, phases text[], updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.scope, p.property_id, p.situation, p.conduct, p.example_reply, p.why, p.source, p.confidence,
         p.success_count, p.failure_count, 1 - (p.embedding <=> query_embedding) AS similarity,
         p.topic, p.phases, p.updated_at
  FROM public.ai_precedents p
  WHERE p.status = 'active' AND p.embedding IS NOT NULL
    AND (p.scope = 'global'
      OR (p.scope = 'tenant' AND p.owner_id = _owner_id)
      OR (p.scope = 'property' AND p.owner_id = _owner_id AND p.property_id = _property_id))
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count
$$;
REVOKE EXECUTE ON FUNCTION public.match_ai_precedents(vector, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_ai_precedents(vector, uuid, uuid, integer) TO service_role;