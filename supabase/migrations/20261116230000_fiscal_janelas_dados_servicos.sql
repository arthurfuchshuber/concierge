-- MÓDULO FISCAL — janelas "Notas Fiscais (NFS-e)" (mockups A–R aprovados 16/11/2026).
-- Aditiva, idempotente e transacional. Sem DROP. Sem coluna para certificado/senha/token (A1 é write-only).
-- "Ativando"/"Erro" são estados da própria chamada de ativação (nada é registrado antes de a Focus aceitar).
begin;

-- 1. Dados da empresa (vindos da Receita Federal; a inscrição municipal é digitada) e opções avançadas.
alter table public.fiscal_companies
  add column if not exists municipal_registration text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists simples_option text check (simples_option in ('nao_optante', 'mei', 'me_epp')),
  add column if not exists cnae_code text,
  add column if not exists cnae_description text,
  add column if not exists ibge_city_code text,
  add column if not exists special_regime smallint not null default 0 check (special_regime between 0 and 6),
  add column if not exists dps_series text not null default '1' check (dps_series ~ '^[0-9]{1,5}$'),
  add column if not exists dps_next_number integer not null default 1 check (dps_next_number >= 1),
  add column if not exists approximate_taxes text not null default 'none' check (approximate_taxes in ('none', 'included')),
  add column if not exists invoice_note text check (char_length(invoice_note) <= 2000),
  add column if not exists withholding_text_ir text check (char_length(withholding_text_ir) <= 500),
  add column if not exists withholding_text_csrf text check (char_length(withholding_text_csrf) <= 500),
  add column if not exists withholding_text_inss text check (char_length(withholding_text_inss) <= 500);

-- 2. Serviços da empresa (aba "Serviços"): um único padrão por empresa.
create table if not exists public.fiscal_services (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  company_id uuid not null references public.fiscal_companies (id),
  national_code text not null check (national_code ~ '^[0-9]{6}$'),
  service_code text check (char_length(service_code) <= 20),
  nbs_code text check (nbs_code is null or nbs_code ~ '^[0-9.]{1,13}$'),
  description text not null check (char_length(description) between 3 and 2000),
  is_default boolean not null default false,
  inss_pct numeric(5,2) check (inss_pct is null or (inss_pct >= 0 and inss_pct <= 100)),
  ir_pct numeric(5,2) check (ir_pct is null or (ir_pct >= 0 and ir_pct <= 100)),
  cst text check (char_length(cst) <= 10),
  cclass_trib text check (char_length(cclass_trib) <= 10),
  operation_indicator text check (char_length(operation_indicator) <= 10),
  soft_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_fiscal_service_default on public.fiscal_services (company_id) where is_default and soft_deleted_at is null;
create index if not exists ix_fiscal_service_company on public.fiscal_services (company_id, created_at) where soft_deleted_at is null;
create index if not exists ix_fiscal_service_owner on public.fiscal_services (owner_id);

alter table public.fiscal_services enable row level security;
revoke all on public.fiscal_services from public, anon, authenticated;

commit;
