-- TURNO DA IA EM REQUISIÇÃO PRÓPRIA (17/11/2026). O processamento do webhook da Channex é encerrado pela plataforma
-- em ~30 s, o que obrigava a IA a responder em 26 s e cortava o raciocínio. O webhook passa a pedir ao banco que
-- dispare o turno em /api/public/ia/turno; o pg_net mantém a conexão aberta por até 150 s, e a requisição do turno
-- vive o tempo que precisar (prazos de `LONG_TURN` no código). Mesmo segredo (`cron_secret` do Vault) dos crons.
-- Só o service_role chama; retorna o id do pedido no pg_net. Idempotente.
create or replace function public.dispatch_guest_ai_turn(p_turn jsonb)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_secret text;
  v_id bigint;
begin
  if p_turn is null or jsonb_typeof(p_turn) <> 'object' then
    raise exception 'dispatch_guest_ai_turn: turno inválido';
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_secret is null then
    raise exception 'dispatch_guest_ai_turn: cron_secret ausente';
  end if;
  select net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/ia/turno',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := p_turn,
    timeout_milliseconds := 150000
  ) into v_id;
  return v_id;
end $$;
revoke all on function public.dispatch_guest_ai_turn(jsonb) from public, anon, authenticated;
grant execute on function public.dispatch_guest_ai_turn(jsonb) to service_role;
