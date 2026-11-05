-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · APLICAÇÃO INERTE = GATE A (NÃO EXECUTAR sem a autorização do
-- GATE A). Ordem obrigatória e transação ÚNICA: ou entram as três, ou nenhuma. Nada é habilitado:
-- escopo `none`, estado `disabled`, nenhum interruptor, nenhum cron (conferido por 02-validate.sql).
-- Executar a partir da raiz do repositório com psql conectado como `postgres` (dono das funções):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/lib/guest-ai/ops/e4/00-apply.sql
-- Antes: 01-preflight.sql com todas as linhas ok. Depois: 02-validate.sql com todas as linhas ok.
-- Se a ferramenta de migrations do Lovable/Supabase aplicar arquivo por arquivo, cada um já é
-- transacional e tem guarda própria (reexecução aborta sem efeito); aplicar na MESMA ordem e validar no fim.
\set ON_ERROR_STOP on
begin;
-- não entra em fila de locks: se outra transação segura as tabelas referenciadas, desiste em 3 s
set local lock_timeout = '3s';
set local statement_timeout = '120s';
\i supabase/migrations/20261104000000_guest_ai_conversation_leases.sql
\i supabase/migrations/20261104120000_guest_ai_shadow.sql
\i supabase/migrations/20261105120000_guest_ai_shadow_global.sql
commit;
