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
-- Conversas: só o necessário para a FK (a tabela real tem mais colunas, nenhuma usada aqui).
create table if not exists public.property_chat_conversations (id uuid primary key);
