-- Cartão obrigatório para toda conta (inclusive isenta) + verificação mensal no dia 20.
-- O dia 20 antecede em 5 dias o vencimento do dia 25: dá tempo de a pessoa trocar o cartão
-- antes de uma cobrança falhar. Só o servidor (service role) lê e grava esta tabela.
begin;

create table if not exists public.account_card_checks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  environment text not null default 'live',
  stripe_customer_id text,
  -- ok = cartão verificado; failed = a última verificação foi recusada; missing = sem cartão
  status text not null default 'missing' check (status in ('ok', 'failed', 'missing')),
  checked_at timestamptz,
  failure_message text,
  updated_at timestamptz not null default now()
);

alter table public.account_card_checks enable row level security;
-- Sem políticas: nenhum acesso direto pelo navegador.

create index if not exists idx_account_card_checks_customer on public.account_card_checks (stripe_customer_id);

create or replace function public.kick_card_check()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/card-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
exception when others then
  null;
end;
$$;

-- Todo dia 20, 09:00 / 10:00 / 11:00 em Brasília (12-14 UTC). As repetições só continuam o que
-- sobrou: o processador ignora quem foi verificado nas últimas 12 horas.
select cron.unschedule(jobid) from cron.job where jobname = 'card-check-monthly';
select cron.schedule('card-check-monthly', '0 12-14 20 * *', $cron$ select public.kick_card_check(); $cron$);

commit;
