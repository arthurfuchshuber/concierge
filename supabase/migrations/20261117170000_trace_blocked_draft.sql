-- RESPOSTA BARRADA NO RASTRO (17/11/2026, auditoria; caso Marcela "tem porteiro?"): quando os validadores barram a
-- resposta, o rastro guarda o texto que o modelo escreveu (só se o guard de saída o considerou sem credencial) e os
-- bloqueios/afirmações detectadas. Sem isso, cada bloqueio indevido exigia adivinhar a frase. Só o service_role lê.
alter table public.guest_ai_generation_traces add column if not exists blocked_reply text;
alter table public.guest_ai_generation_traces add column if not exists blocked_detail text;

create or replace function public.copilot_record_trace(p_trace jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_trace is null or jsonb_typeof(p_trace) <> 'object' then return; end if;
  insert into public.guest_ai_generation_traces
    (suggestion_id, autonomous, total_ms, attempts, retry_reason, final_kind, final_code, failed_stage, remaining_ms, tool_rounds, blocked_reply, blocked_detail)
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
    (p_trace->>'tool_rounds')::smallint,
    left(nullif(p_trace->>'blocked_reply', ''), 2000),
    left(nullif(p_trace->>'blocked_detail', ''), 500)
  );
end $$;
revoke all on function public.copilot_record_trace(jsonb) from public, anon, authenticated;
grant execute on function public.copilot_record_trace(jsonb) to service_role;
