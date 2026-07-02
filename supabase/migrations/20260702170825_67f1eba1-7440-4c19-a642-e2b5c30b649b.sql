-- Enrich profiles with CPF and phone (mandatory SaaS customer registration fields).
alter table public.profiles
  add column if not exists cpf text,
  add column if not exists phone text,
  add column if not exists phone_country text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_cpf_digits_chk'
  ) then
    alter table public.profiles
      add constraint profiles_cpf_digits_chk check (cpf is null or cpf ~ '^[0-9]{11}$') not valid;
  end if;
end $$;

-- Create guide_section_events for real-time guest behavior tracking.
create table if not exists public.guide_section_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  section text not null,
  guest_session_id text,
  guest_name text,
  guest_phone text,
  page_path text,
  created_at timestamptz not null default now()
);

grant select on public.guide_section_events to authenticated;
grant all on public.guide_section_events to service_role;

create index if not exists guide_section_events_property_idx
  on public.guide_section_events (property_id, created_at desc);
create index if not exists guide_section_events_session_idx
  on public.guide_section_events (guest_session_id, created_at desc);

alter table public.guide_section_events enable row level security;

drop policy if exists "guide_section_events owner select" on public.guide_section_events;
create policy "guide_section_events owner select"
  on public.guide_section_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = guide_section_events.property_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists "guide_section_events deny client writes" on public.guide_section_events;
create policy "guide_section_events deny client writes"
  on public.guide_section_events
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'guide_section_events'
  ) then
    execute 'alter publication supabase_realtime add table public.guide_section_events';
  end if;
end $$;