-- Anúncio conectado já nasce com a IA habilitada (decisão do titular, 06/11/2026): o default de
-- `property_listing_raw_data.airbnb_ai_enabled` passa a ser true. Só afeta linhas novas; as existentes não mudam.
alter table public.property_listing_raw_data alter column airbnb_ai_enabled set default true;
