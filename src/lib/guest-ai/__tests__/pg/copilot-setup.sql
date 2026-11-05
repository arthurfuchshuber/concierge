-- Ambiente de TESTE para a migration do Copiloto (reproduz o que a migration exige da produção e que o
-- `supabase-like-setup.sql` não tem): `auth.uid()` lendo a claim `sub` da sessão (igual ao Supabase),
-- `public.user_can_access_property(uuid, uuid)` (dono do imóvel ou membro em `test_property_members`) e as
-- colunas de `property_chat_messages` que a reconciliação do envio lê. Nada aqui vai para produção.
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

create table if not exists public.test_property_members (user_id uuid not null, property_id uuid not null, primary key (user_id, property_id));

create or replace function public.user_can_access_property(_user_id uuid, _property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.properties p where p.id = _property_id and p.owner_id = _user_id)
      or exists (select 1 from public.test_property_members m where m.user_id = _user_id and m.property_id = _property_id);
$$;
revoke execute on function public.user_can_access_property(uuid, uuid) from public, anon;
grant execute on function public.user_can_access_property(uuid, uuid) to authenticated, service_role;

alter table public.property_chat_messages add column if not exists content text not null default '';
alter table public.property_chat_messages add column if not exists sender_user_id uuid;
alter table public.property_chat_messages add column if not exists delivery_status text;
alter table public.property_chat_messages add column if not exists is_internal_note boolean not null default false;
alter table public.property_chat_messages add column if not exists channel text not null default 'web';
alter table public.property_chat_messages add column if not exists external_id text;
