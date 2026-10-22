-- PLAYBOOK DO IMÓVEL (21/10/2026)
-- Guarda o que o Playbook precisa e não tinha onde morar no cadastro do imóvel:
--   · a "Nota do anfitrião" de cada linha (contexto só deste imóvel, lido pela IA
--     junto da observação padrão do sistema);
--   · o valor dos campos manuais sem coluna própria (voltagem, lixo, disjuntores,
--     registro de água, gás, energia, bateria, chuveiros, manuais);
--   · as linhas criadas à mão ("Adicionar linha / campo"), com rótulo e audiência.
-- field_key: f:<campo> · faq:<id> · prov:<id> · custom:<uuid>.
CREATE TABLE IF NOT EXISTS public.property_playbook_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  value text,
  note text,
  custom_label text,
  custom_audience text CHECK (custom_audience IS NULL OR custom_audience IN ('G', 'P', 'I')),
  section_num smallint CHECK (section_num IS NULL OR section_num BETWEEN 1 AND 5),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, field_key)
);
CREATE INDEX IF NOT EXISTS property_playbook_entries_property_idx
  ON public.property_playbook_entries (property_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_playbook_entries TO authenticated;
GRANT ALL ON public.property_playbook_entries TO service_role;

ALTER TABLE public.property_playbook_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_playbook_entries_access ON public.property_playbook_entries;
CREATE POLICY property_playbook_entries_access ON public.property_playbook_entries
  FOR ALL
  USING (public.user_can_access_property(auth.uid(), property_id))
  WITH CHECK (public.user_can_access_property(auth.uid(), property_id));

CREATE OR REPLACE FUNCTION public.property_playbook_entries_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS property_playbook_entries_touch ON public.property_playbook_entries;
CREATE TRIGGER property_playbook_entries_touch
  BEFORE UPDATE ON public.property_playbook_entries
  FOR EACH ROW EXECUTE FUNCTION public.property_playbook_entries_touch();
