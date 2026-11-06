-- ConciergeIA Guest AI · MEMÓRIA DO HÓSPEDE RECORRENTE (diretriz do titular, 06/11/2026) — ETAPA A: ESTRUTURA.
--
-- Esta migration NÃO agenda, NÃO ativa e NÃO executa nenhum processamento. A ativação (cron, secrets,
-- carga retroativa) é a ETAPA B, em `ops/guest-memory/`, e depende de autorização específica do titular.
--
-- Perfil canônico do hóspede POR CONTA (tenant_id = dono do imóvel), alimentado pela Channex (fonte da
-- verdade). Identidades em tabela própria, com UNICIDADE por conta, para que um identificador nunca aponte
-- para dois perfis:
--   · Porta 1 (dentro da plataforma): conta do hóspede na OTA, `ota` = '<ota>:<id>'. No Airbnb é o
--     `reservation.guest_id` do payload bruto da reserva (id da conta, não da reserva).
--   · Porta 2 (fora da plataforma): telefone OFICIAL DO TITULAR em E.164 (`phone` = '+<DDI><número>'),
--     o `customer.phone` da reserva na Channex. Número reciclado: o mesmo telefone em perfis com nomes
--     incompatíveis vira `conflict` e deixa de identificar qualquer pessoa.
-- O perfil é EXCLUSIVO DO TITULAR (contratante). Só entram identidades entregues pela Channex para o
-- titular. Telefone de WhatsApp de quem conversa NUNCA vira identidade do perfil, nem com o código da
-- reserva: pode ser um acompanhante. Esse número pertence só à conversa.
-- Memória em um único registro, com partes DISTINTAS que conversam entre si:
--   · `behavioral_notes`: notas de hospitalidade consolidadas (vão ao prompt de atendimento);
--   · `internal_assessment`: avaliação interna consolidada (comunicação, regras e horários, cuidado com o
--     imóvel, incidentes), SÓ para a equipe, nunca ao prompt de atendimento;
--   · `stay_summaries`: resumo de cada estadia, gravado somente depois do checkout confirmado, com as duas
--     partes separadas; a consolidação sempre considera este histórico.
-- Nada de dado financeiro, pagamento, documento, e-mail ou endereço. As notas são resumo de hospitalidade.
-- Acesso: RLS ligada e NENHUMA política; nada para anon/authenticated. Só service_role (servidor).
-- Funções: SECURITY DEFINER, search_path fixo, EXECUTE só service_role.

create table if not exists public.guest_ai_guest_profiles (
  canonical_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  ota_account_ids text[] not null default '{}',
  phones text[] not null default '{}',
  guest_name text,
  behavioral_notes jsonb not null default '[]'::jsonb,
  internal_assessment jsonb not null default '{}'::jsonb,
  stay_summaries jsonb not null default '[]'::jsonb,
  stay_count integer not null default 0,
  last_stay_checkout date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_ai_guest_profiles_notes_shape check (
    jsonb_typeof(behavioral_notes) = 'array' and jsonb_array_length(behavioral_notes) <= 20
  ),
  constraint guest_ai_guest_profiles_assessment_shape check (jsonb_typeof(internal_assessment) = 'object'),
  constraint guest_ai_guest_profiles_stays_shape check (
    jsonb_typeof(stay_summaries) = 'array' and jsonb_array_length(stay_summaries) <= 100
  ),
  constraint guest_ai_guest_profiles_stay_count check (stay_count >= 0),
  constraint guest_ai_guest_profiles_name_len check (guest_name is null or char_length(guest_name) <= 200)
);
create index if not exists guest_ai_guest_profiles_tenant_idx on public.guest_ai_guest_profiles (tenant_id);

create table if not exists public.guest_ai_guest_identities (
  tenant_id uuid not null,
  kind text not null check (kind in ('ota', 'phone')),
  value text not null,
  canonical_id uuid not null references public.guest_ai_guest_profiles (canonical_id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'conflict')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, kind, value),
  constraint guest_ai_guest_identities_value_shape check (
    (kind = 'ota' and value ~ '^[a-z][a-z0-9_]{1,31}:[A-Za-z0-9_-]{1,64}$')
    or (kind = 'phone' and value ~ '^\+[1-9][0-9]{7,14}$')
  )
);
create index if not exists guest_ai_guest_identities_profile_idx on public.guest_ai_guest_identities (canonical_id);

