REVOKE EXECUTE ON FUNCTION public.match_ai_memories(public.vector, uuid, uuid, text, integer) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.search_ai_memories_text(text, uuid, uuid, text, integer) FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION public.match_ai_memories(public.vector, uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_ai_memories_text(text, uuid, uuid, text, integer) TO service_role;