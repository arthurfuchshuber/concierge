-- ConciergeIA Guest AI · MEMÓRIA DO HÓSPEDE RECORRENTE (diretriz do titular, 06/11/2026).
--
-- Perfil canônico do hóspede POR CONTA (tenant_id = dono do imóvel), alimentado pela Channex (fonte da
-- verdade). Identidades em tabela própria, com UNICIDADE por conta, para que um identificador nunca aponte
-- para dois perfis:
--   · Porta 1 (dentro da plataforma): conta do hóspede na OTA, `ota` = '<ota>:<id>'. No Airbnb é o
--     `reservation.guest_id` do payload bruto da reserva (id da conta, não da reserva).
--   · Porta 2 (fora da plataforma): telefone em E.164 (`phone` = '+<DDI><número>'), vindo da reserva.
--     Número reciclado: o mesmo telefone em perfis com nomes incompatíveis vira `conflict` e deixa de
--     identificar qualquer pessoa. Número novo no WhatsApp só entra com o código oficial da reserva
--     (resolvido pela reserva vinculada à conversa; nunca por nome ou coincidência parcial).
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
  stay_count integer not null default 0,
  last_stay_checkout date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_ai_guest_profiles_notes_shape check (
    jsonb_typeof(behavioral_notes) = 'array' and jsonb_array_length(behavioral_notes) <= 20
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

-- Nomes compatíveis: mesmo primeiro nome (sem acento, sem caixa), ou as palavras de um nome estão todas
-- no outro. Comparação por PALAVRA inteira ("Ana" não casa com "Mariana"). Nome ausente ⇒ incompatível.
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
    when length(x[1]) >= 2 and x[1] = y[1] then true
    when x <@ y or y <@ x then true
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

revoke all on function public.guest_ai_normalize_phone(text) from public, anon, authenticated;
revoke all on function public.guest_ai_guest_name_compatible(text, text) from public, anon, authenticated;
revoke all on function public.guest_ai_link_guest_identity(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.guest_ai_resolve_guest_profile(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.guest_ai_normalize_phone(text) to service_role;
grant execute on function public.guest_ai_guest_name_compatible(text, text) to service_role;
grant execute on function public.guest_ai_link_guest_identity(uuid, uuid, text, text, text) to service_role;
grant execute on function public.guest_ai_resolve_guest_profile(uuid, text, text[]) to service_role;
