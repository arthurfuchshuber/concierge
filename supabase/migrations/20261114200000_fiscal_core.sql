-- MÓDULO FISCAL (v4.4) — NÚCLEO: dados, máquinas de estado e funções atômicas de envio.
-- Não aplicar em produção sem a estratégia de recuperação comprovada (ver relatório de bloqueios).
--
-- Princípios (v4.4 §1): tudo falha fechado; nenhum cliente (anon/authenticated) lê ou escreve estas tabelas
-- (RLS ligada, sem política); acesso só por funções do servidor com service_role (FiscalGuard no app);
-- o administrador SaaS NÃO tem caminho próprio; trilhas de prova são append-only; HTTP 2xx nunca autoriza
-- documento (só consulta ao provedor muda a família 1).

-- ============================================================================================
-- 1. Tabelas
-- ============================================================================================

create table public.fiscal_provider_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,                                   -- nulo = conexão da plataforma (decisão D-13 pendente)
  provider text not null default 'focus' check (provider = 'focus'),
  environment text not null check (environment in ('homologation', 'production')),
  status text not null default 'pending' check (status in ('pending', 'active', 'paused', 'error', 'revoked')),
  base_url text not null,
  secret_ref jsonb,                                -- envelope cifrado do token; NUNCA em claro
  token_fingerprint text,                          -- impressão digital (não reversível) para exibir/auditar
  last_ok_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_conn_secret_not_plain check (secret_ref is null or not (secret_ref ? 'token'))
);
create unique index uq_fiscal_conn_owner_env on public.fiscal_provider_connections (owner_id, environment) where owner_id is not null;
create unique index uq_fiscal_conn_platform_env on public.fiscal_provider_connections (environment) where owner_id is null;

create table public.fiscal_companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  connection_id uuid not null references public.fiscal_provider_connections (id),
  tax_id text not null check (tax_id ~ '^([0-9]{11}|[0-9]{14})$'),
  legal_name text not null,
  provider_company_ref text,
  status text not null default 'draft' check (status in ('draft', 'pending_provider', 'awaiting_certificate', 'active', 'suspended', 'provider_error', 'deactivated')),
  capabilities jsonb not null default '{}'::jsonb,
  soft_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- um CNPJ/CPF ativo em um único tenant (decisão aprovada 13/11/2026)
create unique index uq_fiscal_company_tax_id on public.fiscal_companies (tax_id) where soft_deleted_at is null;
create index ix_fiscal_company_owner on public.fiscal_companies (owner_id, status);

create table public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  company_id uuid not null references public.fiscal_companies (id),
  direction text not null check (direction in ('issued', 'received')),
  document_kind text not null check (document_kind in ('nfe', 'nfse', 'nfsen', 'cte', 'nfce')),
  natural_key text not null,
  ref text,
  status text not null default 'draft' check (status in ('draft', 'discovered', 'pending_issue', 'processing', 'authorized', 'rejected', 'cancel_requested', 'cancelled', 'denied', 'unknown_result')),
  access_key text,
  protocol text,
  authorized_at timestamptz,
  last_query_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_doc_authorized_has_protocol check (status <> 'authorized' or protocol is not null)   -- I-1
);
create unique index uq_fiscal_doc_natural on public.fiscal_documents (company_id, document_kind, natural_key);
create unique index uq_fiscal_doc_ref on public.fiscal_documents (company_id, ref) where ref is not null;

create table public.fiscal_operations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  company_id uuid not null references public.fiscal_companies (id),
  document_id uuid references public.fiscal_documents (id),
  kind text not null check (kind in ('issue', 'cancel', 'inutilize', 'event', 'manifest')),
  state text not null default 'awaiting_authorization' check (state in ('awaiting_authorization', 'authorized_by_human', 'queued', 'in_flight', 'completed', 'failed_definitive', 'expired', 'unknown_result')),
  state_reason text,
  ref text not null,                                -- determinística: 'cia-' || id  (v4.4 §4.9)
  payload_hash text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_fiscal_op_ref on public.fiscal_operations (company_id, ref);
create index ix_fiscal_op_owner_state on public.fiscal_operations (owner_id, state);

create table public.fiscal_operation_authorizations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.fiscal_operations (id),
  owner_id uuid not null,
  authorized_by uuid not null,                      -- usuário humano autenticado
  payload_hash text not null,
  config_version bigint not null,
  key_fingerprint text not null,
  signature text not null,
  dispatch_mode text not null default 'immediate' check (dispatch_mode = 'immediate'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  constraint fiscal_auth_ttl check (expires_at > created_at and expires_at <= created_at + interval '60 minutes')   -- v4.4 §6.4
);
create index ix_fiscal_auth_op on public.fiscal_operation_authorizations (operation_id);

