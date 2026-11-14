-- MÓDULO FISCAL — habilitação por conta, caixa de entrada de webhooks e candidatos à reconciliação.
-- Não aplicar em produção sem a estratégia de recuperação comprovada.

-- Habilitação do módulo por conta (módulo opcional por plano; o plano comercial ainda é decisão do proprietário,
-- então a habilitação é um ato explícito e auditado, fail-closed: sem linha = desabilitado).
create table public.fiscal_tenant_enablement (
  owner_id uuid primary key,
  enabled boolean not null default false,
  enabled_by uuid,
  enabled_at timestamptz,
  note text,
  updated_at timestamptz not null default now()
);

alter table public.fiscal_provider_connections add column webhook_secret_hash text;

-- Metadados públicos da empresa. NUNCA há coluna para certificado (.pfx), senha ou token da sub-empresa:
-- o certificado A1 é write-only (vai ao provedor e não é guardado aqui).
alter table public.fiscal_companies add column trade_name text, add column certificate_valid_until timestamptz, add column certificate_updated_at timestamptz;   -- hash do segredo da URL do webhook; nunca o segredo

create table public.fiscal_webhook_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.fiscal_provider_connections (id),
  owner_id uuid,
  dedupe_key text not null,                     -- hash estável do corpo recebido (idempotência)
  body_hash text not null,
  body_redacted jsonb not null,
  ref text,                                     -- ref extraída (só dica; o estado vem da consulta)
  status text not null default 'pending' check (status in ('pending', 'processed', 'ignored', 'error')),
  attempts int not null default 0,
  claimed_until timestamptz,                    -- lease do worker: evita dois workers no mesmo evento
  last_error text,
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz
);
create unique index uq_fiscal_webhook_dedupe on public.fiscal_webhook_events (connection_id, dedupe_key);
create index ix_fiscal_webhook_pending on public.fiscal_webhook_events (received_at) where status = 'pending';

-- Ingestão idempotente: o mesmo corpo na mesma conexão grava uma única vez.
create function public.fiscal_webhook_ingest(p_connection uuid, p_dedupe_key text, p_body_hash text, p_body jsonb, p_ref text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_conn public.fiscal_provider_connections; v_id uuid;
begin
  select * into v_conn from public.fiscal_provider_connections where id = p_connection and status in ('active', 'pending');
  if not found then raise exception 'fiscal_connection_not_found' using errcode = 'P0001'; end if;
  if p_dedupe_key is null or length(p_dedupe_key) < 16 then raise exception 'fiscal_dedupe_key_required' using errcode = 'P0001'; end if;
  insert into public.fiscal_webhook_events (connection_id, owner_id, dedupe_key, body_hash, body_redacted, ref)
  values (p_connection, v_conn.owner_id, p_dedupe_key, p_body_hash, p_body, p_ref)
  on conflict (connection_id, dedupe_key) do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('new', false); end if;
  return jsonb_build_object('new', true, 'id', v_id);
end $$;

-- Reserva eventos pendentes para um worker (sem disputa entre workers).
create function public.fiscal_webhook_claim(p_limit int default 20)
returns setof public.fiscal_webhook_events language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  return query
  with c as (select id from public.fiscal_webhook_events where status = 'pending' and (claimed_until is null or claimed_until < clock_timestamp()) order by received_at limit greatest(1, least(p_limit, 100)) for update skip locked)
  update public.fiscal_webhook_events e set attempts = e.attempts + 1, claimed_until = clock_timestamp() + interval '5 minutes' from c where e.id = c.id returning e.*;
end $$;

create function public.fiscal_webhook_finish(p_event uuid, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_status not in ('processed', 'ignored', 'error', 'pending') then raise exception 'fiscal_webhook_status_invalid' using errcode = 'P0001'; end if;
  update public.fiscal_webhook_events
     set status = case when p_status = 'error' and attempts < 5 then 'pending' else p_status end,
         last_error = p_error,
         claimed_until = null,
         processed_at = case when p_status in ('processed', 'ignored') then clock_timestamp() else processed_at end
   where id = p_event and status = 'pending';
end $$;

-- Candidatos à reconciliação por consulta: operações em resultado desconhecido e documentos em andamento parados.
create function public.fiscal_reconcile_candidates(p_stale interval default interval '2 minutes', p_limit int default 50)
returns table (operation_id uuid, company_id uuid, owner_id uuid, document_id uuid, document_kind text, ref text, op_kind text)
language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  select o.id, o.company_id, o.owner_id, o.document_id, d.document_kind, o.ref, o.kind
    from public.fiscal_operations o
    join public.fiscal_documents d on d.id = o.document_id
   where (o.state = 'unknown_result' or (o.state = 'in_flight' and d.status = 'processing'))
     and coalesce(d.last_query_at, o.updated_at) < clock_timestamp() - p_stale
   order by coalesce(d.last_query_at, o.updated_at)
   limit greatest(1, least(p_limit, 200))
$$;

alter table public.fiscal_tenant_enablement enable row level security;
alter table public.fiscal_webhook_events enable row level security;
revoke all on public.fiscal_tenant_enablement, public.fiscal_webhook_events from public, anon, authenticated;
revoke all on function public.fiscal_webhook_ingest(uuid, text, text, jsonb, text), public.fiscal_webhook_claim(int),
  public.fiscal_webhook_finish(uuid, text, text), public.fiscal_reconcile_candidates(interval, int) from public, anon, authenticated;
grant execute on function public.fiscal_webhook_ingest(uuid, text, text, jsonb, text), public.fiscal_webhook_claim(int),
  public.fiscal_webhook_finish(uuid, text, text), public.fiscal_reconcile_candidates(interval, int) to service_role;
