-- Cada hóspede vinculado a uma reserva decide, por conta própria, se quer
-- que a IA trate assuntos (como o roteiro) em conjunto com quem mais estiver
-- na mesma reserva, ou separadamente. Uma linha por (reserva, pessoa) — o
-- modo "grupo" só entra em vigor quando TODAS as pessoas que já apareceram
-- nessa reserva votaram "grupo"; enquanto não há consenso, ou alguém votou
-- "individual", cada um continua isolado (padrão mais seguro/privado).
CREATE TABLE IF NOT EXISTS public.reservation_group_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  checkin_date date NOT NULL,
  checkout_date date NOT NULL,
  guest_name text NOT NULL,
  normalized_name text NOT NULL,
  vote text NOT NULL CHECK (vote IN ('individual', 'group')),
  voted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, checkin_date, checkout_date, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_reservation_votes_lookup
  ON public.reservation_group_votes(property_id, checkin_date, checkout_date);

GRANT SELECT ON public.reservation_group_votes TO authenticated;
GRANT ALL ON public.reservation_group_votes TO service_role;
ALTER TABLE public.reservation_group_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view votes of their properties"
ON public.reservation_group_votes FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.properties p
  WHERE p.id = reservation_group_votes.property_id
    AND p.owner_id = auth.uid()
));
