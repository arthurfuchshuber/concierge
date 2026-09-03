-- Amplia o que a sincronização diária do Airbnb (refreshStaleAirbnbListings)
-- consegue trazer do anúncio público, além dos campos básicos já existentes
-- (nome, descrição curta, cidade, país, checkin/checkout, fotos).
--
-- Todas as colunas novas usam o prefixo "airbnb_" e ficam separadas de
-- qualquer campo que o anfitrião edite manualmente no guia (ex.: não existe
-- overlap com nenhuma coluna de "amenities"/"descrição" usada pelo guia
-- hoje) — o import do Airbnb nunca sobrescreve conteúdo editado à mão fora
-- dos campos que ele sempre controlou (name, tagline, city, country,
-- checkin/checkout, gallery_images).
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS airbnb_rating NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS airbnb_guest_count SMALLINT,
  ADD COLUMN IF NOT EXISTS airbnb_bedroom_count SMALLINT,
  ADD COLUMN IF NOT EXISTS airbnb_bed_count SMALLINT,
  ADD COLUMN IF NOT EXISTS airbnb_bathroom_count NUMERIC(3, 1),
  ADD COLUMN IF NOT EXISTS airbnb_description_full TEXT,
  ADD COLUMN IF NOT EXISTS airbnb_rooms_beds JSONB,
  ADD COLUMN IF NOT EXISTS airbnb_amenities JSONB,
  ADD COLUMN IF NOT EXISTS airbnb_house_rules TEXT,
  ADD COLUMN IF NOT EXISTS airbnb_cancellation_policy TEXT,
  ADD COLUMN IF NOT EXISTS airbnb_safety_info TEXT;
