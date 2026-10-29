
-- Conexões bancárias (Items) do Malvo por conta (empresa).
CREATE TABLE public.malvo_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL,
  malvo_item_id text NOT NULL UNIQUE,
  connector_id text,
  connector_name text,
  institution_type text,
  status text,
  execution_status text,
  status_detail jsonb,
  consent_expires_at timestamptz,
  last_updated_at timestamptz,
  next_auto_sync_at timestamptz,
  environment text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  identity jsonb,
  deleted_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX malvo_items_owner_idx ON public.malvo_items(account_owner_id);
GRANT SELECT ON public.malvo_items TO authenticated;
GRANT ALL ON public.malvo_items TO service_role;
ALTER TABLE public.malvo_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dono da conta lê suas conexões bancárias" ON public.malvo_items
  FOR SELECT TO authenticated USING (account_owner_id = auth.uid());

-- Contas (corrente, poupança, cartão, etc.).
CREATE TABLE public.malvo_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL,
  malvo_account_id text NOT NULL UNIQUE,
  malvo_item_id text NOT NULL,
  type text,
  subtype text,
  name text,
  marketing_name text,
  number text,
  owner_name text,
  tax_number text,
  currency_code text,
  balance numeric,
  balance_updated_at timestamptz,
  balance_payload jsonb,
  credit_data jsonb,
  bank_data jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_tx_sync_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX malvo_accounts_owner_idx ON public.malvo_accounts(account_owner_id);
CREATE INDEX malvo_accounts_item_idx ON public.malvo_accounts(malvo_item_id);
GRANT SELECT ON public.malvo_accounts TO authenticated;
GRANT ALL ON public.malvo_accounts TO service_role;
ALTER TABLE public.malvo_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dono da conta lê suas contas bancárias" ON public.malvo_accounts
  FOR SELECT TO authenticated USING (account_owner_id = auth.uid());

-- Transações normalizadas (upsert por id do Malvo; nada é descartado: payload completo).
CREATE TABLE public.malvo_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL,
  malvo_transaction_id text NOT NULL UNIQUE,
  malvo_account_id text NOT NULL,
  malvo_item_id text,
  date timestamptz,
  amount numeric,
  type text,
  status text,
  description text,
  description_raw text,
  currency_code text,
  balance_after numeric,
  category text,
  category_id text,
  provider_code text,
  provider_id text,
  payment_data jsonb,
  credit_card_metadata jsonb,
  merchant jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  malvo_created_at timestamptz,
  malvo_updated_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX malvo_tx_owner_date_idx ON public.malvo_transactions(account_owner_id, date DESC);
CREATE INDEX malvo_tx_account_idx ON public.malvo_transactions(malvo_account_id, date DESC);
GRANT SELECT ON public.malvo_transactions TO authenticated;
GRANT ALL ON public.malvo_transactions TO service_role;
ALTER TABLE public.malvo_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dono da conta lê suas transações" ON public.malvo_transactions
  FOR SELECT TO authenticated USING (account_owner_id = auth.uid());

-- Tudo que o Malvo devolve, sem filtro (faturas, investimentos, empréstimos, identidade, consentimentos...).
CREATE TABLE public.malvo_raw_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid,
  entity_type text NOT NULL,
  malvo_id text NOT NULL,
  parent_id text,
  malvo_item_id text,
  payload jsonb NOT NULL,
  source text NOT NULL DEFAULT 'sync',
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, malvo_id)
);
CREATE INDEX malvo_raw_owner_type_idx ON public.malvo_raw_records(account_owner_id, entity_type);
GRANT SELECT ON public.malvo_raw_records TO authenticated;
GRANT ALL ON public.malvo_raw_records TO service_role;
ALTER TABLE public.malvo_raw_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dono da conta lê seus dados brutos do Malvo" ON public.malvo_raw_records
  FOR SELECT TO authenticated USING (account_owner_id = auth.uid());

-- Avisos recebidos do Malvo (idempotência por eventId + fila de processamento).
CREATE TABLE public.malvo_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event text NOT NULL,
  malvo_item_id text,
  client_user_id text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX malvo_webhook_pending_idx ON public.malvo_webhook_events(status, next_attempt_at);
GRANT ALL ON public.malvo_webhook_events TO service_role;
ALTER TABLE public.malvo_webhook_events ENABLE ROW LEVEL SECURITY;
