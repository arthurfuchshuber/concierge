-- 17/10/2026: envio de volta (sistema -> Airbnb via Channex). Toda alteração fica registrada
-- (antes/depois, pedido, resposta), para auditoria e desfazer.
create table if not exists public.channex_writeback_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  owner_id uuid,
  user_id uuid,
  source text not null default 'system',
  operation text not null,
  request jsonb,
  before jsonb,
  after jsonb,
  status text not null default 'pending',
  http_status integer,
  response jsonb,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists channex_writeback_log_property_idx on public.channex_writeback_log (property_id, created_at desc);
alter table public.channex_writeback_log enable row level security;
grant all on public.channex_writeback_log to service_role;
grant select on public.channex_writeback_log to authenticated;
drop policy if exists "writeback_log_owner_select" on public.channex_writeback_log;
create policy "writeback_log_owner_select" on public.channex_writeback_log for select using (owner_id = auth.uid());
