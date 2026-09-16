
-- 1) ai_system_docs: audience-aware read policy
create or replace function public.can_read_system_doc(_audience text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'admin'::app_role)
      or coalesce(_audience, '{}'::text[]) && array['all','public','host','owner','provider']::text[]
$$;

drop policy if exists "system docs read" on public.ai_system_docs;
create policy "system docs read"
  on public.ai_system_docs
  for select
  to authenticated
  using (public.can_read_system_doc(audience));

-- 2) ai_global_intelligence: hide evidence/metadata columns from regular users
revoke select on public.ai_global_intelligence from authenticated;
grant select (
  id, title, insight, category, source_conversations, source_tenants,
  confidence, impact_estimate, impact_percentage, status, published_at,
  created_by, created_at, updated_at
) on public.ai_global_intelligence to authenticated;
grant all on public.ai_global_intelligence to service_role;
