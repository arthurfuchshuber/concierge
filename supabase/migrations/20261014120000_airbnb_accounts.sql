-- Contas do Airbnb conectadas (uma conta do sistema pode ter várias; cada uma é um canal da Channex).
CREATE TABLE IF NOT EXISTS public.airbnb_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  channex_channel_id text NOT NULL,
  title text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected')),
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  UNIQUE (owner_id, channex_channel_id)
);
CREATE INDEX IF NOT EXISTS airbnb_accounts_channel_idx ON public.airbnb_accounts (channex_channel_id);
-- Só o servidor (service role) lê e grava; nenhuma policy = acesso negado ao cliente.
ALTER TABLE public.airbnb_accounts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.airbnb_accounts TO service_role;

-- Imóvel arquivado (conta do Airbnb desconectada): some das listas, os dados ficam guardados.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Anúncio importado: motivo da pausa (para a reconexão retomar só o que a desconexão pausou)
-- e pendência de ativação do chat (app Messages da Channex).
ALTER TABLE public.property_listing_raw_data
  ADD COLUMN IF NOT EXISTS paused_reason text CHECK (paused_reason IN ('manual', 'account_disconnected')),
  ADD COLUMN IF NOT EXISTS chat_pending_at timestamptz,
  ADD COLUMN IF NOT EXISTS chat_pending_error text,
  ADD COLUMN IF NOT EXISTS not_found_at timestamptz;
