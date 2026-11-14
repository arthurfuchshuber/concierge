-- Auditoria 14/11/2026 (P2): checagem de duplicidade + insert não são atômicos; dois reenvios simultâneos do
-- webhook da Channex podiam gerar dois turnos da IA. Índice ÚNICO parcial só sobre mensagens de HÓSPEDE do Airbnb.
-- Aditivo e idempotente. NÃO apaga nem altera dados: se já existirem duplicatas (ou o tipo da coluna impedir o
-- índice), não cria e apenas avisa — resolva e rode de novo. O código trata 23505 como "já processada".
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.property_chat_messages
    WHERE channel = 'airbnb' AND sender_type = 'guest' AND external_id IS NOT NULL
    GROUP BY external_id HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'Índice uq_chat_msg_airbnb_guest_external_id NÃO criado: há external_id duplicado. Revise antes.';
  ELSE
    BEGIN
      CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_msg_airbnb_guest_external_id
        ON public.property_chat_messages (external_id)
        WHERE channel = 'airbnb' AND sender_type = 'guest' AND external_id IS NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Índice não criado (%): %', SQLSTATE, SQLERRM;
    END;
  END IF;
END $$;
