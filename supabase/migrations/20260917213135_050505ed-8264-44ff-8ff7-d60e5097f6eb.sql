-- 1) poi_engagement_events: remove public insert path (all writes go through the server)
DROP POLICY IF EXISTS "Anyone can insert engagement events" ON public.poi_engagement_events;
REVOKE ALL ON public.poi_engagement_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.poi_engagement_events FROM authenticated;
GRANT SELECT ON public.poi_engagement_events TO authenticated;
GRANT ALL ON public.poi_engagement_events TO service_role;

-- 2) ai_system_docs: audience access must match the caller's actual role
CREATE OR REPLACE FUNCTION public.can_read_system_doc(_audience text[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select
    case
      when auth.uid() is null then false
      when public.has_role(auth.uid(), 'admin'::app_role) then true
      when public.has_role(auth.uid(), 'host'::app_role)
        then coalesce(_audience, '{}'::text[]) && array['all','public','host','owner']::text[]
      else coalesce(_audience, '{}'::text[]) && array['public']::text[]
    end
$function$;

REVOKE ALL ON public.ai_system_docs FROM anon;

-- Definer search functions must apply the same audience rule
CREATE OR REPLACE FUNCTION public.match_ai_system_docs(query_embedding vector, match_count integer DEFAULT 8)
RETURNS TABLE(id uuid, doc_key text, kind text, title text, content text, source_path text, audience text[], similarity double precision)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select d.id, d.doc_key, d.kind, d.title, d.content, d.source_path, d.audience,
         1 - (d.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) as similarity
  from public.ai_system_docs d
  where d.embedding is not null
    and public.can_read_system_doc(d.audience)
  order by d.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  limit match_count;
$function$;

CREATE OR REPLACE FUNCTION public.search_ai_system_docs_text(_query text, match_count integer DEFAULT 8)
RETURNS TABLE(id uuid, doc_key text, kind text, title text, content text, source_path text, audience text[], rank real)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select d.id, d.doc_key, d.kind, d.title, d.content, d.source_path, d.audience,
         ts_rank(d.tsv, websearch_to_tsquery('portuguese', _query)) as rank
  from public.ai_system_docs d
  where d.tsv @@ websearch_to_tsquery('portuguese', _query)
    and public.can_read_system_doc(d.audience)
  order by rank desc
  limit match_count;
$function$;
