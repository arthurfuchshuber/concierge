-- Ambiente de TESTE para a migration do Copiloto: reproduz o MODELO DE ACESSO REAL do SaaS (nada de stub).
--  * `auth.uid()` lê a claim `sub` da sessão (igual ao Supabase/PostgREST);
--  * `account_members` e `property_assignments` com as colunas que a autorização lê (migrations
--    20260715201756, 20260804195811 e 20260905145215; enums simplificados para text com os mesmos valores);
--  * `is_account_member`, `member_can_see_property` e `user_can_access_property` copiadas LITERALMENTE das
--    migrations 20260715201756 e 20260830213102 (corpo, SECURITY DEFINER, search_path e grants);
--  * colunas de `property_chat_messages` que a reconciliação do envio lê.
-- Nada aqui vai para produção.
create schema if not exists auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists public.account_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  member_user_id uuid not null,
  role text not null default 'agent',
  status text not null default 'active',
  all_properties boolean not null default true,
  unique (owner_id, member_user_id)
);
create table if not exists public.property_assignments (
  id uuid not null default gen_random_uuid() primary key,
  tenant_id uuid not null,
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'active',
  unique (tenant_id, property_id, user_id)
);

-- ── literal: 20260715201756 ──
CREATE OR REPLACE FUNCTION public.is_account_member(_user_id uuid, _owner_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE member_user_id = _user_id
      AND owner_id = _owner_id
      AND status = 'active'
  );
$$;

-- ── literal: última definição nas migrations ──
CREATE OR REPLACE FUNCTION public.member_can_see_property(_user_id uuid, _owner_id uuid, _property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_account_member(_user_id, _owner_id)
    AND (
      EXISTS (
        SELECT 1 FROM public.account_members am
        WHERE am.member_user_id = _user_id
          AND am.owner_id = _owner_id
          AND am.status = 'active'
          AND am.all_properties IS TRUE
      )
      OR EXISTS (
        SELECT 1 FROM public.property_assignments pa
        WHERE pa.user_id = _user_id
          AND pa.property_id = _property_id
          AND COALESCE(pa.status, 'active') = 'active'
      )
    );
$$;

-- ── literal: 20260830213102 ──
CREATE OR REPLACE FUNCTION public.user_can_access_property(_user_id uuid, _property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = _property_id
      AND (
        p.owner_id = _user_id
        OR public.member_can_see_property(_user_id, p.owner_id, p.id)
      )
  );
$function$;
REVOKE EXECUTE ON FUNCTION public.user_can_access_property(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_property(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, uuid) TO authenticated, service_role;

alter table public.property_chat_messages add column if not exists content text not null default '';
alter table public.property_chat_messages add column if not exists sender_user_id uuid;
alter table public.property_chat_messages add column if not exists delivery_status text;
alter table public.property_chat_messages add column if not exists is_internal_note boolean not null default false;
alter table public.property_chat_messages add column if not exists channel text not null default 'web';
alter table public.property_chat_messages add column if not exists external_id text;
