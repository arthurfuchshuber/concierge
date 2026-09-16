-- Datas de início e fim do contrato do proprietário/prestador, exibidas no
-- card compacto logo abaixo da cidade/UF (fim só aparece quando preenchido).
ALTER TABLE public.property_owners ADD COLUMN IF NOT EXISTS contract_start date;
ALTER TABLE public.property_owners ADD COLUMN IF NOT EXISTS contract_end date;
ALTER TABLE public.service_providers ADD COLUMN IF NOT EXISTS contract_start date;
ALTER TABLE public.service_providers ADD COLUMN IF NOT EXISTS contract_end date;
