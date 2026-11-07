-- REGISTRO HISTÓRICO — GATE G1b (já aplicada; nada a executar).
-- Aplicada pelo titular no editor SQL do Lovable Cloud em 06/11/2026 (passo 3 do G1), depois do merge do PR #5
-- (`main` 9b1fa07f) e com o build 1794011207760 (00:26:47 UTC de 07/11/2026) no ar; conferida com
-- `ops/copilot-g1/02-check-g1b.sql`. Conteúdo abaixo idêntico, byte a byte, a `ops/copilot-g1/g1b-revoke-legacy.sql`
-- (teste `copilot-g1.test.ts`). Idempotente: reaplicar não altera nada.

-- ConciergeIA Guest AI · GATE G1b — REVOGAÇÃO DAS RPCs LEGADAS DO COPILOTO (decisão do titular D2, 06/11/2026).
--
-- APLICAR SOMENTE DEPOIS de: (1) a G1a (`supabase/migrations/20261107000000_copilot_g1a_actor_rpcs.sql`)
-- aplicada e conferida; (2) o PR do G1 mergeado e o build novo NO AR (as Server Functions passam a usar
-- `copilot_actor_*`). Aplicada antes disso, a UI do Copiloto (editar/descartar/enviar) para de funcionar.
--
-- Efeito: as 5 RPCs antigas (autoria por `auth.uid()`, EXECUTE para `authenticated`) deixam de existir.
-- Nenhuma chamada direta do navegador consegue mais editar, descartar ou mudar o estado de envio de uma sugestão.
-- Idempotente (`drop function if exists`). Nada aqui agenda, ativa ou chama serviço externo.

do $pre$
begin
  if to_regprocedure('public.copilot_actor_edit(uuid, uuid, text)') is null
     or to_regprocedure('public.copilot_actor_discard(uuid, uuid)') is null
     or to_regprocedure('public.copilot_actor_claim_send(uuid, uuid, text)') is null
     or to_regprocedure('public.copilot_actor_finish_send(uuid, uuid, uuid, text, uuid, text, text, text)') is null
     or to_regprocedure('public.copilot_actor_reconcile_send(uuid, uuid, boolean, text)') is null then
    raise exception 'COPILOT_G1B_PRE: G1a não aplicada; nada foi alterado';
  end if;
end $pre$;

drop function if exists public.copilot_edit(uuid, text);
drop function if exists public.copilot_discard(uuid);
drop function if exists public.copilot_claim_send(uuid, text);
drop function if exists public.copilot_finish_send(uuid, uuid, text, uuid, text, text, text);
drop function if exists public.copilot_reconcile_send(uuid, boolean, text);

do $post$
declare
  r record;
begin
  -- nenhuma função do Copiloto executável por anon/authenticated
  for r in
    select p.oid::regprocedure::text as f
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'copilot%' or p.proname like 'guest_ai_copilot%')
  loop
    if has_function_privilege('anon', r.f, 'EXECUTE') or has_function_privilege('authenticated', r.f, 'EXECUTE') then
      raise exception 'COPILOT_G1B_POS: % ainda executável por anon/authenticated', r.f;
    end if;
  end loop;
end $post$;
