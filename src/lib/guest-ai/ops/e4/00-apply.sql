-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · CAMINHO 1 (psql) — NÃO É O CAMINHO RATIFICADO.
-- O Anfitrião Sigma ratificou o CAMINHO 2: `gateA-bundle.sql` (bundle único gerado por gen-gateA-bundle.mjs),
-- executado pela interface SQL do Lovable Cloud. Este arquivo fica só como referência do ensaio com psql
-- (mesmas três migrations, mesma ordem, mesma transação única). NÃO EXECUTAR em produção.
-- Proibido em qualquer caminho: `supabase db push` e aplicação arquivo por arquivo.
--   (referência) psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/lib/guest-ai/ops/e4/00-apply.sql
\set ON_ERROR_STOP on
begin;
-- não entra em fila de locks: se outra transação segura as tabelas referenciadas, desiste em 3 s
set local lock_timeout = '3s';
set local statement_timeout = '120s';
\i supabase/migrations/20261104000000_guest_ai_conversation_leases.sql
\i supabase/migrations/20261104120000_guest_ai_shadow.sql
\i supabase/migrations/20261105120000_guest_ai_shadow_global.sql
commit;
