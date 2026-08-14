-- O índice único existente (guest_arrival_status_reservation_kind_uidx) só
-- protege registros identificados por reservation_id. Hóspedes identificados
-- só por log_id (sem reserva formal casada no Airbnb) não tinham proteção
-- nenhuma contra duas linhas duplicadas quando dois cliques — ou dois
-- usuários diferentes — chegavam quase juntos.
CREATE UNIQUE INDEX IF NOT EXISTS guest_arrival_status_log_kind_uidx
  ON public.guest_arrival_status (log_id, kind)
  WHERE log_id IS NOT NULL;
