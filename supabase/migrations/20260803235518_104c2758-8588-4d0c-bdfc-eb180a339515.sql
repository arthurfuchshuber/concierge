-- ===== Memory Architecture: long-term memory =====
CREATE TABLE public.ai_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'guest',            -- guest | property | owner | provider | team | global
  subject_key text,                                -- guest_key, provider id, etc
  guest_name text,
  kind text NOT NULL DEFAULT 'fact',               -- preference | issue | resolution | property_fact | operational_decision | fact
  category text,                                   -- manutencao | limpeza | acesso | reserva | cidade | outro
  title text,
  content text NOT NULL,
  source text NOT NULL DEFAULT 'conversation',
  source_ref text,
  importance numeric NOT NULL DEFAULT 0.5,
  confidence numeric NOT NULL DEFAULT 0.7,
  occurrences integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding public.vector(3072),
  content_hash text,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(title,'') || ' ' || content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_memories TO authenticated;
GRANT ALL ON public.ai_memories TO service_role;
ALTER TABLE public.ai_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their AI memories"
  ON public.ai_memories FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.is_account_member(auth.uid(), owner_id))
  WITH CHECK (owner_id = auth.uid() OR public.is_account_member(auth.uid(), owner_id));

CREATE INDEX ai_memories_owner_idx ON public.ai_memories (owner_id, scope, subject_key);
CREATE INDEX ai_memories_property_idx ON public.ai_memories (property_id, kind);
CREATE INDEX ai_memories_tsv_idx ON public.ai_memories USING gin (tsv);
CREATE INDEX ai_memories_last_seen_idx ON public.ai_memories (last_seen_at DESC);
CREATE UNIQUE INDEX ai_memories_dedupe_idx
  ON public.ai_memories (owner_id, coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid), scope, coalesce(subject_key,''), content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TRIGGER ai_memories_touch BEFORE UPDATE ON public.ai_memories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== Operational Memory Layer =====
CREATE TABLE public.ai_operational_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  conversation_id uuid,
  guest_key text,
  guest_name text,
  category text NOT NULL DEFAULT 'outro',
  request text NOT NULL,
  provider_id uuid,
  provider_name text,
  resolution text,
  resolution_minutes integer,
  recurrence_count integer NOT NULL DEFAULT 1,
  satisfaction text,
  status text NOT NULL DEFAULT 'open',   -- open | in_progress | resolved | cancelled
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_operational_memory TO authenticated;
GRANT ALL ON public.ai_operational_memory TO service_role;
ALTER TABLE public.ai_operational_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their operational memory"
  ON public.ai_operational_memory FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.is_account_member(auth.uid(), owner_id))
  WITH CHECK (owner_id = auth.uid() OR public.is_account_member(auth.uid(), owner_id));

CREATE INDEX ai_opmem_owner_idx ON public.ai_operational_memory (owner_id, property_id, category);
CREATE INDEX ai_opmem_created_idx ON public.ai_operational_memory (created_at DESC);

CREATE TRIGGER ai_operational_memory_touch BEFORE UPDATE ON public.ai_operational_memory
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== Auditoria expandida =====
ALTER TABLE public.ai_agent_logs
  ADD COLUMN IF NOT EXISTS memory_context_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS memories_retrieved jsonb,
  ADD COLUMN IF NOT EXISTS memory_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS guest_context_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS operational_context_snapshot jsonb;

-- ===== Memory Retrieval =====
CREATE OR REPLACE FUNCTION public.match_ai_memories(
  query_embedding public.vector,
  _owner_id uuid,
  _property_id uuid DEFAULT NULL,
  _subject_key text DEFAULT NULL,
  match_count integer DEFAULT 8
)
RETURNS TABLE(
  id uuid, scope text, subject_key text, kind text, category text, title text,
  content text, source text, importance numeric, confidence numeric,
  last_seen_at timestamptz, property_id uuid, similarity double precision
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT m.id, m.scope, m.subject_key, m.kind, m.category, m.title, m.content, m.source,
         m.importance, m.confidence, m.last_seen_at, m.property_id,
         1 - (m.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) AS similarity
  FROM public.ai_memories m
  WHERE m.owner_id = _owner_id
    AND m.embedding IS NOT NULL
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND (m.property_id IS NULL OR _property_id IS NULL OR m.property_id = _property_id)
    AND (_subject_key IS NULL OR m.subject_key IS NULL OR m.subject_key = _subject_key OR m.scope <> 'guest')
  ORDER BY m.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION public.search_ai_memories_text(
  _query text,
  _owner_id uuid,
  _property_id uuid DEFAULT NULL,
  _subject_key text DEFAULT NULL,
  match_count integer DEFAULT 8
)
RETURNS TABLE(
  id uuid, scope text, subject_key text, kind text, category text, title text,
  content text, source text, importance numeric, confidence numeric,
  last_seen_at timestamptz, property_id uuid, rank real
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT m.id, m.scope, m.subject_key, m.kind, m.category, m.title, m.content, m.source,
         m.importance, m.confidence, m.last_seen_at, m.property_id,
         ts_rank(m.tsv, websearch_to_tsquery('portuguese', _query)) AS rank
  FROM public.ai_memories m
  WHERE m.owner_id = _owner_id
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND (m.property_id IS NULL OR _property_id IS NULL OR m.property_id = _property_id)
    AND (_subject_key IS NULL OR m.subject_key IS NULL OR m.subject_key = _subject_key OR m.scope <> 'guest')
    AND m.tsv @@ websearch_to_tsquery('portuguese', _query)
  ORDER BY rank DESC
  LIMIT match_count;
$$;

REVOKE EXECUTE ON FUNCTION public.match_ai_memories(public.vector, uuid, uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_ai_memories_text(text, uuid, uuid, text, integer) FROM anon;