-- CÉREBRO CONTÍNUO (17/10/2026)
-- 1) ai_property_playbooks: roteiros APRENDIDOS por imóvel com as respostas e
--    correções da equipe, refinados a cada novo aprendizado (versionados).
-- 2) ai_host_corrections: quando o anfitrião APAGA ou EDITA uma mensagem da IA,
--    o evento é guardado para a IA aprender (ou perguntar o que errou).
-- Escrita só pelo servidor (service role); leitura pela RLS de acesso ao imóvel.

CREATE TABLE IF NOT EXISTS public.ai_property_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  property_id uuid NOT NULL,
  topic text NOT NULL,
  title text NOT NULL,
  triggers text[] NOT NULL DEFAULT '{}',
  situation text,
  steps text[] NOT NULL DEFAULT '{}',
  avoid text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'retired')),
  version integer NOT NULL DEFAULT 1,
  confidence numeric NOT NULL DEFAULT 0.7,
  uses integer NOT NULL DEFAULT 0,
  corrections integer NOT NULL DEFAULT 0,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, topic)
);
CREATE INDEX IF NOT EXISTS ai_property_playbooks_property_idx
  ON public.ai_property_playbooks (property_id, status);
ALTER TABLE public.ai_property_playbooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_property_playbooks_select ON public.ai_property_playbooks;
CREATE POLICY ai_property_playbooks_select ON public.ai_property_playbooks
  FOR SELECT USING (public.user_can_access_property(auth.uid(), property_id));

CREATE TABLE IF NOT EXISTS public.ai_host_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  property_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('deleted', 'edited')),
  ai_content text NOT NULL,
  guest_context text,
  replacement_content text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'learned', 'asked', 'skipped')),
  lesson text,
  escalation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_host_corrections_pending_idx
  ON public.ai_host_corrections (created_at) WHERE status = 'pending';
ALTER TABLE public.ai_host_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_host_corrections_select ON public.ai_host_corrections;
CREATE POLICY ai_host_corrections_select ON public.ai_host_corrections
  FOR SELECT USING (public.user_can_access_property(auth.uid(), property_id));
