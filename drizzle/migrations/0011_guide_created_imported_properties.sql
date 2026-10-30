-- A tela intermediária "Criar guia" foi removida (29/10/2026): o imóvel importado
-- do Airbnb já nasce com guide_created = true. Corrige os importados antes disso.
UPDATE public.properties
SET guide_created = true
WHERE guide_created = false
  AND airbnb_listing_url IS NOT NULL;
