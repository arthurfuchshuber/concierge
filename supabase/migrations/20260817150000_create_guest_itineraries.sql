-- Roteiro/itinerário vivo por hóspede: a IA vai lendo e ajustando ao longo
-- da conversa (em vez de cada resposta ser um bloco de texto novo e solto),
-- e o hóspede acompanha isso numa tela própria dentro do guia.
-- Uma linha por (imóvel, hóspede) — o conteúdo de verdade fica no JSONB
-- `days`, que a aplicação lê/escreve inteiro a cada mudança (volume baixo,
-- não justifica normalizar em tabelas separadas).
CREATE TABLE IF NOT EXISTS public.guest_itineraries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  guest_key text NOT NULL,
  guest_name text,
  -- [{ date: "2026-08-20", items: [{ id, time, title, note, source }] }]
  days jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, guest_key)
);

CREATE INDEX IF NOT EXISTS idx_guest_itineraries_property ON public.guest_itineraries(property_id, guest_key);

GRANT SELECT ON public.guest_itineraries TO authenticated;
GRANT ALL ON public.guest_itineraries TO service_role;
ALTER TABLE public.guest_itineraries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view itineraries of their properties"
ON public.guest_itineraries FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.properties p
  WHERE p.id = guest_itineraries.property_id
    AND p.owner_id = auth.uid()
));
