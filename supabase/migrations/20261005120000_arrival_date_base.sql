-- Previsão de data (arrival_date_override) passa a lembrar SOBRE QUAL data da
-- reserva ela foi dada. Se o calendário muda a data da reserva depois, a
-- previsão antiga deixa de valer (a reserva é a fonte da verdade) em vez de
-- manter o card no dia antigo / disparar a saída automática por engano.
ALTER TABLE public.guest_arrival_status
  ADD COLUMN IF NOT EXISTS arrival_date_base date;

-- Linhas existentes cuja previsão coincide com a data atual da reserva ganham
-- a base (assim, se a reserva mudar de data a partir de agora, a previsão é
-- reconhecida como velha). As demais ficam sem base (não dá para saber).
UPDATE public.guest_arrival_status s
SET arrival_date_base = CASE WHEN s.kind = 'checkout' THEN r.checkout_date ELSE r.checkin_date END
FROM public.property_reservations r
WHERE s.reservation_id = r.id
  AND s.arrival_date_override IS NOT NULL
  AND s.arrival_date_base IS NULL
  AND s.arrival_date_override = CASE WHEN s.kind = 'checkout' THEN r.checkout_date ELSE r.checkin_date END;
