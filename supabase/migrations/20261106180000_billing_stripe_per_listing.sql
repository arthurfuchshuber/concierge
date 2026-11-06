-- Cobrança 100% Stripe, por anúncio conectado ativo (autorizado pelo titular em 06/11/2026).
--
-- 1) `subscriptions`: sai o provedor anterior, entram as colunas da Stripe.
--    - Liberações manuais (admin) continuam como `is_manual = true`, sem ids da Stripe.
--    - Assinaturas do provedor anterior viram histórico `canceled` (o acesso vai até o fim do
--      período já registrado); o cliente volta a assinar pela Stripe.
-- 2) `billing_sync_queue` + gatilhos: qualquer mudança que altere os anúncios cobrados de uma
--    conta enfileira a conta e dispara o processamento na hora (pg_net, após o commit). O cron só
--    chama o processador quando há item vencido na fila.
-- Backup das linhas anteriores e script de volta: doc do projeto
-- `claude/stripe-migracao-backup-2026-11-06.md`.

begin;

-- ───────────────────────── 1. subscriptions ─────────────────────────

alter table public.subscriptions
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists listing_quantity integer;

-- Assinaturas reais do provedor anterior: encerradas (o titular cancela no painel antigo).
update public.subscriptions
   set status = 'canceled',
       cancel_at_period_end = false,
       billing_paused = false
 where coalesce(is_manual, false) = false
   and status <> 'canceled';

alter table public.subscriptions drop constraint if exists subscriptions_paddle_subscription_id_key;
drop index if exists public.idx_subscriptions_paddle_id;
alter table public.subscriptions
  drop column if exists paddle_subscription_id,
  drop column if exists paddle_customer_id,
  drop column if exists billing_anchor_day,
  drop column if exists enterprise_request,
  -- Substituídas por `billing_terms` (condição comercial por conta).
  drop column if exists custom_price_cents,
  drop column if exists custom_currency;

alter table public.subscriptions
  add constraint subscriptions_stripe_subscription_id_key unique (stripe_subscription_id);
create index if not exists idx_subscriptions_stripe_customer on public.subscriptions (stripe_customer_id);

comment on column public.subscriptions.stripe_subscription_id is 'Assinatura na Stripe (null = liberação manual do admin).';
comment on column public.subscriptions.listing_quantity is 'Quantidade cobrada na Stripe (anúncios conectados ativos; nunca 0).';
comment on column public.subscriptions.billing_paused is 'Cobrança pausada na Stripe (conta com zero anúncios ativos) ou pausa manual.';

