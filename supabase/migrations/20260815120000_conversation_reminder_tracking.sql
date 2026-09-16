-- Sem isto, o cron de lembrete horário ("conversa ainda em aberto") não
-- teria como saber quando foi o ÚLTIMO push enviado pra cada conversa — só
-- sabendo handoff_at, ele mandaria um push a cada execução do cron (ex.: a
-- cada 15 minutos) pra qualquer conversa aberta há mais de 1h, em vez de
-- realmente esperar 1h entre um lembrete e o próximo.
ALTER TABLE public.property_chat_conversations
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;
