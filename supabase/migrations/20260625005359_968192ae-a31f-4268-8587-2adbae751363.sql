do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'city_references'
  ) then
    alter publication supabase_realtime add table public.city_references;
  end if;
end $$;