create table public.fiscal_operation_attempts (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.fiscal_operations (id),
  attempt_no int not null check (attempt_no > 0),
  state text not null default 'planned' check (state in ('planned', 'sent', 'responded', 'unknown_result')),
  ref text not null,
  payload_hash text not null,
  adapter_version text not null,
  planned_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  responded_at timestamptz,
  unknown_at timestamptz,
  unknown_reason text check (unknown_reason is null or unknown_reason in ('timeout', 'connection_lost', 'response_not_persisted', 'crash_after_sent')),
  resolution text check (resolution is null or resolution in ('found', 'absent_confirmed')),
  resolved_at timestamptz,
  constraint fiscal_attempt_unknown_fields check ((state = 'unknown_result') = (unknown_reason is not null and unknown_at is not null) or state = 'responded')
);
create unique index uq_fiscal_attempt_no on public.fiscal_operation_attempts (operation_id, attempt_no);
-- uma única tentativa em voo (ou com resultado desconhecido ainda não resolvido) por operação (v4.4 §4.9)
create unique index uq_fiscal_attempt_open on public.fiscal_operation_attempts (operation_id)
  where state in ('planned', 'sent') or (state = 'unknown_result' and resolution is null);

create table public.fiscal_authorization_consumptions (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null unique references public.fiscal_operation_authorizations (id),   -- uso único
  operation_id uuid not null references public.fiscal_operations (id),
  attempt_id uuid not null references public.fiscal_operation_attempts (id),
  consumed_at timestamptz not null default clock_timestamp(),     -- relógio da engine
  trigger_session_user text not null default session_user,        -- atribuídos pela engine (v4.4 §9)
  trigger_current_user text not null default current_user,
  trigger_origin text,                                            -- só informativos: declarados pelo chamador
  trigger_request_id text
);

create table public.fiscal_attempt_evidence (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.fiscal_operations (id),
  attempt_id uuid references public.fiscal_operation_attempts (id),
  kind text not null check (kind in ('payload_produced', 'call_outcome', 'not_dispatched', 'provider_query_result')),
  response_class text check (response_class is null or response_class in ('accepted', 'rejected_definitive', 'retryable_before_send', 'inconclusive', 'unsupported')),
  http_status int,
  body_hash text,
  body_redacted jsonb,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint fiscal_evidence_call_needs_class check (kind <> 'call_outcome' or (response_class is not null and attempt_id is not null))
);
create unique index uq_fiscal_evidence_payload on public.fiscal_attempt_evidence (attempt_id) where kind = 'payload_produced';
create unique index uq_fiscal_evidence_call on public.fiscal_attempt_evidence (attempt_id) where kind = 'call_outcome';
create index ix_fiscal_evidence_op on public.fiscal_attempt_evidence (operation_id, kind, recorded_at);

