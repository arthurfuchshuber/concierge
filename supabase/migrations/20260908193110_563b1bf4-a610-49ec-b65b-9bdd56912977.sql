grant execute on function public.match_ai_system_docs(vector, int) to authenticated;
grant execute on function public.search_ai_system_docs_text(text, int) to authenticated;

alter table public.task_completions
  add column if not exists resolved_by_provider_id uuid references public.service_providers(id) on delete set null,
  add column if not exists resolution_note text;