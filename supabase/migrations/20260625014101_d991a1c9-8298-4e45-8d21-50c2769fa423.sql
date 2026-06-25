
CREATE TABLE public.poi_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  display_order int NOT NULL DEFAULT 100,
  is_protected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.poi_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  category_id uuid NOT NULL REFERENCES public.poi_categories(id) ON DELETE RESTRICT,
  accepted_primary_types text[] NOT NULL DEFAULT '{}',
  places_types text[] NOT NULL DEFAULT '{}',
  query_variants text[] NOT NULL DEFAULT '{}',
  min_reviews int NOT NULL DEFAULT 150,
  is_protected boolean NOT NULL DEFAULT false,
  display_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX poi_tags_category_idx ON public.poi_tags(category_id);

GRANT SELECT ON public.poi_categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.poi_categories TO authenticated;
GRANT ALL ON public.poi_categories TO service_role;

GRANT SELECT ON public.poi_tags TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.poi_tags TO authenticated;
GRANT ALL ON public.poi_tags TO service_role;

ALTER TABLE public.poi_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poi_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read categories" ON public.poi_categories FOR SELECT USING (true);
CREATE POLICY "Admins manage categories" ON public.poi_categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can read tags" ON public.poi_tags FOR SELECT USING (true);
CREATE POLICY "Admins manage tags" ON public.poi_tags FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER touch_poi_categories BEFORE UPDATE ON public.poi_categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_poi_tags BEFORE UPDATE ON public.poi_tags
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed categorias
INSERT INTO public.poi_categories (slug, label, display_order, is_protected) VALUES
  ('restaurantes', 'Restaurantes', 10, true),
  ('atracoes', 'Atrações', 20, true),
  ('vida-noturna', 'Vida noturna', 30, true),
  ('bares', 'Bares', 40, true),
  ('cafes', 'Cafés', 50, true),
  ('praias', 'Praias', 60, true),
  ('mercados', 'Mercados', 70, true),
  ('farmacias', 'Farmácias', 80, true),
  ('parques', 'Praças, Lagos e Parques', 90, true),
  ('compras', 'Compras', 100, true),
  ('outros', 'Outros', 999, true);

-- Seed tags
INSERT INTO public.poi_tags (slug, label, category_id, accepted_primary_types, places_types, query_variants, min_reviews, is_protected, display_order)
SELECT 'restaurant', 'Restaurante', id,
  ARRAY['restaurant','pizza_restaurant','italian_restaurant','brazilian_restaurant','steak_house','seafood_restaurant','japanese_restaurant','sushi_restaurant','mexican_restaurant','fast_food_restaurant','hamburger_restaurant','barbecue_restaurant','vegetarian_restaurant','vegan_restaurant','meal_takeaway','meal_delivery','fine_dining_restaurant','american_restaurant','chinese_restaurant','french_restaurant'],
  ARRAY['restaurant'],
  ARRAY['melhores restaurantes em','restaurantes famosos em','restaurantes tradicionais em','alta gastronomia em'],
  150, true, 10
FROM public.poi_categories WHERE slug='restaurantes';

INSERT INTO public.poi_tags (slug, label, category_id, accepted_primary_types, places_types, query_variants, min_reviews, is_protected, display_order)
SELECT 'attraction', 'Atração', id,
  ARRAY['tourist_attraction','museum','art_gallery','amusement_park','aquarium','zoo','historical_landmark','monument','cultural_center','national_park','observation_deck','performing_arts_theater','planetarium','amusement_center','water_park','wildlife_park','ecological_park','garden','botanical_garden','stadium','arena','skydiving_center','scenic_lookout'],
  ARRAY['tourist_attraction'],
  ARRAY['pontos turísticos em','atrações turísticas famosas em','o que fazer em','passeios imperdíveis em','marcos históricos em','museus famosos em','mirantes em','experiências turísticas em','tours em'],
  200, true, 20
FROM public.poi_categories WHERE slug='atracoes';