-- ───────────────────────── 1b. condição comercial por conta ─────────────────────────
-- Sem linha = tabela oficial. Vale antes e depois de a conta assinar. Vencimento é sempre dia 25.
create table if not exists public.billing_terms (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  unit_cents integer check (unit_cents is null or unit_cents between 100 and 1000000),
  min_units integer check (min_units is null or min_units between 1 and 999),
  courtesy boolean not null default false,
  -- Fim da carência / início da cobrança: sempre um dia 25 às 00:00 de Brasília (03:00 UTC).
  billing_starts_at timestamptz check (
    billing_starts_at is null
    or (extract(day from billing_starts_at at time zone 'America/Sao_Paulo') = 25
        and (billing_starts_at at time zone 'America/Sao_Paulo')::time = '00:00')
  ),
  notes text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.billing_terms enable row level security;
revoke all on public.billing_terms from anon, authenticated;
comment on table public.billing_terms is 'Condição comercial negociada (Admin SaaS): valor por anúncio, piso, cortesia total e carência até um dia 25.';

-- ───────────────────────── 2. fila de sincronização ─────────────────────────

create table if not exists public.billing_sync_queue (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  locked_until timestamptz,
  last_error text
);
create index if not exists idx_billing_sync_queue_due on public.billing_sync_queue (next_attempt_at);
alter table public.billing_sync_queue enable row level security;
revoke all on public.billing_sync_queue from anon, authenticated;

-- Dispara o processador (uma vez por transação; o envio acontece só depois do commit).
create or replace function public.kick_billing_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('billing.kicked', true) = '1' then
    return;
  end if;
  perform set_config('billing.kicked', '1', true);
  begin
    perform net.http_post(
      url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/billing-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb
    );
  exception when others then
    -- Nunca derruba a transação do usuário; o cron de reserva processa a fila.
    null;
  end;
end;
$$;

create or replace function public.enqueue_billing_sync(_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if _owner_id is null then
    return;
  end if;
  insert into public.billing_sync_queue as q (owner_id, requested_at, next_attempt_at, attempts, last_error)
  values (_owner_id, clock_timestamp(), now(), 0, null)
  on conflict (owner_id) do update
     set requested_at = clock_timestamp(),
         next_attempt_at = now(),
         attempts = 0,
         last_error = null;
  perform public.kick_billing_sync();
end;
$$;

-- Reserva contas vencidas para um único processador (lock de 2 min).
create or replace function public.claim_billing_sync(_limit integer default 10)
returns table (owner_id uuid, requested_at timestamptz)
language sql
security definer
set search_path = public
as $$
  update public.billing_sync_queue q
     set locked_until = now() + interval '2 minutes',
         attempts = q.attempts + 1
   where q.owner_id in (
     select c.owner_id
       from public.billing_sync_queue c
      where c.next_attempt_at <= now()
        and (c.locked_until is null or c.locked_until < now())
      order by c.next_attempt_at
      limit greatest(1, least(_limit, 50))
      for update skip locked
   )
  returning q.owner_id, q.requested_at;
$$;

-- Conclui: sucesso remove (se não houve novo pedido no meio); falha reagenda com espera crescente.
create or replace function public.finish_billing_sync(_owner_id uuid, _requested_at timestamptz, _error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if _error is null then
    delete from public.billing_sync_queue
     where owner_id = _owner_id and requested_at <= _requested_at;
    update public.billing_sync_queue set locked_until = null where owner_id = _owner_id;
  else
    update public.billing_sync_queue
       set locked_until = null,
           last_error = left(_error, 500),
           next_attempt_at = now() + least(interval '1 hour', interval '1 minute' * power(2, least(attempts, 6)))
     where owner_id = _owner_id;
  end if;
end;
$$;

revoke all on function public.kick_billing_sync() from public, anon, authenticated;
revoke all on function public.enqueue_billing_sync(uuid) from public, anon, authenticated;
revoke all on function public.claim_billing_sync(integer) from public, anon, authenticated;
revoke all on function public.finish_billing_sync(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.enqueue_billing_sync(uuid) to service_role;
grant execute on function public.claim_billing_sync(integer) to service_role;
grant execute on function public.finish_billing_sync(uuid, timestamptz, text) to service_role;

-- ───────────────────────── 3. gatilhos ─────────────────────────

-- Anúncio principal: entrou, saiu, pausou/retomou a sincronização ou trocou de imóvel.
create or replace function public.trg_billing_sync_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.enqueue_billing_sync((select p.owner_id from public.properties p where p.id = old.property_id));
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.enqueue_billing_sync((select p.owner_id from public.properties p where p.id = new.property_id));
  end if;
  return null;
end;
$$;

drop trigger if exists billing_sync_listing_ins_del on public.property_listing_raw_data;
create trigger billing_sync_listing_ins_del
  after insert or delete on public.property_listing_raw_data
  for each row execute function public.trg_billing_sync_listing();

drop trigger if exists billing_sync_listing_upd on public.property_listing_raw_data;
create trigger billing_sync_listing_upd
  after update on public.property_listing_raw_data
  for each row
  when (
    old.airbnb_listing_id is distinct from new.airbnb_listing_id
    or old.sync_paused_at is distinct from new.sync_paused_at
    or old.property_id is distinct from new.property_id
  )
  execute function public.trg_billing_sync_listing();

-- Imóvel arquivado/desarquivado, trocado de conta ou excluído.
create or replace function public.trg_billing_sync_property()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.enqueue_billing_sync(old.owner_id);
  end if;
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    perform public.enqueue_billing_sync(new.owner_id);
  end if;
  return null;
end;
$$;

drop trigger if exists billing_sync_property_upd on public.properties;
create trigger billing_sync_property_upd
  after update on public.properties
  for each row
  when (old.archived_at is distinct from new.archived_at or old.owner_id is distinct from new.owner_id)
  execute function public.trg_billing_sync_property();

drop trigger if exists billing_sync_property_del on public.properties;
create trigger billing_sync_property_del
  after delete on public.properties
  for each row execute function public.trg_billing_sync_property();

-- Anúncio gêmeo: vinculado, desvinculado ou mudou de situação.
create or replace function public.trg_billing_sync_twin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.enqueue_billing_sync(old.owner_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    perform public.enqueue_billing_sync(new.owner_id);
  end if;
  return null;
end;
$$;

drop trigger if exists billing_sync_twin_ins_del on public.channex_twin_links;
create trigger billing_sync_twin_ins_del
  after insert or delete on public.channex_twin_links
  for each row execute function public.trg_billing_sync_twin();

drop trigger if exists billing_sync_twin_upd on public.channex_twin_links;
create trigger billing_sync_twin_upd
  after update on public.channex_twin_links
  for each row
  when (
    old.status is distinct from new.status
    or old.property_id is distinct from new.property_id
    or old.owner_id is distinct from new.owner_id
    or old.twin_listing_id is distinct from new.twin_listing_id
  )
  execute function public.trg_billing_sync_twin();

revoke all on function public.trg_billing_sync_listing() from public, anon, authenticated;
revoke all on function public.trg_billing_sync_property() from public, anon, authenticated;
revoke all on function public.trg_billing_sync_twin() from public, anon, authenticated;

-- ───────────────────────── 4. reserva (cron) ─────────────────────────

-- A cada minuto, só chama o processador se existir conta vencida na fila (retentativas).
select cron.unschedule(jobid) from cron.job where jobname = 'billing-sync-retry';
select cron.schedule(
  'billing-sync-retry',
  '* * * * *',
  $cron$
    select public.kick_billing_sync()
     where exists (
       select 1 from public.billing_sync_queue
        where next_attempt_at <= now() and (locked_until is null or locked_until < now())
     );
  $cron$
);

commit;
