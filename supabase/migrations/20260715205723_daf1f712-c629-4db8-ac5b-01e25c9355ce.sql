ALTER TABLE public.property_chat_conversations
  ADD COLUMN IF NOT EXISTS claim_requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claim_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pcc_claim_requested_by
  ON public.property_chat_conversations(claim_requested_by)
  WHERE claim_requested_by IS NOT NULL;