alter table public.guest_ai_guest_profiles enable row level security;
alter table public.guest_ai_guest_identities enable row level security;
revoke all on public.guest_ai_guest_profiles from public, anon, authenticated;
revoke all on public.guest_ai_guest_identities from public, anon, authenticated;
grant select, insert, update, delete on public.guest_ai_guest_profiles to service_role;
grant select, insert, update, delete on public.guest_ai_guest_identities to service_role;

-- Controle do processo pós-checkout (ETAPA A: só estrutura; nada aqui agenda ou ativa o processamento).
-- Uma linha por reserva (estado atual) + uma linha por TENTATIVA (auditoria e custo). A aquisição da estadia é
-- exclusiva e atômica (`guest_ai_claim_stay_memory`), com prazo de posse (lease) e recuperação de posse
-- abandonada; no máximo 3 tentativas por reserva; custo reservado ANTES da chamada ao modelo e somado ao teto
-- diário, inclusive de tentativas concorrentes ou interrompidas (contadas pelo valor reservado).
create table if not exists public.guest_ai_stay_memory_runs (
  reservation_id uuid primary key,
  tenant_id uuid not null,
  status text not null check (status in ('processing', 'done', 'skipped', 'failed')),
  reason text check (reason is null or char_length(reason) <= 64),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 3),
  lease_token uuid,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint guest_ai_stay_memory_runs_lease check (
    (status = 'processing') = (lease_token is not null and lease_expires_at is not null)
  )
);
create table if not exists public.guest_ai_stay_memory_attempts (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null,
  tenant_id uuid not null,
  attempt integer not null check (attempt between 1 and 3),
  lease_token uuid not null unique,
  reserved_usd numeric(10, 6) not null check (reserved_usd > 0 and reserved_usd <= 0.05),
  spent_usd numeric(10, 6) check (spent_usd is null or spent_usd >= 0),
  outcome text check (outcome is null or outcome in ('done', 'skipped', 'failed', 'abandoned')),
  reason text check (reason is null or char_length(reason) <= 64),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists guest_ai_stay_memory_attempts_day_idx on public.guest_ai_stay_memory_attempts (started_at);
create index if not exists guest_ai_stay_memory_attempts_res_idx on public.guest_ai_stay_memory_attempts (reservation_id);
alter table public.guest_ai_stay_memory_runs enable row level security;
alter table public.guest_ai_stay_memory_attempts enable row level security;
revoke all on public.guest_ai_stay_memory_runs from public, anon, authenticated;
revoke all on public.guest_ai_stay_memory_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.guest_ai_stay_memory_runs to service_role;
grant select, insert, update, delete on public.guest_ai_stay_memory_attempts to service_role;

-- Telefone em E.164 a partir do que a Channex entrega ('+55 47 9...', '5547...', '0055...').
-- Sem DDI comprovado não há palpite: 8 a 15 dígitos depois de remover '00' inicial; senão NULL.
create or replace function public.guest_ai_normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when d ~ '^[1-9][0-9]{7,14}$' then '+' || d
    else null
  end
  from (select regexp_replace(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '^00', '') as d) s
$$;

-- Nomes compatíveis só com correspondência SUBSTANCIAL (sem acento, sem caixa, por palavra inteira):
--   · as palavras do nome menor (pelo menos duas) estão todas no outro ("João Pedro" ⊂ "João Pedro Alves"); ou
--   · mesmo primeiro nome E pelo menos um sobrenome em comum ("Ana Paula Ribeiro" × "Ana Souza Ribeiro").
-- Só o primeiro nome igual NÃO basta ("Carlos Silva" × "Carlos Junior"). Nome ausente ⇒ incompatível.
create or replace function public.guest_ai_guest_name_compatible(a text, b text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  with n as (
    select
      array_remove(string_to_array(btrim(regexp_replace(lower(translate(coalesce(a, ''),
        'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ', 'aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuuccnn')),
        '[^a-z]+', ' ', 'g')), ' '), '') as x,
      array_remove(string_to_array(btrim(regexp_replace(lower(translate(coalesce(b, ''),
        'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ', 'aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuuccnn')),
        '[^a-z]+', ' ', 'g')), ' '), '') as y
  )
  select case
    when cardinality(x) = 0 or cardinality(y) = 0 then false
    when least(cardinality(x), cardinality(y)) >= 2 and (x <@ y or y <@ x) then true
    when cardinality(x) >= 2 and cardinality(y) >= 2 and x[1] = y[1]
         and x[2:cardinality(x)] && y[2:cardinality(y)] then true
    else false
  end
  from n
$$;

-- Vincula UMA identidade a um perfil (uso do worker de sincronização; nunca do navegador).
-- Resultados: linked | already_linked | taken (conta OTA de outro perfil) | matches_other_profile
-- (telefone de outro perfil com nome compatível: o chamador decide a unificação) | conflict (telefone
-- reciclado: nomes incompatíveis ⇒ o telefone deixa de identificar qualquer perfil) | invalid.
create or replace function public.guest_ai_link_guest_identity(
  p_tenant_id uuid, p_canonical_id uuid, p_kind text, p_value text, p_guest_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_profile public.guest_ai_guest_profiles;
  v_other public.guest_ai_guest_profiles;
  v_ident public.guest_ai_guest_identities;
  v_value text;
begin
  if p_tenant_id is null or p_canonical_id is null or p_kind not in ('ota', 'phone') or p_value is null then
    return jsonb_build_object('result', 'invalid', 'reason', 'arguments');
  end if;
  v_value := case when p_kind = 'phone' then public.guest_ai_normalize_phone(p_value) else lower(btrim(p_value)) end;
  if v_value is null
     or (p_kind = 'ota' and v_value !~ '^[a-z][a-z0-9_]{1,31}:[a-z0-9_-]{1,64}$') then
    return jsonb_build_object('result', 'invalid', 'reason', 'value');
  end if;
  select * into v_profile from public.guest_ai_guest_profiles
   where canonical_id = p_canonical_id and tenant_id = p_tenant_id for update;
  if not found then
    return jsonb_build_object('result', 'invalid', 'reason', 'profile');
  end if;

  perform pg_advisory_xact_lock(hashtext('guest_ai_identity'), hashtext(p_tenant_id::text || '|' || p_kind || '|' || v_value));
  select * into v_ident from public.guest_ai_guest_identities
   where tenant_id = p_tenant_id and kind = p_kind and value = v_value for update;

  if not found then
    insert into public.guest_ai_guest_identities (tenant_id, kind, value, canonical_id)
    values (p_tenant_id, p_kind, v_value, p_canonical_id);
    update public.guest_ai_guest_profiles
       set ota_account_ids = case when p_kind = 'ota' then array(select distinct unnest(ota_account_ids || v_value)) else ota_account_ids end,
           phones = case when p_kind = 'phone' then array(select distinct unnest(phones || v_value)) else phones end,
           updated_at = now()
     where canonical_id = p_canonical_id;
    return jsonb_build_object('result', 'linked', 'canonical_id', p_canonical_id);
  end if;

  if v_ident.status = 'conflict' then
    return jsonb_build_object('result', 'conflict');
  end if;
  if v_ident.canonical_id = p_canonical_id then
    return jsonb_build_object('result', 'already_linked', 'canonical_id', p_canonical_id);
  end if;
  if p_kind = 'ota' then
    return jsonb_build_object('result', 'taken', 'canonical_id', v_ident.canonical_id);
  end if;

  select * into v_other from public.guest_ai_guest_profiles where canonical_id = v_ident.canonical_id;
  if public.guest_ai_guest_name_compatible(v_other.guest_name, coalesce(p_guest_name, v_profile.guest_name)) then
    return jsonb_build_object('result', 'matches_other_profile', 'canonical_id', v_ident.canonical_id);
  end if;
  -- número reciclado: ninguém passa a ser identificado por ele
  update public.guest_ai_guest_identities
     set status = 'conflict', updated_at = now()
   where tenant_id = p_tenant_id and kind = p_kind and value = v_value;
  update public.guest_ai_guest_profiles
     set phones = array_remove(phones, v_value), updated_at = now()
   where canonical_id = v_ident.canonical_id;
  return jsonb_build_object('result', 'conflict');
end
$$;

-- Resolução (somente leitura): conta OTA primeiro; depois telefone ATIVO. Telefones que apontam para
-- perfis diferentes ⇒ conflict (nunca escolhe um). Tudo restrito ao tenant informado.
create or replace function public.guest_ai_resolve_guest_profile(
  p_tenant_id uuid, p_ota_account_id text, p_phones text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid;
  v_ids uuid[];
  v_phones text[];
begin
  if p_tenant_id is null then
    return jsonb_build_object('result', 'invalid');
  end if;
  if p_ota_account_id is not null then
    select canonical_id into v_id from public.guest_ai_guest_identities
     where tenant_id = p_tenant_id and kind = 'ota' and value = lower(btrim(p_ota_account_id)) and status = 'active';
    if found then
      return jsonb_build_object('result', 'found', 'canonical_id', v_id, 'via', 'ota');
    end if;
  end if;
  select array_agg(distinct x) into v_phones
    from (select public.guest_ai_normalize_phone(p) as x from unnest(coalesce(p_phones, '{}'::text[])) p) s
   where x is not null;
  if v_phones is null then
    return jsonb_build_object('result', 'not_found');
  end if;
  if exists (select 1 from public.guest_ai_guest_identities
              where tenant_id = p_tenant_id and kind = 'phone' and value = any (v_phones) and status = 'conflict') then
    return jsonb_build_object('result', 'conflict');
  end if;
  select array_agg(distinct canonical_id) into v_ids from public.guest_ai_guest_identities
   where tenant_id = p_tenant_id and kind = 'phone' and value = any (v_phones) and status = 'active';
  if v_ids is null then
    return jsonb_build_object('result', 'not_found');
  end if;
  if cardinality(v_ids) > 1 then
    return jsonb_build_object('result', 'conflict');
  end if;
  return jsonb_build_object('result', 'found', 'canonical_id', v_ids[1], 'via', 'phone');
end
$$;

-- Garante o perfil do TITULAR de uma reserva da Channex (carga retroativa e processo pós-checkout).
-- Só identidades do titular: conta OTA e telefones oficiais. Resolução: conta OTA; senão telefone ativo com
-- nome compatível; senão cria. Telefones em conflito não criam perfil órfão (sem âncora válida ⇒ skipped).
create or replace function public.guest_ai_upsert_titular_profile(
  p_tenant_id uuid, p_ota_account_id text, p_phones text[], p_guest_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_ota text := nullif(lower(btrim(coalesce(p_ota_account_id, ''))), '');
  v_phones text[];
  v_res jsonb;
  v_id uuid;
  v_created boolean := false;
  v_name text := nullif(btrim(coalesce(p_guest_name, '')), '');
  p text;
begin
  if p_tenant_id is null then
    return jsonb_build_object('result', 'invalid', 'reason', 'arguments');
  end if;
  if v_ota is not null and v_ota !~ '^[a-z][a-z0-9_]{1,31}:[a-z0-9_-]{1,64}$' then
    v_ota := null;
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_phones
    from (select public.guest_ai_normalize_phone(ph) as x from unnest(coalesce(p_phones, '{}'::text[])) ph) s
   where x is not null;
  if v_ota is null and cardinality(v_phones) = 0 then
    return jsonb_build_object('result', 'skipped', 'reason', 'no_anchor');
  end if;
  perform pg_advisory_xact_lock(hashtext('guest_ai_titular'), hashtext(p_tenant_id::text));

  v_res := public.guest_ai_resolve_guest_profile(p_tenant_id, v_ota, v_phones);
  if v_res ->> 'result' = 'found' then
    v_id := (v_res ->> 'canonical_id')::uuid;
    if v_res ->> 'via' = 'phone' and not exists (
      select 1 from public.guest_ai_guest_profiles g
       where g.canonical_id = v_id and public.guest_ai_guest_name_compatible(g.guest_name, v_name)) then
      v_id := null; -- telefone de outra pessoa (nome incompatível): não reaproveita o perfil
    end if;
  elsif v_res ->> 'result' = 'conflict' and v_ota is null then
    return jsonb_build_object('result', 'skipped', 'reason', 'conflict');
  end if;

  if v_id is null then
    insert into public.guest_ai_guest_profiles (tenant_id, guest_name) values (p_tenant_id, left(v_name, 200))
    returning canonical_id into v_id;
    v_created := true;
  else
    update public.guest_ai_guest_profiles
       set guest_name = coalesce(guest_name, left(v_name, 200)), updated_at = now()
     where canonical_id = v_id;
  end if;

  if v_ota is not null then
    perform public.guest_ai_link_guest_identity(p_tenant_id, v_id, 'ota', v_ota, v_name);
  end if;
  foreach p in array v_phones loop
    perform public.guest_ai_link_guest_identity(p_tenant_id, v_id, 'phone', p, v_name);
  end loop;
  return jsonb_build_object('result', 'ok', 'canonical_id', v_id, 'created', v_created);
end
$$;

-- Grava o resumo de UMA estadia concluída (checkout confirmado) e a memória consolidada, atomicamente.
-- Idempotente por reserva: a mesma estadia nunca é resumida duas vezes. As duas partes ficam separadas:
-- `behavioral_notes` (hospitalidade, vai ao prompt) e `internal_assessment` (só equipe).
create or replace function public.guest_ai_record_stay_summary(
  p_tenant_id uuid, p_canonical_id uuid, p_reservation_id uuid, p_checkout date,
  p_summary jsonb, p_behavioral_notes jsonb, p_internal_assessment jsonb, p_lease_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v public.guest_ai_guest_profiles;
  v_stays jsonb;
begin
  if p_tenant_id is null or p_canonical_id is null or p_reservation_id is null or p_checkout is null
     or jsonb_typeof(p_summary) is distinct from 'object'
     or jsonb_typeof(p_behavioral_notes) is distinct from 'array' or jsonb_array_length(p_behavioral_notes) > 20
     or jsonb_typeof(p_internal_assessment) is distinct from 'object' then
    return jsonb_build_object('result', 'invalid', 'reason', 'arguments');
  end if;
  -- só grava quem detém a posse VIGENTE da estadia (worker atrasado com posse vencida não grava)
  if p_lease_token is null or not exists (
    select 1 from public.guest_ai_stay_memory_runs m
     where m.reservation_id = p_reservation_id and m.tenant_id = p_tenant_id and m.status = 'processing'
       and m.lease_token = p_lease_token and m.lease_expires_at > now()) then
    return jsonb_build_object('result', 'lease_lost');
  end if;
  select * into v from public.guest_ai_guest_profiles
   where canonical_id = p_canonical_id and tenant_id = p_tenant_id for update;
  if not found then
    return jsonb_build_object('result', 'invalid', 'reason', 'profile');
  end if;
  if exists (select 1 from jsonb_array_elements(v.stay_summaries) e where e ->> 'reservation_id' = p_reservation_id::text) then
    return jsonb_build_object('result', 'exists');
  end if;
  v_stays := v.stay_summaries || jsonb_build_array(
    p_summary || jsonb_build_object('reservation_id', p_reservation_id, 'checkout_date', p_checkout, 'recorded_at', now()));
  if jsonb_array_length(v_stays) > 100 then
    v_stays := (select jsonb_agg(e order by ord) from jsonb_array_elements(v_stays) with ordinality t(e, ord)
                 where ord > jsonb_array_length(v_stays) - 100);
  end if;
  update public.guest_ai_guest_profiles
     set stay_summaries = v_stays,
         behavioral_notes = p_behavioral_notes,
         internal_assessment = p_internal_assessment,
         stay_count = v.stay_count + 1,
         last_stay_checkout = greatest(coalesce(v.last_stay_checkout, p_checkout), p_checkout),
         updated_at = now()
   where canonical_id = p_canonical_id;
  return jsonb_build_object('result', 'recorded');
end
$$;

-- Estadias com CHECKOUT CONFIRMADO no sistema (cartão de checkout concluído; no-show e cancelada fora) ainda
-- sem memória concluída, sem posse ativa e com menos de 3 tentativas. Mais antigas primeiro. Só LISTA: quem
-- processa precisa adquirir a estadia em `guest_ai_claim_stay_memory`.
create or replace function public.guest_ai_pending_stay_memories(p_limit integer)
returns table (reservation_id uuid, property_id uuid, tenant_id uuid, checkout_date date, checkout_confirmed_at timestamptz)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  return query
  select r.id, r.property_id, p.owner_id, r.checkout_date::date,
         coalesce(g.concluded_at, g.done_at, g.updated_at)
    from public.guest_arrival_status g
    join public.property_reservations r on r.id = g.reservation_id
    join public.properties p on p.id = r.property_id
   where g.kind = 'checkout'
     and coalesce(g.status, '') <> 'no_show'
     and (g.status = 'done' or g.done_at is not null or g.concluded_at is not null)
     and coalesce(r.status, '') <> 'cancelled'
     and p.owner_id is not null
     and not exists (
       select 1 from public.guest_ai_stay_memory_runs m
        where m.reservation_id = r.id
          and (m.status in ('done', 'skipped')
               or m.attempts >= 3
               or (m.status = 'processing' and m.lease_expires_at > now())))
   order by coalesce(g.concluded_at, g.done_at, g.updated_at) asc, r.id
   limit greatest(1, least(coalesce(p_limit, 10), 10));
end
$$;

-- Aquisição EXCLUSIVA e atômica de uma estadia (serializada por trava global de transação):
--   completed (já concluída) | busy (outro worker com posse válida) | exhausted (3 tentativas) |
--   budget_daily_exceeded (teto diário somado às reservas em curso) | invalid | claimed (+ token, tentativa).
-- Posse vencida é recuperada: a tentativa anterior fecha como `abandoned`, contada pelo valor reservado.
create or replace function public.guest_ai_claim_stay_memory(
  p_reservation_id uuid, p_tenant_id uuid, p_lease_seconds integer, p_reserve_usd numeric, p_daily_cap_usd numeric)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v public.guest_ai_stay_memory_runs;
  v_token uuid;
  v_attempt integer;
  v_spent numeric;
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'UTC')) at time zone 'UTC';
begin
  if p_reservation_id is null or p_tenant_id is null
     or p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 1800
     or p_reserve_usd is null or p_reserve_usd <= 0 or p_reserve_usd > 0.05
     or p_daily_cap_usd is null or p_daily_cap_usd <= 0 or p_daily_cap_usd > 10 then
    return jsonb_build_object('result', 'invalid', 'reason', 'arguments');
  end if;
  -- a reserva precisa ser da conta informada
  if not exists (select 1 from public.property_reservations r join public.properties p on p.id = r.property_id
                  where r.id = p_reservation_id and p.owner_id = p_tenant_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'scope');
  end if;
  perform pg_advisory_xact_lock(hashtext('guest_ai_stay_memory_claim'));

  select * into v from public.guest_ai_stay_memory_runs where reservation_id = p_reservation_id for update;
  if found then
    if v.status in ('done', 'skipped') then
      return jsonb_build_object('result', 'completed');
    end if;
    if v.status = 'processing' and v.lease_expires_at > now() then
      return jsonb_build_object('result', 'busy');
    end if;
    if v.status = 'processing' then
      -- posse abandonada (worker interrompido): fecha a tentativa pelo valor reservado
      update public.guest_ai_stay_memory_attempts
         set finished_at = now(), outcome = 'abandoned', reason = 'lease_expired', spent_usd = reserved_usd
       where lease_token = v.lease_token and finished_at is null;
      update public.guest_ai_stay_memory_runs
         set status = 'failed', reason = 'lease_expired', lease_token = null, lease_expires_at = null, updated_at = now()
       where reservation_id = p_reservation_id
       returning * into v;
    end if;
    if v.attempts >= 3 then
      return jsonb_build_object('result', 'exhausted');
    end if;
  end if;

  select coalesce(sum(coalesce(a.spent_usd, a.reserved_usd)), 0) into v_spent
    from public.guest_ai_stay_memory_attempts a
   where a.started_at >= v_day_start;
  if v_spent + p_reserve_usd > p_daily_cap_usd then
    return jsonb_build_object('result', 'budget_daily_exceeded');
  end if;

  v_token := gen_random_uuid();
  insert into public.guest_ai_stay_memory_runs (reservation_id, tenant_id, status, reason, attempts, lease_token, lease_expires_at, updated_at)
  values (p_reservation_id, p_tenant_id, 'processing', null, 1, v_token, now() + make_interval(secs => p_lease_seconds), now())
  on conflict (reservation_id) do update
    set status = 'processing', reason = null,
        attempts = public.guest_ai_stay_memory_runs.attempts + 1,
        lease_token = v_token, lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  returning attempts into v_attempt;
  insert into public.guest_ai_stay_memory_attempts (reservation_id, tenant_id, attempt, lease_token, reserved_usd)
  values (p_reservation_id, p_tenant_id, v_attempt, v_token, p_reserve_usd);
  return jsonb_build_object('result', 'claimed', 'token', v_token, 'attempt', v_attempt);
end
$$;

-- Encerra a posse com o desfecho e o custo real. Só quem tem o token vigente encerra (lease_lost caso contrário).
create or replace function public.guest_ai_finish_stay_memory(
  p_reservation_id uuid, p_token uuid, p_status text, p_reason text, p_spent_usd numeric)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_reservation_id is null or p_token is null or p_status not in ('done', 'skipped', 'failed')
     or p_spent_usd is null or p_spent_usd < 0 then
    return jsonb_build_object('result', 'invalid', 'reason', 'arguments');
  end if;
  update public.guest_ai_stay_memory_runs
     set status = p_status, reason = left(p_reason, 64), lease_token = null, lease_expires_at = null, updated_at = now()
   where reservation_id = p_reservation_id and status = 'processing' and lease_token = p_token;
  if not found then
    return jsonb_build_object('result', 'lease_lost');
  end if;
  update public.guest_ai_stay_memory_attempts
     set finished_at = now(), outcome = p_status, reason = left(p_reason, 64), spent_usd = p_spent_usd
   where lease_token = p_token;
  return jsonb_build_object('result', 'finished');
end
$$;

revoke all on function public.guest_ai_normalize_phone(text) from public, anon, authenticated;
revoke all on function public.guest_ai_guest_name_compatible(text, text) from public, anon, authenticated;
revoke all on function public.guest_ai_link_guest_identity(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.guest_ai_resolve_guest_profile(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.guest_ai_normalize_phone(text) to service_role;
grant execute on function public.guest_ai_guest_name_compatible(text, text) to service_role;
grant execute on function public.guest_ai_link_guest_identity(uuid, uuid, text, text, text) to service_role;
grant execute on function public.guest_ai_resolve_guest_profile(uuid, text, text[]) to service_role;
revoke all on function public.guest_ai_upsert_titular_profile(uuid, text, text[], text) from public, anon, authenticated;
revoke all on function public.guest_ai_record_stay_summary(uuid, uuid, uuid, date, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.guest_ai_upsert_titular_profile(uuid, text, text[], text) to service_role;
grant execute on function public.guest_ai_record_stay_summary(uuid, uuid, uuid, date, jsonb, jsonb, jsonb, uuid) to service_role;
revoke all on function public.guest_ai_pending_stay_memories(integer) from public, anon, authenticated;
revoke all on function public.guest_ai_claim_stay_memory(uuid, uuid, integer, numeric, numeric) from public, anon, authenticated;
revoke all on function public.guest_ai_finish_stay_memory(uuid, uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.guest_ai_pending_stay_memories(integer) to service_role;
grant execute on function public.guest_ai_claim_stay_memory(uuid, uuid, integer, numeric, numeric) to service_role;
grant execute on function public.guest_ai_finish_stay_memory(uuid, uuid, text, text, numeric) to service_role;
