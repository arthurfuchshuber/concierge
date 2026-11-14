-- Vigia de encaminhamentos sem resposta (14/11/2026, autorizado pelo titular). Só ADD COLUMN, aditivo e idempotente.
-- Sem cron, sem DML, sem DROP: o agendamento (a cada 5 min) chama /api/public/cron/handoff-watchdog.
ALTER TABLE public.property_chat_conversations
  ADD COLUMN IF NOT EXISTS handoff_reminded_at timestamptz,
  ADD COLUMN IF NOT EXISTS handoff_escalated_at timestamptz;
COMMENT ON COLUMN public.property_chat_conversations.handoff_reminded_at IS 'Vigia: 1º lembrete enviado à equipe (encaminhamento sem resposta).';
COMMENT ON COLUMN public.property_chat_conversations.handoff_escalated_at IS 'Vigia: 2º aviso (escalonamento) enviado à equipe.';
