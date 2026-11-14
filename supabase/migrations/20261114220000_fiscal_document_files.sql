-- Fiscal · arquivos dos documentos (XML autorizado e PDF) com guarda de 5 anos (60 meses).
-- Decisão do proprietário (14/11/2026, D-14). Apenas ADITIVA. Bucket PRIVADO, sem política de storage:
-- só o servidor (service_role) grava e assina links curtos, e só para o titular da conta.

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fiscal-documents', 'fiscal-documents', false, 10 * 1024 * 1024, array['application/xml', 'text/xml', 'application/pdf'])
    on conflict (id) do nothing;
  end if;
end $$;

create table public.fiscal_document_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  company_id uuid not null references public.fiscal_companies (id),
  document_id uuid not null references public.fiscal_documents (id),
  kind text not null check (kind in ('xml', 'pdf')),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10 * 1024 * 1024),
  created_at timestamptz not null default now(),
  retain_until timestamptz not null default (now() + interval '60 months'),
  -- a guarda mínima é de 60 meses; nenhum registro pode nascer com prazo menor
  constraint fiscal_file_min_retention check (retain_until >= created_at + interval '60 months'),
  constraint fiscal_file_path_owner check (storage_path like owner_id::text || '/%')
);
create unique index uq_fiscal_file_version on public.fiscal_document_files (document_id, kind, sha256);
create index ix_fiscal_file_doc on public.fiscal_document_files (document_id, kind, created_at desc);
create index ix_fiscal_file_owner on public.fiscal_document_files (owner_id, created_at desc);

-- Imutável: nunca se altera; só se apaga depois do prazo de guarda (e nunca por TRUNCATE).
create function public.fiscal_file_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'fiscal_file_immutable: arquivo fiscal não pode ser alterado' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' and old.retain_until > now() then
    raise exception 'fiscal_file_retention: guarda até %', old.retain_until using errcode = 'P0001';
  end if;
  if tg_op = 'TRUNCATE' then
    raise exception 'fiscal_file_retention: TRUNCATE proibido' using errcode = 'P0001';
  end if;
  return coalesce(old, new);
end $$;
create trigger trg_fiscal_file_row before update or delete on public.fiscal_document_files for each row execute function public.fiscal_file_guard();
create trigger trg_fiscal_file_truncate before truncate on public.fiscal_document_files for each statement execute function public.fiscal_file_guard();

alter table public.fiscal_document_files enable row level security;
revoke all on public.fiscal_document_files from public, anon, authenticated;
grant select, insert on public.fiscal_document_files to service_role;
revoke all on function public.fiscal_file_guard() from public, anon, authenticated;

-- Reverter (somente antes de haver arquivos): drop table public.fiscal_document_files; drop function public.fiscal_file_guard();
