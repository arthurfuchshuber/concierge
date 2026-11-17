-- RASTRO DAS GERAÇÕES DA IA (16/11/2026, auditoria): uma linha por geração com tempo total, tentativas, motivo da
-- nova tentativa, desfecho e etapa da falha. Só números e códigos fechados (nenhum texto do hóspede ou do modelo).
-- Gravada só pela função `guest_ai_record_trace` (o módulo da IA não escreve em tabela); sem acesso pelo app.
create table if not exists public.guest_ai_generation_traces (
  id bigint generated always as identity primary key,
  suggestion_id uuid not null,
  created_at timestamptz not null default now(),
  autonomous boolean not null,
  total_ms integer check (total_ms is null or total_ms >= 0),
  attempts smallint check (attempts is null or attempts between 0 and 10),
  retry_reason text check (retry_reason is null or retry_reason ~ '^[a-z0-9_ ,]{1,200}$'),
  final_kind text check (final_kind is null or final_kind ~ '^[a-z_]{1,40}$'),
  final_code text check (final_code is null or final_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  failed_stage text check (failed_stage is null or failed_stage ~ '^[a-z_]{1,40}$'),
  remaining_ms integer,
  tool_rounds smallint
);
create index if not exists guest_ai_generation_traces_created_idx on public.guest_ai_generation_traces (created_at desc);
create index if not exists guest_ai_generation_traces_suggestion_idx on public.guest_ai_generation_traces (suggestion_id);
alter table public.guest_ai_generation_traces enable row level security;
revoke all on public.guest_ai_generation_traces from public, anon, authenticated;
grant select on public.guest_ai_generation_traces to service_role;
