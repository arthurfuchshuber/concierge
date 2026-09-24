-- DESLIGA a rotina semanal "refresh-city-references-weekly" (pedido explícito,
-- 24/09/2026 — já aplicado direto no banco).
--
-- Ela regenerava, toda semana, recomendações "da cidade" SEM DONO (sem imóvel
-- e sem grupo), a partir do centro da cidade. Desde que o guia passou a
-- mostrar só as recomendações do próprio imóvel/grupo, essas linhas não
-- aparecem em nenhum guia — a rotina só gastava consultas pagas ao Google.
-- A geração que vale é a de cada imóvel (botão "Gerar" / link do Maps), com
-- o raio de 30 km da residência.
--
-- Só DESATIVA (reversível); o job continua cadastrado. Para religar:
--   select cron.alter_job(jobid, active := true) from cron.job
--   where jobname = 'refresh-city-references-weekly';

select cron.alter_job(jobid, active := false)
from cron.job
where jobname = 'refresh-city-references-weekly';
