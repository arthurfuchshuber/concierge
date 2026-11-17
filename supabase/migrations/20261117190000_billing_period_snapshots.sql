-- Registro mensal do corte de cobrança (dia 25, 00:00 de Brasília), mesmo para conta isenta.
-- Guarda quantos anúncios ativos o cliente tinha no corte e o valor que valia naquele mês, para o extrato
-- mostrar sempre o valor exato do mês, sem mudanças retroativas. Só o servidor (service_role) lê e grava.
begin;

create table if not exists public.billing_period_snapshots (
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- Data do corte (dia 25, em Brasília).
  period_date date not null,
  active_listings integer not null check (active_listings >= 0),
  billed_units integer not null default 0,
  unit_cents integer not null default 0,
  monthly_cents integer not null default 0,
  exempt boolean not null default false,
  courtesy boolean not null default false,
  -- Condições do contrato vigentes no corte (valor negociado, piso).
  terms jsonb not null default '{}'::jsonb,
  -- Nomes dos anúncios ativos no corte (conferência).
  listing_names text[] not null default '{}',
  source text not null default 'cron',
  created_at timestamptz not null default now(),
  primary key (owner_id, period_date)
);

alter table public.billing_period_snapshots enable row level security;
revoke all on public.billing_period_snapshots from anon, authenticated;
grant all on public.billing_period_snapshots to service_role;

create or replace function public.kick_billing_snapshot()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/billing-snapshot',
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

-- Todo dia 25 às 00:05, 01:05 e 02:05 em Brasília (03:05, 04:05 e 05:05 UTC). As repetições não duplicam: cada
-- conta tem no máximo uma linha por corte.
select cron.unschedule(jobid) from cron.job where jobname = 'billing-snapshot-monthly';
select cron.schedule('billing-snapshot-monthly', '5 3-5 25 * *', $cron$ select public.kick_billing_snapshot(); $cron$);

commit;
