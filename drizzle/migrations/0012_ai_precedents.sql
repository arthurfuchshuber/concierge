CREATE TABLE public.ai_precedents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant' CHECK (scope IN ('global','tenant','property')),
  owner_id uuid,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  situation text NOT NULL,
  conduct text NOT NULL,
  example_guest text,
  example_reply text,
  why text,
  source text NOT NULL DEFAULT 'autonomous_success' CHECK (source IN ('autonomous_success','human_answer','curated')),
  source_ref text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  confidence numeric NOT NULL DEFAULT 0.7,
  success_count integer NOT NULL DEFAULT 1,
  failure_count integer NOT NULL DEFAULT 0,
  used_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  embedding vector(3072),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_precedents_owner_idx ON public.ai_precedents(owner_id, status);
CREATE UNIQUE INDEX ai_precedents_source_ref_uq ON public.ai_precedents(owner_id, source, source_ref) WHERE source_ref IS NOT NULL;

GRANT SELECT, UPDATE ON public.ai_precedents TO authenticated;
GRANT ALL ON public.ai_precedents TO service_role;
ALTER TABLE public.ai_precedents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read precedents" ON public.ai_precedents FOR SELECT TO authenticated
  USING (scope = 'global' OR owner_id = auth.uid() OR public.is_account_member(auth.uid(), owner_id));
CREATE POLICY "owners retire precedents" ON public.ai_precedents FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.match_ai_precedents(query_embedding vector, _owner_id uuid, _property_id uuid, match_count integer)
RETURNS TABLE(id uuid, scope text, property_id uuid, situation text, conduct text, example_reply text, why text, source text, confidence numeric, success_count integer, failure_count integer, similarity double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.scope, p.property_id, p.situation, p.conduct, p.example_reply, p.why, p.source, p.confidence,
         p.success_count, p.failure_count, 1 - (p.embedding <=> query_embedding) AS similarity
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