create table public.fiscal_audit (
  id bigint generated always as identity primary key,
  owner_id uuid,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

-- ============================================================================================
-- 2. Trilhas append-only e guardas das máquinas de estado
-- ============================================================================================

create function public.fiscal_forbid_mutation() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  raise exception 'fiscal_append_only: % em % é proibido', tg_op, tg_table_name using errcode = 'P0001';
end $$;

create trigger trg_fiscal_authorizations_immutable before update or delete on public.fiscal_operation_authorizations for each row execute function public.fiscal_forbid_mutation();
create trigger trg_fiscal_consumptions_immutable before update or delete on public.fiscal_authorization_consumptions for each row execute function public.fiscal_forbid_mutation();
create trigger trg_fiscal_evidence_immutable before update or delete on public.fiscal_attempt_evidence for each row execute function public.fiscal_forbid_mutation();
create trigger trg_fiscal_audit_immutable before update or delete on public.fiscal_audit for each row execute function public.fiscal_forbid_mutation();
create trigger trg_fiscal_authorizations_truncate before truncate on public.fiscal_operation_authorizations for each statement execute function public.fiscal_forbid_mutation();
create trigger trg_fiscal_consumptions_truncate before truncate on public.fiscal_authorization_consumptions for each statement execute function public.fiscal_forbid_mutation();
create trigger trg_fiscal_evidence_truncate before truncate on public.fiscal_attempt_evidence for each statement execute function public.fiscal_forbid_mutation();
create trigger trg_fiscal_audit_truncate before truncate on public.fiscal_audit for each statement execute function public.fiscal_forbid_mutation();

create function public.fiscal_document_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select p_from = p_to or (p_from, p_to) in (
    ('draft', 'pending_issue'),
    ('pending_issue', 'processing'), ('pending_issue', 'unknown_result'), ('pending_issue', 'rejected'),
    ('processing', 'authorized'), ('processing', 'rejected'), ('processing', 'unknown_result'),
    ('unknown_result', 'authorized'), ('unknown_result', 'rejected'), ('unknown_result', 'processing'), ('unknown_result', 'cancelled'), ('unknown_result', 'pending_issue'),
    ('rejected', 'draft'),
    ('authorized', 'cancel_requested'),
    ('cancel_requested', 'cancelled'), ('cancel_requested', 'authorized'), ('cancel_requested', 'unknown_result'),
    ('discovered', 'authorized'), ('discovered', 'cancelled'), ('discovered', 'denied')
  )
$$;

create function public.fiscal_operation_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select p_from = p_to or (p_from, p_to) in (
    ('awaiting_authorization', 'authorized_by_human'), ('awaiting_authorization', 'expired'), ('awaiting_authorization', 'failed_definitive'),
    ('authorized_by_human', 'queued'), ('authorized_by_human', 'expired'),
    ('queued', 'in_flight'), ('queued', 'expired'), ('queued', 'failed_definitive'),
    ('in_flight', 'completed'), ('in_flight', 'failed_definitive'), ('in_flight', 'unknown_result'), ('in_flight', 'awaiting_authorization'),
    ('unknown_result', 'completed'), ('unknown_result', 'failed_definitive'), ('unknown_result', 'awaiting_authorization')
  )
$$;

create function public.fiscal_attempt_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select p_from = p_to or (p_from, p_to) in (
    ('planned', 'sent'), ('sent', 'responded'), ('sent', 'unknown_result'), ('unknown_result', 'responded')
  )
$$;

create function public.fiscal_guard_document() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if not public.fiscal_document_transition_allowed(old.status, new.status) then
    raise exception 'fiscal_transition_forbidden: documento % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
create function public.fiscal_guard_operation() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if not public.fiscal_operation_transition_allowed(old.state, new.state) then
    raise exception 'fiscal_transition_forbidden: operação % -> %', old.state, new.state using errcode = 'P0001';
  end if;
  if new.ref <> old.ref or new.payload_hash <> old.payload_hash or new.kind <> old.kind or new.owner_id <> old.owner_id or new.company_id <> old.company_id then
    raise exception 'fiscal_immutable_field: identidade da operação não muda' using errcode = 'P0001';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
create function public.fiscal_guard_attempt() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if not public.fiscal_attempt_transition_allowed(old.state, new.state) then
    raise exception 'fiscal_transition_forbidden: tentativa % -> %', old.state, new.state using errcode = 'P0001';
  end if;
  if new.ref <> old.ref or new.payload_hash <> old.payload_hash or new.operation_id <> old.operation_id or new.attempt_no <> old.attempt_no then
    raise exception 'fiscal_immutable_field: identidade da tentativa não muda' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_fiscal_guard_document before update on public.fiscal_documents for each row execute function public.fiscal_guard_document();
create trigger trg_fiscal_guard_operation before update on public.fiscal_operations for each row execute function public.fiscal_guard_operation();
create trigger trg_fiscal_guard_attempt before update on public.fiscal_operation_attempts for each row execute function public.fiscal_guard_attempt();

-- ============================================================================================
-- 3. Funções atômicas (SECURITY DEFINER; só service_role)
-- ============================================================================================

-- Cria a operação com ref determinística. Para `issue`, o documento sai de draft para pending_issue.
create function public.fiscal_operation_create(p_owner uuid, p_company uuid, p_document uuid, p_kind text, p_payload_hash text, p_created_by uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_id uuid := gen_random_uuid(); v_company public.fiscal_companies; v_doc public.fiscal_documents;
begin
  select * into v_company from public.fiscal_companies where id = p_company and owner_id = p_owner and soft_deleted_at is null;
  if not found then raise exception 'fiscal_company_not_found' using errcode = 'P0001'; end if;
  if v_company.status <> 'active' then raise exception 'fiscal_company_not_active' using errcode = 'P0001'; end if;
  if p_payload_hash is null or length(p_payload_hash) < 16 then raise exception 'fiscal_payload_hash_required' using errcode = 'P0001'; end if;
  if p_document is not null then
    select * into v_doc from public.fiscal_documents where id = p_document and owner_id = p_owner and company_id = p_company for update;
    if not found then raise exception 'fiscal_document_not_found' using errcode = 'P0001'; end if;
  elsif p_kind <> 'inutilize' and p_kind <> 'event' then
    raise exception 'fiscal_document_required' using errcode = 'P0001';
  end if;
  insert into public.fiscal_operations (id, owner_id, company_id, document_id, kind, ref, payload_hash, created_by)
  values (v_id, p_owner, p_company, p_document, p_kind, 'cia-' || v_id::text, p_payload_hash, p_created_by);
  if p_kind = 'issue' then
    update public.fiscal_documents set status = 'pending_issue', ref = 'cia-' || v_id::text where id = p_document;
  elsif p_kind = 'cancel' then
    update public.fiscal_documents set status = 'cancel_requested' where id = p_document;   -- só de authorized (guarda)
  end if;
  insert into public.fiscal_audit (owner_id, actor, action, entity, entity_id, detail)
  values (p_owner, p_created_by, 'operation_create', 'operation', v_id, jsonb_build_object('kind', p_kind));
  return v_id;
end $$;

-- Emite a autorização humana (insert-only). A assinatura é produzida e verificada no servidor (FiscalGuard).
create function public.fiscal_authorization_issue(p_operation uuid, p_authorized_by uuid, p_payload_hash text, p_config_version bigint, p_key_fingerprint text, p_signature text, p_ttl interval)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_op public.fiscal_operations; v_id uuid := gen_random_uuid();
begin
  select * into v_op from public.fiscal_operations where id = p_operation for update;
  if not found then raise exception 'fiscal_operation_not_found' using errcode = 'P0001'; end if;
  if v_op.state <> 'awaiting_authorization' then raise exception 'fiscal_operation_state: %', v_op.state using errcode = 'P0001'; end if;
  if p_payload_hash is distinct from v_op.payload_hash then raise exception 'fiscal_payload_mismatch' using errcode = 'P0001'; end if;
  if p_ttl is null or p_ttl <= interval '0' or p_ttl > interval '60 minutes' then raise exception 'fiscal_ttl_invalid' using errcode = 'P0001'; end if;
  if p_signature is null or length(p_signature) < 16 or p_key_fingerprint is null then raise exception 'fiscal_signature_required' using errcode = 'P0001'; end if;
  insert into public.fiscal_operation_authorizations (id, operation_id, owner_id, authorized_by, payload_hash, config_version, key_fingerprint, signature, created_at, expires_at)
  values (v_id, p_operation, v_op.owner_id, p_authorized_by, p_payload_hash, p_config_version, p_key_fingerprint, p_signature, clock_timestamp(), clock_timestamp() + p_ttl);
  update public.fiscal_operations set state = 'authorized_by_human' where id = p_operation;
  insert into public.fiscal_audit (owner_id, actor, action, entity, entity_id, detail)
  values (v_op.owner_id, p_authorized_by, 'authorization_issue', 'authorization', v_id, jsonb_build_object('operation_id', p_operation));
  return v_id;
end $$;

-- Planeja a tentativa (família 3: planned). Falha se houver tentativa aberta ou resultado desconhecido não resolvido.
create function public.fiscal_attempt_plan(p_operation uuid, p_adapter_version text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_op public.fiscal_operations; v_id uuid := gen_random_uuid(); v_no int;
begin
  select * into v_op from public.fiscal_operations where id = p_operation for update;
  if not found then raise exception 'fiscal_operation_not_found' using errcode = 'P0001'; end if;
  if v_op.state <> 'authorized_by_human' then raise exception 'fiscal_operation_state: %', v_op.state using errcode = 'P0001'; end if;
  select coalesce(max(attempt_no), 0) + 1 into v_no from public.fiscal_operation_attempts where operation_id = p_operation;
  insert into public.fiscal_operation_attempts (id, operation_id, attempt_no, ref, payload_hash, adapter_version)
  values (v_id, p_operation, v_no, v_op.ref, v_op.payload_hash, p_adapter_version);     -- índice parcial impede 2ª tentativa aberta
  update public.fiscal_operations set state = 'queued' where id = p_operation;
  return v_id;
end $$;

-- S1: persiste E2 (payload produzido). Idempotente por tentativa (índice único).
create function public.fiscal_attempt_record_payload(p_attempt uuid, p_body_hash text, p_body_redacted jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_att public.fiscal_operation_attempts; v_id uuid := gen_random_uuid();
begin
  select * into v_att from public.fiscal_operation_attempts where id = p_attempt for update;
  if not found then raise exception 'fiscal_attempt_not_found' using errcode = 'P0001'; end if;
  if v_att.state <> 'planned' then raise exception 'fiscal_attempt_state: %', v_att.state using errcode = 'P0001'; end if;
  if p_body_hash is distinct from v_att.payload_hash then raise exception 'fiscal_payload_mismatch' using errcode = 'P0001'; end if;
  insert into public.fiscal_attempt_evidence (id, operation_id, attempt_id, kind, body_hash, body_redacted)
  values (v_id, v_att.operation_id, p_attempt, 'payload_produced', p_body_hash, p_body_redacted);
  return v_id;
end $$;

-- S2: portão + commit de `sent`. Devolve jsonb {ok, reason}. Todas as negações são DURÁVEIS (gravam o motivo),
-- exceto as que indicam erro de uso (exceção). Prazo: cada ponto do v4.4 §6.2 verifica de novo (aqui, relógio da engine).
create function public.fiscal_attempt_mark_sent(
  p_attempt uuid, p_authorization uuid,
  p_permitted_session_users text[], p_dispatch_owner text,
  p_epsilon interval default interval '2 seconds',
  p_trigger_origin text default null, p_trigger_request_id text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_att public.fiscal_operation_attempts; v_op public.fiscal_operations; v_auth public.fiscal_operation_authorizations;
  v_now timestamptz := clock_timestamp(); v_deny text;
begin
  select * into v_att from public.fiscal_operation_attempts where id = p_attempt for update;
  if not found then raise exception 'fiscal_attempt_not_found' using errcode = 'P0001'; end if;
  select * into v_op from public.fiscal_operations where id = v_att.operation_id for update;
  select * into v_auth from public.fiscal_operation_authorizations where id = p_authorization;
  if v_att.state <> 'planned' then raise exception 'fiscal_attempt_state: %', v_att.state using errcode = 'P0001'; end if;
  if v_op.state <> 'queued' then raise exception 'fiscal_operation_state: %', v_op.state using errcode = 'P0001'; end if;
  if p_epsilon is null or p_epsilon < interval '0' then raise exception 'fiscal_epsilon_invalid' using errcode = 'P0001'; end if;

  -- negações (fail-closed). A primeira que casar vence; nenhuma abre exceção ao cliente.
  if not found or v_auth.id is null then v_deny := 'authorization_missing';
  elsif v_auth.operation_id <> v_op.id or v_auth.owner_id <> v_op.owner_id then v_deny := 'authorization_invalid';
  elsif v_auth.payload_hash <> v_op.payload_hash or v_auth.payload_hash <> v_att.payload_hash then v_deny := 'authorization_invalid';
  elsif p_permitted_session_users is null or cardinality(p_permitted_session_users) = 0
        or not (session_user = any (p_permitted_session_users)) then v_deny := 'trigger_identity_denied';
  elsif p_dispatch_owner is null or current_user <> p_dispatch_owner then v_deny := 'trigger_identity_denied';
  elsif not exists (select 1 from public.fiscal_attempt_evidence where attempt_id = p_attempt and kind = 'payload_produced') then v_deny := 'payload_not_persisted';
  elsif exists (select 1 from public.fiscal_authorization_consumptions where authorization_id = p_authorization) then v_deny := 'authorization_consumed';
  elsif (v_auth.expires_at - p_epsilon) < v_auth.created_at + p_epsilon then v_deny := 'authorization_invalid';        -- janela vazia após contração (§7.1)
  elsif v_now < v_auth.created_at + p_epsilon or v_now > v_auth.expires_at - p_epsilon then
    v_deny := case when v_now > v_auth.expires_at - p_epsilon then 'dispatch_deadline_elapsed' else 'authorization_invalid' end;
  end if;

  if v_deny is not null then
    if v_deny = 'dispatch_deadline_elapsed' then
      update public.fiscal_operations set state = 'expired', state_reason = 'dispatch_deadline_elapsed' where id = v_op.id;
    end if;
    insert into public.fiscal_attempt_evidence (operation_id, attempt_id, kind, body_redacted)
    values (v_op.id, p_attempt, 'not_dispatched', jsonb_build_object('reason', v_deny));
    insert into public.fiscal_audit (owner_id, action, entity, entity_id, detail)
    values (v_op.owner_id, 'send_denied', 'attempt', p_attempt, jsonb_build_object('reason', v_deny));
    return jsonb_build_object('ok', false, 'reason', v_deny);
  end if;

  insert into public.fiscal_authorization_consumptions (authorization_id, operation_id, attempt_id, consumed_at, trigger_origin, trigger_request_id)
  values (p_authorization, v_op.id, p_attempt, v_now, p_trigger_origin, p_trigger_request_id);
  update public.fiscal_operation_attempts set state = 'sent', sent_at = v_now where id = p_attempt;
  update public.fiscal_operations set state = 'in_flight' where id = v_op.id;
  return jsonb_build_object('ok', true, 'sent_at', v_now);
end $$;

-- Marca resultado desconhecido da tentativa (timeout / conexão perdida / resposta não persistida / queda após `sent`).
create function public.fiscal_attempt_mark_unknown(p_attempt uuid, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_att public.fiscal_operation_attempts; v_op public.fiscal_operations;
begin
  select * into v_att from public.fiscal_operation_attempts where id = p_attempt for update;
  if not found then raise exception 'fiscal_attempt_not_found' using errcode = 'P0001'; end if;
  if v_att.state = 'unknown_result' then return; end if;      -- idempotente
  if v_att.state <> 'sent' then raise exception 'fiscal_attempt_state: %', v_att.state using errcode = 'P0001'; end if;
  update public.fiscal_operation_attempts set state = 'unknown_result', unknown_reason = p_reason, unknown_at = clock_timestamp() where id = p_attempt;
  select * into v_op from public.fiscal_operations where id = v_att.operation_id for update;
  if v_op.state = 'in_flight' then
    update public.fiscal_operations set state = 'unknown_result', state_reason = p_reason where id = v_op.id;
    if v_op.document_id is not null and v_op.kind in ('issue', 'cancel') then
      update public.fiscal_documents set status = 'unknown_result' where id = v_op.document_id and status in ('pending_issue', 'processing', 'cancel_requested');
    end if;
  end if;
  insert into public.fiscal_audit (owner_id, action, entity, entity_id, detail)
  values (v_op.owner_id, 'attempt_unknown', 'attempt', p_attempt, jsonb_build_object('reason', p_reason));
end $$;

-- Varredura: `sent` sem E3 além do limiar ⇒ unknown_result (nunca reenvia).
create function public.fiscal_attempt_sweep_unknown(p_threshold interval default interval '15 minutes')
returns int language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare r record; n int := 0;
begin
  for r in select a.id from public.fiscal_operation_attempts a
           where a.state = 'sent' and a.sent_at < clock_timestamp() - p_threshold
             and not exists (select 1 from public.fiscal_attempt_evidence e where e.attempt_id = a.id and e.kind = 'call_outcome')
           order by a.sent_at for update of a skip locked loop
    perform public.fiscal_attempt_mark_unknown(r.id, 'crash_after_sent');
    n := n + 1;
  end loop;
  return n;
end $$;

-- S4: persiste E3 e aplica o efeito da classe. Só consulta altera o estado fiscal do documento (I-1),
-- exceto rejeição definitiva de validação em emissão.
create function public.fiscal_attempt_record_response(p_attempt uuid, p_response_class text, p_http_status int, p_body_hash text, p_body_redacted jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_att public.fiscal_operation_attempts; v_op public.fiscal_operations;
begin
  select * into v_att from public.fiscal_operation_attempts where id = p_attempt for update;
  if not found then raise exception 'fiscal_attempt_not_found' using errcode = 'P0001'; end if;
  if v_att.state not in ('sent', 'unknown_result') then raise exception 'fiscal_attempt_state: %', v_att.state using errcode = 'P0001'; end if;
  if v_att.state = 'unknown_result' and v_att.resolution = 'absent_confirmed' then
    raise exception 'fiscal_attempt_resolved_absent' using errcode = 'P0001';        -- E3 tardio após ausência confirmada: conflito, vai a tratamento humano
  end if;
  select * into v_op from public.fiscal_operations where id = v_att.operation_id for update;
  insert into public.fiscal_attempt_evidence (operation_id, attempt_id, kind, response_class, http_status, body_hash, body_redacted)
  values (v_op.id, p_attempt, 'call_outcome', p_response_class, p_http_status, p_body_hash, p_body_redacted);
  update public.fiscal_operation_attempts set state = 'responded', responded_at = clock_timestamp() where id = p_attempt;

  if v_op.state = 'in_flight' then            -- operação em unknown_result só muda por consulta
    if p_response_class = 'accepted' then
      if v_op.document_id is not null and v_op.kind = 'issue' then
        update public.fiscal_documents set status = 'processing' where id = v_op.document_id and status = 'pending_issue';
      end if;
    elsif p_response_class in ('rejected_definitive', 'unsupported') then
      update public.fiscal_operations set state = 'failed_definitive', state_reason = p_response_class where id = v_op.id;
      if v_op.document_id is not null and v_op.kind = 'issue' then
        update public.fiscal_documents set status = 'rejected' where id = v_op.document_id and status = 'pending_issue';
      end if;
    elsif p_response_class = 'retryable_before_send' then
      update public.fiscal_operations set state = 'awaiting_authorization', state_reason = 'retryable_before_send' where id = v_op.id;
    elsif p_response_class = 'inconclusive' then
      update public.fiscal_operations set state = 'unknown_result', state_reason = 'inconclusive_response' where id = v_op.id;
      if v_op.document_id is not null and v_op.kind in ('issue', 'cancel') then
        update public.fiscal_documents set status = 'unknown_result' where id = v_op.document_id and status in ('pending_issue', 'processing', 'cancel_requested');
      end if;
    else
      raise exception 'fiscal_response_class_invalid' using errcode = 'P0001';
    end if;
  end if;
end $$;

-- Resultado de consulta ao provedor. Único caminho que leva o documento a authorized/cancelled/rejected.
-- p_result: authorized | rejected | processing | cancelled | absent | unmapped
create function public.fiscal_document_apply_query(p_operation uuid, p_result text, p_provider_status text, p_protocol text, p_access_key text, p_body_hash text, p_body_redacted jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_op public.fiscal_operations; v_doc public.fiscal_documents; v_att public.fiscal_operation_attempts;
begin
  select * into v_op from public.fiscal_operations where id = p_operation for update;
  if not found then raise exception 'fiscal_operation_not_found' using errcode = 'P0001'; end if;
  if p_result not in ('authorized', 'rejected', 'processing', 'cancelled', 'absent', 'unmapped') then raise exception 'fiscal_query_result_invalid' using errcode = 'P0001'; end if;
  if p_result = 'authorized' and (p_protocol is null or length(p_protocol) = 0) and v_op.kind = 'issue' then
    raise exception 'fiscal_protocol_required' using errcode = 'P0001';                        -- I-1
  end if;
  if (v_op.kind = 'issue' and p_result = 'cancelled') or (v_op.kind = 'cancel' and p_result in ('rejected', 'processing')) then
    raise exception 'fiscal_query_result_incompatible: % x %', v_op.kind, p_result using errcode = 'P0001';
  end if;
  select * into v_att from public.fiscal_operation_attempts where operation_id = p_operation order by attempt_no desc limit 1;
  insert into public.fiscal_attempt_evidence (operation_id, attempt_id, kind, body_hash, body_redacted)
  values (p_operation, v_att.id, 'provider_query_result', p_body_hash,
          coalesce(p_body_redacted, '{}'::jsonb) || jsonb_build_object('result', p_result, 'provider_status', p_provider_status));
  if v_op.document_id is not null then select * into v_doc from public.fiscal_documents where id = v_op.document_id for update; end if;
  if v_doc.id is not null then update public.fiscal_documents set last_query_at = clock_timestamp() where id = v_doc.id; end if;

  if p_result in ('absent', 'unmapped') then
    if p_result = 'unmapped' then
      insert into public.fiscal_audit (owner_id, action, entity, entity_id, detail)
      values (v_op.owner_id, 'query_unmapped', 'operation', p_operation, jsonb_build_object('provider_status', p_provider_status));
    end if;
    return jsonb_build_object('ok', true, 'applied', false);
  end if;

  if v_doc.id is not null then
    if p_result = 'authorized' then
      update public.fiscal_documents set status = 'authorized', protocol = coalesce(p_protocol, protocol), access_key = coalesce(p_access_key, access_key), authorized_at = coalesce(authorized_at, clock_timestamp()) where id = v_doc.id;
    elsif p_result = 'rejected' then update public.fiscal_documents set status = 'rejected' where id = v_doc.id;
    elsif p_result = 'processing' then update public.fiscal_documents set status = 'processing' where id = v_doc.id;
    elsif p_result = 'cancelled' then update public.fiscal_documents set status = 'cancelled' where id = v_doc.id;
    end if;
  end if;
  if v_att.id is not null and v_att.state = 'unknown_result' and v_att.resolution is null and p_result <> 'processing' then
    update public.fiscal_operation_attempts set resolution = 'found', resolved_at = clock_timestamp() where id = v_att.id;
  end if;
  if v_op.state in ('in_flight', 'unknown_result') then
    if p_result in ('authorized', 'cancelled') then update public.fiscal_operations set state = 'completed' where id = v_op.id;
    elsif p_result = 'rejected' then update public.fiscal_operations set state = 'failed_definitive', state_reason = 'provider_rejected' where id = v_op.id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'applied', true);
end $$;

-- Ausência confirmada (v4.4 §4.6): ≥ p_min_queries consultas "absent" cobrindo ≥ p_min_span. Não reenvia:
-- devolve a operação para `awaiting_authorization`, exigindo NOVA autorização humana.
create function public.fiscal_operation_confirm_absence(p_operation uuid, p_min_queries int default 3, p_min_span interval default interval '15 minutes')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_op public.fiscal_operations; v_att public.fiscal_operation_attempts; v_n int; v_first timestamptz; v_last timestamptz;
begin
  select * into v_op from public.fiscal_operations where id = p_operation for update;
  if not found then raise exception 'fiscal_operation_not_found' using errcode = 'P0001'; end if;
  if v_op.state <> 'unknown_result' then raise exception 'fiscal_operation_state: %', v_op.state using errcode = 'P0001'; end if;
  select * into v_att from public.fiscal_operation_attempts where operation_id = p_operation order by attempt_no desc limit 1 for update;
  if v_att.state <> 'unknown_result' or v_att.resolution is not null then raise exception 'fiscal_attempt_state: %', v_att.state using errcode = 'P0001'; end if;
  -- só valem consultas POSTERIORES ao momento em que o resultado virou desconhecido
  select count(*), min(recorded_at), max(recorded_at) into v_n, v_first, v_last
    from public.fiscal_attempt_evidence
   where operation_id = p_operation and kind = 'provider_query_result' and body_redacted ->> 'result' = 'absent' and recorded_at >= v_att.unknown_at;
  if v_n < p_min_queries or v_last - v_first < p_min_span then
    return jsonb_build_object('ok', false, 'reason', 'absence_not_proven', 'queries', v_n);
  end if;
  update public.fiscal_operation_attempts set resolution = 'absent_confirmed', resolved_at = clock_timestamp() where id = v_att.id;
  update public.fiscal_operations set state = 'awaiting_authorization', state_reason = 'absence_confirmed_new_authorization_required' where id = p_operation;
  if v_op.document_id is not null and v_op.kind = 'issue' then
    -- família 1: sem efeito remoto comprovado; volta ao estado de espera de emissão (processing→unknown não regride sozinho)
    update public.fiscal_documents set status = 'pending_issue' where id = v_op.document_id and status = 'unknown_result';
  end if;
  insert into public.fiscal_audit (owner_id, action, entity, entity_id, detail)
  values (v_op.owner_id, 'absence_confirmed', 'operation', p_operation, jsonb_build_object('queries', v_n));
  return jsonb_build_object('ok', true, 'queries', v_n);
end $$;

-- ============================================================================================
-- 4. Privilégios: nega tudo a clientes; service_role não altera trilhas append-only
-- ============================================================================================
alter table public.fiscal_provider_connections enable row level security;
alter table public.fiscal_companies enable row level security;
alter table public.fiscal_documents enable row level security;
alter table public.fiscal_operations enable row level security;
alter table public.fiscal_operation_authorizations enable row level security;
alter table public.fiscal_operation_attempts enable row level security;
alter table public.fiscal_authorization_consumptions enable row level security;
alter table public.fiscal_attempt_evidence enable row level security;
alter table public.fiscal_audit enable row level security;

revoke all on public.fiscal_provider_connections, public.fiscal_companies, public.fiscal_documents, public.fiscal_operations,
  public.fiscal_operation_authorizations, public.fiscal_operation_attempts, public.fiscal_authorization_consumptions,
  public.fiscal_attempt_evidence, public.fiscal_audit from public, anon, authenticated;
revoke update, delete, truncate on public.fiscal_operation_authorizations, public.fiscal_authorization_consumptions,
  public.fiscal_attempt_evidence, public.fiscal_audit from service_role;
revoke all on sequence public.fiscal_audit_id_seq from public, anon, authenticated;

revoke all on function
  public.fiscal_operation_create(uuid, uuid, uuid, text, text, uuid),
  public.fiscal_authorization_issue(uuid, uuid, text, bigint, text, text, interval),
  public.fiscal_attempt_plan(uuid, text),
  public.fiscal_attempt_record_payload(uuid, text, jsonb),
  public.fiscal_attempt_mark_sent(uuid, uuid, text[], text, interval, text, text),
  public.fiscal_attempt_mark_unknown(uuid, text),
  public.fiscal_attempt_sweep_unknown(interval),
  public.fiscal_attempt_record_response(uuid, text, int, text, jsonb),
  public.fiscal_document_apply_query(uuid, text, text, text, text, text, jsonb),
  public.fiscal_operation_confirm_absence(uuid, int, interval)
  from public, anon, authenticated;
grant execute on function
  public.fiscal_operation_create(uuid, uuid, uuid, text, text, uuid),
  public.fiscal_authorization_issue(uuid, uuid, text, bigint, text, text, interval),
  public.fiscal_attempt_plan(uuid, text),
  public.fiscal_attempt_record_payload(uuid, text, jsonb),
  public.fiscal_attempt_mark_sent(uuid, uuid, text[], text, interval, text, text),
  public.fiscal_attempt_mark_unknown(uuid, text),
  public.fiscal_attempt_sweep_unknown(interval),
  public.fiscal_attempt_record_response(uuid, text, int, text, jsonb),
  public.fiscal_document_apply_query(uuid, text, text, text, text, text, jsonb),
  public.fiscal_operation_confirm_absence(uuid, int, interval)
  to service_role;