INSERT INTO public.poi_tags (slug, label, category_id, accepted_primary_types, places_types, query_variants, min_reviews, is_protected, display_order)
SELECT 'nightlife', 'Vida noturna', id,
  ARRAY['night_club','comedy_club','dance_club','karaoke'],
  ARRAY['night_club'],
  ARRAY['vida noturna em','baladas em','casas noturnas em','clubes noturnos em','danceterias em'],
  150, true, 30
FROM public.poi_categories WHERE slug='vida-noturna';

INSERT INTO public.poi_tags (slug, label, category_id, accepted_primary_types, places_types, query_variants, min_reviews, is_protected, display_order)
SELECT 'bar', 'Bar', id,
  ARRAY['bar','pub','wine_bar','sports_bar','bar_and_grill'],
  ARRAY['bar'],
  ARRAY['melhores bares em','bares famosos em','pubs em','wine bars em','happy hour em'],
  150, true, 40
FROM public.poi_categories WHERE slug='bares';

INSERT INTO public.poi_tags (slug, label, category_id, accepted_primary_types, places_types, query_variants, min_reviews, is_protected, display_order)
SELECT 'cafe', 'Café', id,
  ARRAY['cafe','coffee_shop','bakery','tea_house','dessert_shop','ice_cream_shop','donut_shop'],
  ARRAY['cafe','coffee_shop'],
  ARRAY['melhores cafés em','cafeterias famosas em','padarias artesanais em','doceria em'],
  150, true, 50
FROM public.poi_categories WHERE slug='cafes';

INSERT INTO public.poi_tags (slug, label, category_id, accepted_primary_types, places_types, query_variants, min_reviews, is_protected, display_order)
SELECT 'beach', 'Praia', id,
  ARRAY['beach'],
  ARRAY['beach'],
  ARRAY['melhores praias em','praias famosas em','praias para visitar em'],
  150, true, 60
FROM public.poi_categories WHERE slug='praias';

INSERT INTO public.poi_tags (slug, label, category_id, accepted_primary_types, places_types, query_variants, min_reviews, is_protected, display_order)
SELECT 'market', 'Mercado', id,
  ARRAY['supermarket','grocery_store','convenience_store','food_store','market'],
  ARRAY['supermarket','grocery_store'],
  ARRAY['supermercados em','mercados em','hipermercados em'],
  150, true, 70
FROM public.poi_categories WHERE slug='mercados';

INSERT INTO public.poi_tags (slug, label, category_id, accepted_primary_types, places_types, query_variants, min_reviews, is_protected, display_order)
SELECT 'pharmacy', 'Farmácia', id,
  ARRAY['pharmacy','drugstore'],
  ARRAY['pharmacy'],
  ARRAY['farmácias em','drogarias em','farmácia 24 horas em','drogaria 24h em','rede de farmácia em'],
  150, true, 80
FROM public.poi_categories WHERE slug='farmacias';

INSERT INTO public.poi_tags (slug, label, category_id, accepted_primary_types, places_types, query_variants, min_reviews, is_protected, display_order)
SELECT 'park', 'Parque', id,
  ARRAY['park','state_park','dog_park','city_park','plaza','town_square'],
  ARRAY['park'],
  ARRAY['praças famosas em','parques urbanos em','parques municipais em','lagos em','áreas verdes em','espaços públicos de lazer em','jardins públicos em'],
  150, true, 90
FROM public.poi_categories WHERE slug='parques';

INSERT INTO public.poi_tags (slug, label, category_id, accepted_primary_types, places_types, query_variants, min_reviews, is_protected, display_order)
SELECT 'shopping', 'Shopping', id,
  ARRAY['shopping_mall','department_store'],
  ARRAY['shopping_mall'],
  ARRAY['shoppings em','shopping centers em','centros de compras em'],
  150, true, 100
FROM public.poi_categories WHERE slug='compras';

INSERT INTO public.poi_tags (slug, label, category_id, accepted_primary_types, places_types, query_variants, min_reviews, is_protected, display_order)
SELECT 'other', 'Outro', id, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 0, true, 999
FROM public.poi_categories WHERE slug='outros';
