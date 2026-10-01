-- Local dentro do prédio (01/10/2026): condomínio com chave + apartamento, andar,
-- vagas de garagem (lista) e elevador. Já aplicada no banco do Lovable.
alter table public.properties
  add column if not exists in_condominium boolean not null default false,
  add column if not exists apartment_number text,
  add column if not exists apartment_floor text,
  add column if not exists parking_spots text[] not null default '{}',
  add column if not exists has_elevator boolean;
