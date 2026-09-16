-- Conclusão de pendência com prestação de contas (pedido explícito,
-- 07/09/2026): ao concluir, o sistema passa a perguntar QUEM resolveu
-- (prestador cadastrado), QUANTO custou e permite anexar a comprovação
-- (foto/vídeo/arquivo/áudio). Tudo opcional — concluir sem preencher nada
-- continua funcionando como antes.
--
-- O valor já existia (`tasks.amount_spent_cents`, do antigo "teve gasto
-- nessa tarefa?"), então aqui só entram o prestador e a descrição da
-- resolução.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS resolved_by_provider_id uuid NULL REFERENCES public.service_providers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_note text NULL;

CREATE INDEX IF NOT EXISTS tasks_resolved_by_provider_idx ON public.tasks (resolved_by_provider_id) WHERE resolved_by_provider_id IS NOT NULL;

-- A comprovação da resolução reaproveita `reservation_records` — mesmo
-- bucket, mesmas permissões, mesma tela de upload já em uso. `is_resolution`
-- separa "o problema" (o registro que abriu a pendência) de "o conserto".
ALTER TABLE public.reservation_records
  ADD COLUMN IF NOT EXISTS is_resolution boolean NOT NULL DEFAULT false;

-- Até aqui um registro EXIGIA uma reserva (log_id ou reservation_id). Mas
-- pendência pode ser só do imóvel, sem reserva nenhuma (ex.: manutenção
-- recorrente) — e a comprovação dela também precisa de anexo. A regra passa
-- a aceitar registro preso apenas à pendência.
ALTER TABLE public.reservation_records DROP CONSTRAINT IF EXISTS reservation_records_target_chk;
ALTER TABLE public.reservation_records
  ADD CONSTRAINT reservation_records_target_chk
  CHECK (log_id IS NOT NULL OR reservation_id IS NOT NULL OR task_id IS NOT NULL);

-- Pelo mesmo motivo, `card_mode` (a coluna do Kanban onde o registro
-- nasceu) passa a aceitar vazio: um anexo de pendência não nasce em coluna
-- nenhuma. Registros de reserva continuam preenchendo normalmente.
ALTER TABLE public.reservation_records ALTER COLUMN card_mode DROP NOT NULL;
