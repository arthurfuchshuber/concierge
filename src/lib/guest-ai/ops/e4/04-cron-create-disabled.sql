-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · AGENDAMENTO DO TICK — criado DESABILITADO (GATE B).
-- NÃO EXECUTAR sem a autorização específica do GATE B. Mesmo depois de executado, o job nasce
-- INATIVO (schedule + alter_job na MESMA transação: o agendador nunca vê o job ativo) e o tick continua
-- barrado por: chave GUEST_AI_SHADOW, segredo de cron, portão SHADOW_TICK_RELEASED=false (código),
-- estado global ≠ running e escopo de imóveis `none`.
-- Padrão idêntico aos crons existentes da produção (pg_cron → pg_net → rota pública com x-cron-secret
-- lido do Vault `cron_secret`). Frequência de referência: 60 s. A trava global (55 s) impede sobreposição
-- mesmo que dois disparos se cruzem; o próximo disparo com a trava vigente sai com `tick_busy`.
begin;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'guest-ai-shadow-tick') then
    raise exception 'job guest-ai-shadow-tick já existe; conferir antes de recriar' using errcode = 'P0001';
  end if;
end $$;
select cron.schedule(
  'guest-ai-shadow-tick',
  '* * * * *',
  $cmd$
  select net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/guest-ai/shadow-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    -- o tick pode levar até 55 s (3 conversas × 15 s + reconciliação): o cliente espera até 60 s
    timeout_milliseconds := 60000
  );
  $cmd$
);
select cron.alter_job((select jobid from cron.job where jobname = 'guest-ai-shadow-tick'), active := false);
-- prova dentro da transação: o job existe e está INATIVO
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'guest-ai-shadow-tick' and active = false) then
    raise exception 'job não ficou inativo; transação desfeita' using errcode = 'P0001';
  end if;
end $$;
commit;
