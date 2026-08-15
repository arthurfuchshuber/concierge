-- Permite anexar imagens em cada item do Manual da casa (ex: foto do
-- controle do ar-condicionado, do disjuntor etc.) — mesmo padrão de
-- armazenamento (caminhos no bucket "property-images") já usado em
-- property_details.images.
ALTER TABLE public.property_manual_items
  ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}';
