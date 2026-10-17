-- 17/10/2026: calendário do Airbnb IMPORTADO (somente leitura): disponibilidade, bloqueios manuais,
-- reservas e restrições/preços como estão na plataforma. O sistema não envia preço nem disponibilidade.
create table if not exists public.channex_calendar_import (
  rate_plan_id text not null,
  date date not null,
  property_id uuid references public.properties(id) on delete cascade,
  channex_property_id text,
  room_type_id text,
  availability integer,
  booked integer,
  stop_sell boolean,
  rate numeric(12,2),
  min_stay integer,
  max_stay integer,
  closed_to_arrival boolean,
  closed_to_departure boolean,
  source text not null default 'webhook',
  synced_at timestamptz not null default now(),
  primary key (rate_plan_id, date)
);
create index if not exists channex_calendar_import_prop_idx on public.channex_calendar_import (property_id, date);
alter table public.channex_calendar_import enable row level security;
grant all on public.channex_calendar_import to service_role;
grant select on public.channex_calendar_import to authenticated;
drop policy if exists "calendar_import_select" on public.channex_calendar_import;
create policy "calendar_import_select" on public.channex_calendar_import for select to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()));
