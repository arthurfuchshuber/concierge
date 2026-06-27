-- Sigma city packs/recs/marketplace/faqs: grants ausentes faziam a leitura via PostgREST falhar,
-- escondendo o botão "Importar do SigmaGuide" mesmo com pack publicado para a cidade.
GRANT SELECT ON public.sigma_city_packs TO anon, authenticated;
GRANT ALL ON public.sigma_city_packs TO service_role;

GRANT SELECT ON public.sigma_city_recommendations TO anon, authenticated;
GRANT ALL ON public.sigma_city_recommendations TO service_role;

GRANT SELECT ON public.sigma_city_marketplace TO anon, authenticated;
GRANT ALL ON public.sigma_city_marketplace TO service_role;

GRANT SELECT ON public.sigma_city_faqs TO anon, authenticated;
GRANT ALL ON public.sigma_city_faqs TO service_role;

-- Garantir que admins continuam podendo escrever em packs/recs/mkt/faqs (já coberto por policies existentes),
-- mas faltava o GRANT base para o role authenticated.
GRANT INSERT, UPDATE, DELETE ON public.sigma_city_packs TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.sigma_city_recommendations TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.sigma_city_marketplace TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.sigma_city_faqs TO authenticated;