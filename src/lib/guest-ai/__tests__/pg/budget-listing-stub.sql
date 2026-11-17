-- Esquema mínimo para aplicar `20261117200000_guest_ai_turns.sql` e exercitar `guest_ai_claim_turn` (teto por anúncio e
-- conta). Complementa o ambiente tipo Supabase (que já cria properties, conversas, mensagens e
-- property_listing_raw_data). Não substitui a suíte completa.
alter table public.property_listing_raw_data add column if not exists property_id uuid;
alter table public.property_listing_raw_data add column if not exists airbnb_ai_enabled boolean not null default true;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function public.user_can_access_property(_user uuid, _property uuid) returns boolean
  language sql stable as $$ select true $$;
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
create or replace function cron.schedule(n text, s text, c text) returns bigint
  language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
create or replace function cron.unschedule(n text) returns boolean
  language sql as $$ delete from cron.job where jobname = n returning true $$;
create table if not exists public.guest_ai_generation_traces (id bigint generated always as identity primary key);
