-- ConciergeIA Guest AI · Gate B3.3 · ENTREGA 4 (revisão GLOBAL, diretriz complementar de 04/11/2026)
-- Shadow Mode para TODOS os imóveis ELEGÍVEIS da plataforma — sem lista fixa e sem teto de imóveis.
-- Migration LOCAL: NÃO aplicar em produção sem a autorização do GATE A (aplicação inerte).
-- Depende de `20261104000000_guest_ai_conversation_leases.sql` e `20261104120000_guest_ai_shadow.sql`.
--
-- Quem participa (decidido SEMPRE no banco, por `guest_ai_shadow_property_gate`, na ordem):
--  1. ESCOPO GLOBAL (`guest_ai_shadow_control.property_scope`): nasce `none` ⇒ nenhum imóvel participa.
--     Só um ato administrativo do dono, com evidência, muda para `all_eligible` (GATE B).
--  2. O imóvel existe e o seu dono (`properties.owner_id`) é o tenant informado.
--  3. Interruptor do TENANT (`guest_ai_shadow_tenant_switch`): desligado ⇒ todos os imóveis dele saem.
--  4. Interruptor do IMÓVEL (`guest_ai_shadow_property_switch`): desligado ⇒ só ele sai.
--  5. ELEGIBILIDADE TÉCNICA (`guest_ai_shadow_eligibility_reason`, regra `eligibility.2026-11-05.1`):
--     property_not_found · archived · tenant_unresolved · listing_inconsistent · no_guest_channel ·
--     operational_data_missing. Motivo sempre por código fechado; foto auditável em
--     `guest_ai_shadow_property_eligibility` (`shadow_refresh_eligibility`).
--  * A elegibilidade é avaliada AO VIVO em cada leitura de candidatas, em cada consulta do worker e em
--    cada reivindicação: um imóvel arquivado, excluído ou desligado sai na hora, sem ação no Shadow.
--  * Candidatas escolhidas NO BANCO (`shadow_list_candidates`): só com a trava do tick, só imóveis
--    ativos, só ids e códigos (nunca texto nem o identificador de sessão do hóspede), rodízio entre
--    tenants e ordem de chegada dentro de cada tenant; nunca mais que o teto por tick do controle (≤ 3).
--  * Emergência: `shadow_emergency_stop` (para tudo), interruptores de tenant/imóvel (desligar nunca é
--    bloqueado), `shadow_admin_reconcile` (encerra execuções abandonadas com o Shadow parado).
--  * Administração SÓ pelo dono das funções (operador no SQL do banco): nenhuma RPC administrativa é
--    executável por service_role, authenticated ou anon. Nenhum privilégio é ampliado.
--  * Nenhuma tabela operacional é alterada; nada de imóvel ou hóspede é copiado (só ids e códigos).

-- ───────────────────────── Guarda (pré-requisitos e reexecução) ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['public.guest_ai_shadow_control', 'public.guest_ai_shadow_inflight', 'public.guest_ai_shadow_executions',
                           'public.guest_ai_conversation_leases', 'public.properties', 'public.property_chat_conversations',
                           'public.property_chat_messages', 'public.profiles', 'public.property_listing_raw_data',
                           'public.channex_twin_links', 'public.host_whatsapp_config'] loop
    if to_regclass(t) is null then
      raise exception 'guest_ai_shadow_global: pré-requisito ausente (%)', t using errcode = 'P0001';
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'guest_ai_shadow_control' and column_name = 'property_scope')
     or exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname in ('guest_ai_shadow_property_switch', 'guest_ai_shadow_tenant_switch',
                                                               'guest_ai_shadow_switch_log', 'guest_ai_shadow_property_eligibility'))
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('shadow_set_scope', 'shadow_set_tenant_enabled', 'shadow_set_property_enabled',
                   'shadow_emergency_stop', 'shadow_admin_reconcile', 'shadow_refresh_eligibility', 'shadow_list_candidates',
                   'shadow_property_status', 'guest_ai_shadow_eligibility_reason', 'guest_ai_shadow_reconcile_core')) then
    raise exception 'guest_ai_shadow_global: objetos já existem; migration não reaplicada (conferir com o script de validação)' using errcode = 'P0001';
  end if;
end $$;

