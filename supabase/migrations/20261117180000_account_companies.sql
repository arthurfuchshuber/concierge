-- PERFIL · quadrante Empresa (CNPJ). Uma linha por conta (titular). Aditivo e idempotente; sem DROP.
-- Os dados vêm da Receita Federal (consulta feita no servidor) e os campos que a Receita devolveu ficam travados
-- (`locked_fields`): só o suporte altera. Escrita apenas pelo servidor (service_role); sem policy para o cliente.
begin;

create table if not exists public.account_companies (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  -- null = ainda não respondeu "Somos uma Empresa (CNPJ)"; a resposta é obrigatória no cadastro.
  is_company boolean,
  answered_at timestamptz,
  cnpj text,
  situation text,
  legal_name text,
  trade_name text,
  email text,
  phone text,
  phone_country text default 'BR',
  cep text,
  street text,
  number text,
  neighborhood text,
  city text,
  state text,
  ibge_city_code text,
  cnae_code text,
  cnae_description text,
  simples text,
  tax_regime text,
  municipal_registration text,
  locked_fields text[] not null default '{}',
  receita_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_companies_cnpj_digits check (cnpj is null or cnpj ~ '^[0-9]{14}$')
);

-- Um CNPJ pertence a uma única conta.
create unique index if not exists account_companies_cnpj_uidx on public.account_companies (cnpj) where cnpj is not null;

alter table public.account_companies enable row level security;
revoke all on public.account_companies from anon, authenticated;
grant all on public.account_companies to service_role;

commit;
