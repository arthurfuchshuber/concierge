CREATE TABLE public.propriedades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  channex_listing_id text UNIQUE,
  channex_property_id uuid,
  channex_room_type_id uuid,
  channex_rate_plan_id uuid,
  status text NOT NULL DEFAULT 'pendente',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.propriedades TO authenticated;
GRANT ALL ON public.propriedades TO service_role;

ALTER TABLE public.propriedades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage propriedades"
ON public.propriedades FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_propriedades_updated_at
BEFORE UPDATE ON public.propriedades
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
