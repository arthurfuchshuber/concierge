-- Ambiente de TESTE local que reproduz o que importa da produção (inspecionado em 03/11/2026):
-- papéis anon/authenticated/service_role (service_role com BYPASSRLS) e os DEFAULT PRIVILEGES do
-- schema public, que concedem tudo a anon/authenticated/service_role em tabelas e funções novas.
-- Só para provar que a migration revoga esses privilégios. Nada aqui vai para produção.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'sandbox_exec') then create role sandbox_exec nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role, sandbox_exec;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert on tables to sandbox_exec;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
-- E4 (auditoria de produção, 04/11/2026): a produção também concede SEQUÊNCIAS novas a clientes
-- (`anon=rwU, authenticated=rwU, service_role=rwU, sandbox_exec=rU`). Reproduzido para provar a revogação.
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant select, usage on sequences to sandbox_exec;
-- Conversas: só o necessário para a FK (a tabela real tem mais colunas, nenhuma usada aqui).
create table if not exists public.property_chat_conversations (id uuid primary key);
-- B3.3: imóveis (id, dono e arquivamento — iguais à produção).
create table if not exists public.properties (id uuid primary key, owner_id uuid, archived_at timestamptz);
-- E4 GLOBAL: o que a elegibilidade e a escolha de candidatas leem (colunas e constraints auditadas na
-- produção em 04/11/2026; nenhuma outra coluna é usada). Padrões = imóvel com canal e dados mínimos.
alter table public.properties add column if not exists published boolean not null default true;
alter table public.properties add column if not exists guide_created boolean not null default true;
alter table public.properties add column if not exists checkin_time text default '15:00';
alter table public.properties add column if not exists checkout_time text default '11:00';
alter table public.property_chat_conversations add column if not exists property_id uuid;
alter table public.property_chat_conversations add column if not exists guest_session_id text;
alter table public.property_chat_conversations add column if not exists last_message_at timestamptz;
create table if not exists public.property_chat_messages (
  id uuid primary key, conversation_id uuid not null, sender_type text not null, role text not null, created_at timestamptz not null default now());
create table if not exists public.profiles (id uuid primary key);
create table if not exists public.property_listing_raw_data (
  id uuid primary key default gen_random_uuid(), property_id uuid not null unique, owner_id uuid not null, airbnb_listing_id text not null,
  channex_property_id text, not_found_at timestamptz, sync_paused_at timestamptz, paused_reason text);
create table if not exists public.channex_twin_links (id uuid primary key default gen_random_uuid(), owner_id uuid, property_id uuid, status text not null default 'active');
create table if not exists public.host_whatsapp_config (owner_id uuid primary key, status text not null);