-- ───────────────────────── Escopo global (no controle; nasce `none`) ─────────────────────────
alter table public.guest_ai_shadow_control
  add column property_scope        text not null default 'none',
  add column scope_version         integer not null default 0,
  add column scope_changed_at      timestamptz,
  add column scope_changed_by      uuid,
  add column scope_evidence_sha256 text,
  add constraint gasc_scope_ck check (property_scope in ('none', 'all_eligible')),
  add constraint gasc_scope_version_ck check (scope_version >= 0),
  add constraint gasc_scope_evidence_ck check (scope_evidence_sha256 is null or scope_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  -- escopo aberto exige autor, instante e referência da autorização
  add constraint gasc_scope_open_ck check (property_scope = 'none'
    or (scope_changed_at is not null and scope_changed_by is not null and scope_evidence_sha256 is not null));

-- ───────────────────────── Interruptores (desligar = sair; ausência de linha = segue o escopo) ─────────────────────────
create table public.guest_ai_shadow_tenant_switch (
  tenant_id    uuid primary key,
  enabled      boolean not null,
  version      integer not null,
  changed_at   timestamptz not null default now(),
  changed_by   uuid not null,
  reason_code  text not null,
  constraint gasts_version_ck check (version >= 1),
  constraint gasts_reason_ck check (reason_code in ('authorized_enable', 'authorized_disable', 'emergency_disable'))
);

create table public.guest_ai_shadow_property_switch (
  property_id  uuid primary key,
  tenant_id    uuid not null,
  enabled      boolean not null,
  version      integer not null,
  changed_at   timestamptz not null default now(),
  changed_by   uuid not null,
  reason_code  text not null,
  constraint gasps_version_ck check (version >= 1),
  constraint gasps_reason_ck check (reason_code in ('authorized_enable', 'authorized_disable', 'emergency_disable'))
);

-- Histórico ÚNICO e imutável de toda mudança de escopo e de interruptor: quem, papel do banco, quando,
-- antes/depois, motivo, evidência. Ninguém além do dono tem privilégio; nenhuma função altera ou apaga.
create table public.guest_ai_shadow_switch_log (
  id              bigint generated always as identity primary key,
  subject_kind    text not null,
  tenant_id       uuid,
  property_id     uuid,
  from_value      text not null,
  to_value        text not null,
  version         integer not null,
  actor           uuid not null,
  db_role         text not null,
  reason_code     text not null,
  evidence_sha256 text,
  at              timestamptz not null default now(),
  constraint gassl_kind_ck check (subject_kind in ('global', 'tenant', 'property')),
  constraint gassl_subject_ck check (
    (subject_kind = 'global' and tenant_id is null and property_id is null and from_value in ('none', 'all_eligible') and to_value in ('none', 'all_eligible'))
    or (subject_kind = 'tenant' and tenant_id is not null and property_id is null and from_value in ('enabled', 'disabled') and to_value in ('enabled', 'disabled'))
    or (subject_kind = 'property' and tenant_id is not null and property_id is not null and from_value in ('enabled', 'disabled') and to_value in ('enabled', 'disabled'))),
  constraint gassl_change_ck check (from_value <> to_value),
  constraint gassl_role_ck check (db_role ~ '^[a-z_][a-z0-9_]{0,62}$'),
  constraint gassl_reason_ck check (reason_code in ('authorized_global_activation', 'authorized_global_deactivation', 'emergency_scope_off',
                                                    'authorized_enable', 'authorized_disable', 'emergency_disable')),
  constraint gassl_evidence_ck check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  -- abrir o escopo ou religar exige referência da autorização
  constraint gassl_enable_evidence_ck check (to_value not in ('all_eligible', 'enabled') or evidence_sha256 is not null)
);

-- Foto auditável da elegibilidade (o motivo estruturado de cada imóvel inelegível). A decisão em tempo
-- de execução NÃO depende desta foto: é sempre ao vivo.
create table public.guest_ai_shadow_property_eligibility (
  property_id   uuid primary key,
  tenant_id     uuid,
  eligible      boolean not null,
  reason_code   text,
  rule_version  text not null,
  evaluated_at  timestamptz not null default now(),
  evaluated_by  uuid not null,
  constraint gaspe_reason_ck check (reason_code is null or reason_code in ('property_not_found', 'archived', 'tenant_unresolved', 'listing_inconsistent', 'no_guest_channel', 'operational_data_missing')),
  constraint gaspe_consistent_ck check (eligible = (reason_code is null)),
  constraint gaspe_rule_ck check (rule_version ~ '^eligibility\.[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);

do $$
declare t text;
begin
  foreach t in array array['guest_ai_shadow_tenant_switch', 'guest_ai_shadow_property_switch', 'guest_ai_shadow_switch_log',
                           'guest_ai_shadow_property_eligibility'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on table public.%I from sandbox_exec', t);
    end if;
  end loop;
  -- a ACL padrão da produção concede sequências novas a clientes: revogação explícita
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'guest\_ai\_shadow\_switch\_log%' loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated, service_role', t);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on sequence public.%I from sandbox_exec', t);
    end if;
  end loop;
end $$;

-- ───────────────────────── Elegibilidade técnica (interna; ao vivo) ─────────────────────────
-- NULL ⇒ elegível. Ordem fixa: o primeiro motivo encontrado é o registrado.
--  * property_not_found: o imóvel não existe (excluído pela operação convencional).
--  * archived: arquivado.
--  * tenant_unresolved: o dono não tem conta (perfil) — não há tenant a quem atribuir a execução.
--  * listing_inconsistent: anúncio do imóvel pertence a outro dono, ou o mesmo anúncio/propriedade Channex
--    está ligado a mais de um imóvel, ou vínculo gêmeo de outro dono (associação ambígua ⇒ nunca adivinhar).
--  * no_guest_channel: nenhum canal pelo qual um hóspede fala com o imóvel — guia não publicado (ou não
--    criado), nenhum anúncio utilizável (inexistente, não encontrado ou conta desconectada) e nenhum
--    WhatsApp ativo do dono.
--  * operational_data_missing: sem horário de check-in ou check-out (dado mínimo do dossiê).
create or replace function public.guest_ai_shadow_eligibility_reason(p_property_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  p record;
begin
  if p_property_id is null then return 'property_not_found'; end if;
  select id, owner_id, archived_at, published, guide_created, checkin_time, checkout_time into p
    from public.properties where id = p_property_id;
  if not found then return 'property_not_found'; end if;
  if p.archived_at is not null then return 'archived'; end if;
  if p.owner_id is null or not exists (select 1 from public.profiles where id = p.owner_id) then return 'tenant_unresolved'; end if;
  if exists (select 1 from public.property_listing_raw_data l
              where l.property_id = p.id
                and (l.owner_id is distinct from p.owner_id
                     or exists (select 1 from public.property_listing_raw_data o
                                 where o.property_id <> p.id
                                   and (o.airbnb_listing_id = l.airbnb_listing_id
                                        or (l.channex_property_id is not null and o.channex_property_id = l.channex_property_id)))))
     or exists (select 1 from public.channex_twin_links t where t.property_id = p.id and t.owner_id is distinct from p.owner_id) then
    return 'listing_inconsistent';
  end if;
  if not ((p.published and p.guide_created)
          or exists (select 1 from public.property_listing_raw_data l
                      where l.property_id = p.id and l.not_found_at is null
                        and not (l.sync_paused_at is not null and l.paused_reason = 'account_disconnected'))
          or exists (select 1 from public.host_whatsapp_config w where w.owner_id = p.owner_id and w.status = 'active')) then
    return 'no_guest_channel';
  end if;
  if coalesce(btrim(p.checkin_time), '') = '' or coalesce(btrim(p.checkout_time), '') = '' then
    return 'operational_data_missing';
  end if;
  return null;
end;
$function$;

-- ───────────────────────── Porta de imóvel (redefinida; antes FECHADA) ─────────────────────────
create or replace function public.guest_ai_shadow_property_gate(p_tenant_id uuid, p_property_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_scope text;
  v_owner uuid;
begin
  select property_scope into v_scope from public.guest_ai_shadow_control where id = 1;
  if v_scope is distinct from 'all_eligible' then return 'scope_off'; end if;
  if p_tenant_id is null or p_property_id is null then return 'property_not_found'; end if;
  select owner_id into v_owner from public.properties where id = p_property_id;
  if not found then return 'property_not_found'; end if;
  if v_owner is distinct from p_tenant_id then return 'tenant_mismatch'; end if;
  if exists (select 1 from public.guest_ai_shadow_tenant_switch where tenant_id = p_tenant_id and not enabled) then return 'tenant_disabled'; end if;
  if exists (select 1 from public.guest_ai_shadow_property_switch where property_id = p_property_id and not enabled) then return 'property_disabled'; end if;
  return public.guest_ai_shadow_eligibility_reason(p_property_id);
end;
$function$;

-- WORKER: o imóvel pode participar agora? (só leitura; o worker consulta ANTES de ler qualquer dado)
create or replace function public.shadow_property_status(p_tenant_id uuid, p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare v text;
begin
  if p_tenant_id is null or p_property_id is null then return jsonb_build_object('result', 'invalid_argument'); end if;
  v := public.guest_ai_shadow_property_gate(p_tenant_id, p_property_id);
  if v is null then return jsonb_build_object('result', 'active'); end if;
  return jsonb_build_object('result', 'blocked', 'reason', v);
end;
$function$;

-- WORKER: candidatas do tick, escolhidas no banco. Só com a trava do tick vigente e o Shadow em
-- `running`; só imóveis ativos; conversa com mensagem de hóspede dentro da janela de atividade, sem
-- execução em andamento e ainda não avaliada depois dessa mensagem. Rodízio entre tenants (1º de cada
-- tenant, depois o 2º…), ordem de chegada dentro do tenant (a mais antiga primeiro: ninguém fica para
-- trás dentro da janela). Devolve só ids e o código da superfície — nunca texto nem o id de sessão.
create or replace function public.shadow_list_candidates(p_tick_token text, p_lookback_seconds integer, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  v_limit integer;
  v jsonb;
begin
  if p_tick_token is null or p_tick_token !~ '^[0-9a-f]{64}$' or p_lookback_seconds is null or p_lookback_seconds not between 60 and 900
     or p_limit is null or p_limit < 1 then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  select * into c from public.guest_ai_shadow_control where id = 1;
  if c.state <> 'running' then return jsonb_build_object('result', 'state_not_running', 'state', c.state); end if;
  if c.tick_owner_token is distinct from p_tick_token or c.tick_expires_at <= now() then return jsonb_build_object('result', 'tick_not_held'); end if;
  if c.property_scope <> 'all_eligible' then return jsonb_build_object('result', 'scope_off'); end if;
  if c.max_conversations_per_tick is null then return jsonb_build_object('result', 'config_incomplete'); end if;
  v_limit := least(p_limit, c.max_conversations_per_tick);
  -- parte dos IMÓVEIS e usa o índice existente (property_id, last_message_at desc) de cada um; nenhum índice
  -- novo em tabela da operação convencional
  with recent as (
    select cv.id as conversation_id, p.id as property_id, p.owner_id as tenant_id,
           case when cv.guest_session_id like 'wa:%' then 'whatsapp' when cv.guest_session_id like 'airbnb:%' then 'airbnb' else 'guide_chat' end as surface
      from public.properties p
      cross join lateral (
        select x.id, x.guest_session_id from public.property_chat_conversations x
         where x.property_id = p.id and x.last_message_at >= now() - make_interval(secs => p_lookback_seconds)
         -- teto por imóvel (50 conversas ativas na janela): impede o planejador de achatar a junção e varrer a
         -- tabela inteira; cada imóvel vira uma leitura de índice, custo ∝ imóveis, não ∝ histórico de conversas
         order by x.last_message_at desc limit 50) cv
     where p.archived_at is null
  ), last_guest as (
    select r.*, lm.id as message_id, lm.created_at as message_at
      from recent r
      cross join lateral (
        select m.id, m.created_at from public.property_chat_messages m
         where m.conversation_id = r.conversation_id and m.sender_type = 'guest' and m.role = 'user'
         order by m.created_at desc, m.id desc limit 1) lm
     where lm.created_at >= now() - make_interval(secs => p_lookback_seconds)
  ), eligible as (
    select g.* from last_guest g
     where public.guest_ai_shadow_property_gate(g.tenant_id, g.property_id) is null
       and not exists (select 1 from public.guest_ai_shadow_inflight f where f.conversation_id = g.conversation_id and f.status = 'running')
       and not exists (select 1 from public.guest_ai_shadow_executions e where e.conversation_id = g.conversation_id and e.started_at >= g.message_at)
  ), ranked as (
    select e.*, row_number() over (partition by e.tenant_id order by e.message_at, e.conversation_id) as rn from eligible e
  ), chosen as (
    select * from ranked order by rn, message_at, conversation_id limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object('conversation_id', conversation_id, 'property_id', property_id, 'tenant_id', tenant_id,
                                               'surface', surface, 'message_id', message_id) order by rn, message_at, conversation_id), '[]'::jsonb)
    into v from chosen;
  return jsonb_build_object('result', 'ok', 'candidates', v);
end;
$function$;

-- ───────────────────────── Administração (só o dono) ─────────────────────────
-- Escopo global: `none` ⇒ `all_eligible` exige motivo `authorized_global_activation`, CAS e evidência;
-- voltar a `none` nunca é bloqueado (versão opcional). Não mexe no estado global (running/paused/…).
create or replace function public.shadow_set_scope(p_actor uuid, p_expected_scope_version integer, p_scope text, p_reason text, p_evidence_sha256 text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  if p_actor is null or p_scope is null or p_scope not in ('none', 'all_eligible') or p_reason is null
     or (p_scope = 'all_eligible' and (p_reason <> 'authorized_global_activation' or p_evidence_sha256 is null or p_expected_scope_version is null))
     or (p_scope = 'none' and p_reason not in ('authorized_global_deactivation', 'emergency_scope_off'))
     or (p_evidence_sha256 is not null and p_evidence_sha256 !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  if p_expected_scope_version is not null and p_expected_scope_version <> c.scope_version then
    return jsonb_build_object('result', 'stale_version', 'scope_version', c.scope_version);
  end if;
  if c.property_scope = p_scope then return jsonb_build_object('result', 'noop', 'scope', p_scope, 'scope_version', c.scope_version); end if;
  update public.guest_ai_shadow_control
     set property_scope = p_scope, scope_version = c.scope_version + 1, scope_changed_at = now(), scope_changed_by = p_actor,
         scope_evidence_sha256 = p_evidence_sha256
   where id = 1;
  insert into public.guest_ai_shadow_switch_log (subject_kind, from_value, to_value, version, actor, db_role, reason_code, evidence_sha256)
  values ('global', c.property_scope, p_scope, c.scope_version + 1, p_actor, session_user, p_reason, p_evidence_sha256);
  return jsonb_build_object('result', 'applied', 'scope', p_scope, 'scope_version', c.scope_version + 1);
end;
$function$;

-- Interruptor do TENANT. Desligar nunca é bloqueado (versão opcional); religar exige CAS e evidência.
create or replace function public.shadow_set_tenant_enabled(
  p_actor uuid, p_tenant_id uuid, p_enabled boolean, p_expected_version integer, p_reason text, p_evidence_sha256 text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  s public.guest_ai_shadow_tenant_switch%rowtype;
  v_found boolean;
  v_version integer;
begin
  if p_actor is null or p_tenant_id is null or p_enabled is null or p_reason is null
     or p_reason not in ('authorized_enable', 'authorized_disable', 'emergency_disable')
     or (p_enabled and p_reason <> 'authorized_enable') or (not p_enabled and p_reason = 'authorized_enable')
     or (p_evidence_sha256 is not null and p_evidence_sha256 !~ '^[0-9a-f]{64}$')
     or (p_enabled and (p_evidence_sha256 is null or p_expected_version is null)) then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  perform 1 from public.guest_ai_shadow_control where id = 1 for update;
  if not exists (select 1 from public.profiles where id = p_tenant_id) then return jsonb_build_object('result', 'not_found'); end if;
  select * into s from public.guest_ai_shadow_tenant_switch where tenant_id = p_tenant_id for update;
  v_found := found;
  v_version := case when v_found then s.version else 0 end;
  if p_expected_version is not null and p_expected_version <> v_version then
    return jsonb_build_object('result', 'stale_version', 'version', v_version);
  end if;
  if coalesce(s.enabled, true) = p_enabled then return jsonb_build_object('result', 'noop', 'enabled', p_enabled, 'version', v_version); end if;
  insert into public.guest_ai_shadow_tenant_switch (tenant_id, enabled, version, changed_at, changed_by, reason_code)
  values (p_tenant_id, p_enabled, v_version + 1, now(), p_actor, p_reason)
  on conflict (tenant_id) do update
     set enabled = excluded.enabled, version = excluded.version, changed_at = excluded.changed_at,
         changed_by = excluded.changed_by, reason_code = excluded.reason_code;
  insert into public.guest_ai_shadow_switch_log (subject_kind, tenant_id, from_value, to_value, version, actor, db_role, reason_code, evidence_sha256)
  values ('tenant', p_tenant_id, case when coalesce(s.enabled, true) then 'enabled' else 'disabled' end,
          case when p_enabled then 'enabled' else 'disabled' end, v_version + 1, p_actor, session_user, p_reason, p_evidence_sha256);
  return jsonb_build_object('result', 'applied', 'enabled', p_enabled, 'version', v_version + 1);
end;
$function$;

-- Interruptor do IMÓVEL (do tenant informado). Mesmas regras; não afeta nenhum outro imóvel.
create or replace function public.shadow_set_property_enabled(
  p_actor uuid, p_property_id uuid, p_tenant_id uuid, p_enabled boolean, p_expected_version integer,
  p_reason text, p_evidence_sha256 text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  s public.guest_ai_shadow_property_switch%rowtype;
  v_owner uuid;
  v_found boolean;
  v_version integer;
begin
  if p_actor is null or p_property_id is null or p_tenant_id is null or p_enabled is null or p_reason is null
     or p_reason not in ('authorized_enable', 'authorized_disable', 'emergency_disable')
     or (p_enabled and p_reason <> 'authorized_enable') or (not p_enabled and p_reason = 'authorized_enable')
     or (p_evidence_sha256 is not null and p_evidence_sha256 !~ '^[0-9a-f]{64}$')
     or (p_enabled and (p_evidence_sha256 is null or p_expected_version is null)) then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  perform 1 from public.guest_ai_shadow_control where id = 1 for update;
  select * into s from public.guest_ai_shadow_property_switch where property_id = p_property_id for update;
  v_found := found;
  if v_found and s.tenant_id <> p_tenant_id then return jsonb_build_object('result', 'tenant_mismatch'); end if;
  select owner_id into v_owner from public.properties where id = p_property_id;
  -- imóvel já excluído: só desligar é aceito (para registrar a saída); religar exige imóvel do tenant
  if v_owner is null and (p_enabled or not v_found) then return jsonb_build_object('result', 'not_found'); end if;
  if v_owner is not null and v_owner <> p_tenant_id then return jsonb_build_object('result', 'tenant_mismatch'); end if;
  v_version := case when v_found then s.version else 0 end;
  if p_expected_version is not null and p_expected_version <> v_version then
    return jsonb_build_object('result', 'stale_version', 'version', v_version);
  end if;
  if coalesce(s.enabled, true) = p_enabled then return jsonb_build_object('result', 'noop', 'enabled', p_enabled, 'version', v_version); end if;
  insert into public.guest_ai_shadow_property_switch (property_id, tenant_id, enabled, version, changed_at, changed_by, reason_code)
  values (p_property_id, p_tenant_id, p_enabled, v_version + 1, now(), p_actor, p_reason)
  on conflict (property_id) do update
     set enabled = excluded.enabled, version = excluded.version, changed_at = excluded.changed_at,
         changed_by = excluded.changed_by, reason_code = excluded.reason_code;
  insert into public.guest_ai_shadow_switch_log (subject_kind, tenant_id, property_id, from_value, to_value, version, actor, db_role, reason_code, evidence_sha256)
  values ('property', p_tenant_id, p_property_id, case when coalesce(s.enabled, true) then 'enabled' else 'disabled' end,
          case when p_enabled then 'enabled' else 'disabled' end, v_version + 1, p_actor, session_user, p_reason, p_evidence_sha256);
  return jsonb_build_object('result', 'applied', 'enabled', p_enabled, 'version', v_version + 1);
end;
$function$;

-- Foto da elegibilidade de TODOS os imóveis (substitui a anterior) e resumo só com contadores.
create or replace function public.shadow_refresh_eligibility(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare v jsonb;
begin
  if p_actor is null then return jsonb_build_object('result', 'invalid_argument'); end if;
  perform 1 from public.guest_ai_shadow_control where id = 1 for update;
  delete from public.guest_ai_shadow_property_eligibility e where not exists (select 1 from public.properties p where p.id = e.property_id);
  insert into public.guest_ai_shadow_property_eligibility (property_id, tenant_id, eligible, reason_code, rule_version, evaluated_at, evaluated_by)
  select p.id, p.owner_id, r.reason is null, r.reason, 'eligibility.2026-11-05.1', now(), p_actor
    from public.properties p cross join lateral (select public.guest_ai_shadow_eligibility_reason(p.id) as reason) r
  on conflict (property_id) do update
     set tenant_id = excluded.tenant_id, eligible = excluded.eligible, reason_code = excluded.reason_code,
         rule_version = excluded.rule_version, evaluated_at = excluded.evaluated_at, evaluated_by = excluded.evaluated_by;
  select jsonb_build_object('result', 'ok', 'rule_version', 'eligibility.2026-11-05.1',
           'properties', count(*), 'tenants', count(distinct tenant_id), 'eligible', count(*) filter (where eligible),
           'ineligible', count(*) filter (where not eligible),
           'by_reason', coalesce((select jsonb_object_agg(reason_code, n) from (select reason_code, count(*) n from public.guest_ai_shadow_property_eligibility
                                    where not eligible group by reason_code) x), '{}'::jsonb))
    into v from public.guest_ai_shadow_property_eligibility;
  return v;
end;
$function$;

-- Parada de emergência GLOBAL (mesma da preparação do piloto): ready/running ⇒ paused, trava do tick
-- liberada; nada novo começa; execuções em andamento terminam e liquidam; nunca religa nada.
create or replace function public.shadow_emergency_stop(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  r public.guest_ai_shadow_control%rowtype;
begin
  if p_actor is null then return jsonb_build_object('result', 'invalid_argument'); end if;
  select * into r from public.guest_ai_shadow_control where id = 1 for update;
  if r.state in ('ready', 'running') then
    update public.guest_ai_shadow_control
       set state = 'paused', state_version = r.state_version + 1, changed_at = now(), changed_by = p_actor, reason_code = 'authorized_pause',
           tick_owner_token = null, tick_expires_at = null
     where id = 1;
    insert into public.guest_ai_shadow_transitions (from_state, to_state, state_version, actor, automatic, reason_code)
    values (r.state, 'paused', r.state_version + 1, p_actor, false, 'authorized_pause');
    return jsonb_build_object('result', 'stopped', 'from', r.state, 'state', 'paused', 'state_version', r.state_version + 1);
  end if;
  update public.guest_ai_shadow_control set tick_owner_token = null, tick_expires_at = null where id = 1;
  return jsonb_build_object('result', 'already_stopped', 'state', r.state, 'state_version', r.state_version);
end;
$function$;

-- ───────────────────────── Redefinições ─────────────────────────
create or replace function public.shadow_get_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  select * into c from public.guest_ai_shadow_control where id = 1;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  return jsonb_build_object(
    'result', 'ok', 'state', c.state, 'state_version', c.state_version, 'model_id', c.model_id, 'reasoning_effort', c.reasoning_effort,
    'max_input_tokens', c.max_input_tokens, 'max_output_tokens', c.max_output_tokens, 'max_total_tokens', c.max_total_tokens,
    'max_turn_cost_usd', c.max_turn_cost_usd, 'daily_cost_limit_usd', c.daily_cost_limit_usd, 'max_daily_tokens', c.max_daily_tokens,
    'max_daily_calls', c.max_daily_calls, 'error_window_minutes', c.error_window_minutes, 'error_min_sample', c.error_min_sample,
    'budget_day_timezone', c.budget_day_timezone, 'telemetry_retention_days', c.telemetry_retention_days,
    'tick_interval_seconds', c.tick_interval_seconds, 'max_conversations_per_tick', c.max_conversations_per_tick,
    'retention_scope', c.retention_scope,
    -- escopo GLOBAL de imóveis (E4 global): 'none' ⇒ nenhum imóvel participa
    'property_scope', c.property_scope, 'scope_version', c.scope_version,
    'retention_authorized', c.retention_scope is not null and c.retention_authorized_at is not null,
    -- F-09/F-03: o instante do BANCO; o worker ancora nele todo instante de parede (pausa, coletor, registro)
    'db_now', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$function$;

create or replace function public.guest_ai_shadow_reconcile_core(c public.guest_ai_shadow_control)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  f public.guest_ai_shadow_inflight%rowtype;
  r public.guest_ai_conversation_leases%rowtype;
  v_set jsonb;
  v_ins jsonb;
  v_n integer := 0;
  v_ms bigint;
  v_last text := null;
begin
  -- controle já travado pelo chamador (FOR UPDATE)
  for f in select * from public.guest_ai_shadow_inflight where status = 'running' order by started_at for update loop
    select * into r from public.guest_ai_conversation_leases where conversation_id = f.conversation_id for update;
    -- worker vivo dentro do prazo do lease: não é órfão
    continue when found and r.version = f.lease_version and r.state = 'processing' and r.lease_expires_at > now();
    if found and r.batch_id = f.batch_id and (
         (r.version = f.lease_version and r.state = 'processing')
         or (r.state in ('expired', 'cancelled', 'failed') and cardinality(coalesce(r.message_ids, '{}')) > 0)) then
      perform public.guest_ai_shadow_seal_lease(r, 'failed');
    end if;
    v_set := public.guest_ai_shadow_settle_locked(c, f.execution_id, 'orphan_worst_case', null, null, null);
    v_ms := least(2147483647, greatest(0, floor(extract(epoch from (now() - f.started_at)) * 1000)))::bigint;
    v_ins := public.guest_ai_shadow_insert_execution(jsonb_build_object(
      'execution_id', f.execution_id, 'tenant_id', f.tenant_id, 'property_id', f.property_id, 'conversation_id', f.conversation_id,
      'batch_id', f.batch_id, 'lease_version', f.lease_version, 'channel', f.channel,
      'chain_version', 'db-reconcile.2026-11-04.1', 'shadow_version', 'db-reconcile.2026-11-04.1', 'composer_version', null,
      'model_id', c.model_id, 'started_at', f.started_at, 'finished_at', now(), 'total_ms', v_ms, 'lease_ms', 0, 'context_ms', 0,
      'gateway_ms', 0, 'validation_ms', 0, 'timing_context', null, 'timing_dossier', null, 'timing_history', null, 'timing_scope_check', null,
      'timing_stay_authorizations', null, 'timing_human_ownership', null, 'timing_human_pause', null, 'timing_sender_identity', null,
      'timing_guard', null, 'timing_compose', null, 'timing_model_output', null, 'timing_parse', null, 'timing_structural_validation', null,
      'timing_semantic_validation', null, 'timing_final_decision', null) || jsonb_build_object(
      -- uso desconhecido: o registro conta o que foi LIQUIDADO (pior caso), nunca menos
      'input_tokens', 0, 'output_tokens', 0, 'reasoning_tokens', 0,
      'total_tokens', coalesce((select settled_tokens from public.guest_ai_shadow_budget_reservations where execution_id = f.execution_id), 0),
      'usage_source', 'none',
      'cost_usd', coalesce((select settled_cost from public.guest_ai_shadow_budget_reservations where execution_id = f.execution_id), 0),
      'gateway_calls', coalesce((select settled_calls from public.guest_ai_shadow_budget_reservations where execution_id = f.execution_id), 0),
      'estimated_input_tokens', null, 'candidate_available', false, 'decision', 'technical_failure', 'strategy', null,
      'intents', '[]'::jsonb, 'intent_count', 0, 'commitment_kinds', '[]'::jsonb, 'human_intervention_needed', false, 'handoff_urgency', null,
      'pause_state', 'not_evaluated', 'context_check', 'not_run', 'execution_state', 'failed', 'response_discarded', true, 'timeout', false,
      'token_limit_violation', false, 'concurrency_detected', false, 'gateway_error', null, 'budget_exceeded', null, 'refusal_code', null,
      'technical_code', 'worker_lost', 'block_code', null, 'integrity_code', null));
    if v_ins->>'result' <> 'inserted' then
      raise exception using errcode = 'P0001', message = 'shadow_reconcile_record_rejected';
    end if;
    update public.guest_ai_shadow_inflight set status = 'reconciled', closed_at = now() where execution_id = f.execution_id;
    v_n := v_n + 1;
    if (v_set->>'day_exhausted')::boolean then
      perform public.guest_ai_shadow_trip_locked(c, 'budget_exhausted', 'budget_limit_reached');
      select * into c from public.guest_ai_shadow_control where id = 1;
    end if;
    v_last := 'technical_failure';
  end loop;
  if v_n > 0 then
    return jsonb_build_object('result', 'ok', 'reconciled', v_n) || public.guest_ai_shadow_breakers_locked(c, v_last);
  end if;
  return jsonb_build_object('result', 'ok', 'reconciled', 0);
end;
$function$;

-- Reconciliação: o corpo vira interno (controle travado pelo chamador) para servir ao tick e ao operador.
create or replace function public.shadow_reconcile(p_tick_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  if p_tick_token is null or p_tick_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('result', 'invalid_argument'); end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  if c.tick_owner_token is distinct from p_tick_token or c.tick_expires_at <= now() then
    return jsonb_build_object('result', 'tick_not_held');
  end if;
  return public.guest_ai_shadow_reconcile_core(c);
end;
$function$;

-- ADMIN (só o dono): reconciliação com o Shadow parado. Recusa se um tick estiver com a trava vigente;
-- nunca toca execução cujo lease ainda vale.
create or replace function public.shadow_admin_reconcile(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  if p_actor is null then return jsonb_build_object('result', 'invalid_argument'); end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  if c.tick_owner_token is not null and c.tick_expires_at > now() then return jsonb_build_object('result', 'tick_busy'); end if;
  return public.guest_ai_shadow_reconcile_core(c);
end;
$function$;

-- ───────────────────────── Privilégios ─────────────────────────
do $$
declare f text;
begin
  -- internas e administrativas: SEM EXECUTE para ninguém além do dono
  foreach f in array array[
    'public.guest_ai_shadow_eligibility_reason(uuid)',
    'public.guest_ai_shadow_property_gate(uuid, uuid)',
    'public.guest_ai_shadow_reconcile_core(public.guest_ai_shadow_control)',
    'public.shadow_set_scope(uuid, integer, text, text, text)',
    'public.shadow_set_tenant_enabled(uuid, uuid, boolean, integer, text, text)',
    'public.shadow_set_property_enabled(uuid, uuid, uuid, boolean, integer, text, text)',
    'public.shadow_refresh_eligibility(uuid)',
    'public.shadow_emergency_stop(uuid)',
    'public.shadow_admin_reconcile(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on function %s from sandbox_exec', f);
    end if;
  end loop;
  -- RPCs do WORKER (novas ou redefinidas): só service_role
  foreach f in array array[
    'public.shadow_get_control()',
    'public.shadow_property_status(uuid, uuid)',
    'public.shadow_list_candidates(text, integer, integer)',
    'public.shadow_reconcile(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on function %s from sandbox_exec', f);
    end if;
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
