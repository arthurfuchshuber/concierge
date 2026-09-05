-- Novo status "no_show" (Não Compareceu) na esteira de check-in.
--
-- Pedido explícito, 05/09/2026: um hóspede que nunca chegou pode ser marcado
-- como "Não Compareceu" a partir do menu "⋮" do card de Check-ins. O card sai
-- da esteira normal (nunca mais aparece em Check-ins) e passa a viver numa
-- coluna/aba própria, depois de "Concluídos" — sem passar por
-- Estadia/Checkout/Limpeza. Nenhuma linha kind='checkout' chega a ser criada
-- para essa estadia, então a trava operacional de advanceArrival (que só
-- enxerga checkout em aberto do MESMO imóvel) nunca chega a bloquear o
-- próximo check-in — o imóvel fica liberado na hora, como pedido.
DO $$
BEGIN
  ALTER TABLE public.guest_arrival_status DROP CONSTRAINT IF EXISTS guest_arrival_status_status_check;
  ALTER TABLE public.guest_arrival_status
    ADD CONSTRAINT guest_arrival_status_status_check CHECK (status IN ('pending', 'done', 'no_show'));
END $$;
