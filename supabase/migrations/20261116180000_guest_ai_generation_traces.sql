-- RASTRO DAS GERAÇÕES DA IA (16/11/2026, auditoria): uma linha por geração com tempo total, tentativas, motivo da
-- nova tentativa, desfecho e etapa da falha. Só números e códigos fechados (nenhum texto do hóspede ou do modelo).
-- Gravada só pela função `copilot_record_trace` (o módulo da IA não escreve em tabela); sem acesso pelo app.
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

create or replace function public.copilot_record_trace(p_trace jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_trace is null or jsonb_typeof(p_trace) <> 'object' then return; end if;
  insert into public.guest_ai_generation_traces
    (suggestion_id, autonomous, total_ms, attempts, retry_reason, final_kind, final_code, failed_stage, remaining_ms, tool_rounds)
  values (
    (p_trace->>'suggestion_id')::uuid,
    coalesce((p_trace->>'autonomous')::boolean, false),
    (p_trace->>'total_ms')::integer,
    (p_trace->>'attempts')::smallint,
    nullif(p_trace->>'retry_reason', ''),
    nullif(p_trace->>'final_kind', ''),
    nullif(p_trace->>'final_code', ''),
    nullif(p_trace->>'failed_stage', ''),
    (p_trace->>'remaining_ms')::integer,
    (p_trace->>'tool_rounds')::smallint
  );
end $$;
revoke all on function public.copilot_record_trace(jsonb) from public, anon, authenticated;
grant execute on function public.copilot_record_trace(jsonb) to service_role;

-- FECHA GERAÇÕES PRESAS a cada 5 min, mesmo sem movimento (o expurgo oportunista do claim só rodava quando chegava
-- outra geração). Mesmo critério e mesmos campos de `copilot_claim_generation` (> 90 s em `generating`).
-- Também apaga rastros com mais de 30 dias. SQL puro, sem chamada HTTP. Idempotente.
SELECT cron.unschedule('copilot-geracoes-presas-5min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'copilot-geracoes-presas-5min');

SELECT cron.schedule(
  'copilot-geracoes-presas-5min',
  '*/5 * * * *',
  $$
  update public.guest_ai_copilot_suggestions
     set updated_at = now(), state = 'generation_failed', outcome_kind = 'technical_error',
         outcome_code = 'generation_timeout', generation_finished_at = now()
   where state = 'generating' and generation_started_at < now() - interval '90 seconds';
  delete from public.guest_ai_generation_traces where created_at < now() - interval '30 days';
  $$
);
