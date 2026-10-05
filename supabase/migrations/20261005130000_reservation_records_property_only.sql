-- "+ Registro" na página Registros (05/10/2026): um registro pode nascer
-- ligado SÓ ao imóvel, sem reserva, sem hóspede e sem pendência (ex.: uma
-- observação de categoria que não abre tarefa). `property_id` continua
-- obrigatório, e o RLS (user_can_access_property) continua decidindo quem
-- pode gravar — a regra antiga só impedia o caso "só imóvel".
ALTER TABLE public.reservation_records DROP CONSTRAINT IF EXISTS reservation_records_target_chk;
