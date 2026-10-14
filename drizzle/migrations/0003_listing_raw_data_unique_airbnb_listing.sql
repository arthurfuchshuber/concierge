-- Um anúncio do Airbnb só pode estar ligado a UM imóvel. Fecha a corrida de dois operadores
-- vinculando o mesmo anúncio ao mesmo tempo (a checagem no código reduz a janela; o banco garante).
-- Conferido em produção: nenhum airbnb_listing_id duplicado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plrd_airbnb_listing_id
  ON public.property_listing_raw_data (airbnb_listing_id);
