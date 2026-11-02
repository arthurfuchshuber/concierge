-- =====================================================================
-- PROPOSTA (NÃO APLICADA) — RLS: avaliar a permissão UMA vez por consulta
-- ConciergeIA · auditoria de lentidão de 02/11/2026
--
-- NÃO ESTÁ EM supabase/migrations DE PROPÓSITO: só roda com autorização,
-- à mão, numa única sessão. Tudo numa transação; se algo falhar, nada fica.
--
-- PROBLEMA MEDIDO (pg_stat_statements, 30/10–02/11):
--   · 226 das 249 políticas chamam auth.uid() e funções de permissão LINHA A
--     LINHA (o Postgres não "guarda" o resultado entre linhas);
--   · `properties` (44 linhas) teve 154 milhões de buscas por índice — vindas
--     de `user_can_access_property` sendo chamada para cada linha lida;
--   · leituras em tabelas pequenas levam 20–55 ms em média (até 8 s).
--
-- O QUE MUDA (mesma regra de acesso, só a forma de calcular):
--   1. Nova função `my_accessible_property_ids()`: os imóveis que a pessoa
--      logada pode ver, calculados UMA vez por consulta. É exatamente a
--      condição de `user_can_access_property(auth.uid(), id)` (dono OU
--      `member_can_see_property`).
--   2. Nas 6 tabelas mais lidas, cada política troca:
--        user_can_access_property(auth.uid(), X)  →  X IN (SELECT my_accessible_property_ids())
--        has_role(auth.uid(), 'admin')            →  (SELECT has_role((SELECT auth.uid()), 'admin'))
--        auth.uid()                               →  (SELECT auth.uid())
--      Nenhuma política é criada, removida, ou muda de comando/papel.
--   3. As expressões originais ficam guardadas em `_rls_backup_20261102`
--      para reverter (bloco no fim do arquivo).
--
-- Tabelas desta fase: guest_arrival_status, guide_section_events,
-- guide_access_logs, property_reservations, property_chat_conversations,
-- property_chat_messages. As outras 120 tabelas ficam para uma 2ª fase,
-- depois de medir o ganho desta.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.my_accessible_property_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id
  FROM public.properties p
  WHERE p.owner_id = auth.uid()
     OR public.member_can_see_property(auth.uid(), p.owner_id, p.id);
$$;
REVOKE ALL ON FUNCTION public.my_accessible_property_ids() FROM public;
GRANT EXECUTE ON FUNCTION public.my_accessible_property_ids() TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public._rls_backup_20261102 (
  tablename text NOT NULL,
  policyname text NOT NULL,
  cmd text NOT NULL,
  qual text,
  with_check text,
  PRIMARY KEY (tablename, policyname)
);
ALTER TABLE public._rls_backup_20261102 ENABLE ROW LEVEL SECURITY; -- sem políticas: só service_role lê

DO $$
DECLARE
  r record;
  q text;
  w text;
  alvo text[] := ARRAY['guest_arrival_status','guide_section_events','guide_access_logs',
                       'property_reservations','property_chat_conversations','property_chat_messages'];
  fn_q text := $f$
    SELECT replace(replace(
      regexp_replace(
        replace($1, 'has_role(auth.uid(), ''admin''::app_role)', '(SELECT has_role(§UID§, ''admin''::app_role))'),
        'user_can_access_property\(auth\.uid\(\), ([a-z_]+\.)?([a-z_]+)\)',
        '(\1\2 IN ( SELECT my_accessible_property_ids() ))', 'g'),
      'auth.uid()', '(SELECT auth.uid())'), '§UID§', '(SELECT auth.uid())')
  $f$;
BEGIN
  FOR r IN SELECT * FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY (alvo) LOOP
    INSERT INTO public._rls_backup_20261102 VALUES (r.tablename, r.policyname, r.cmd, r.qual, r.with_check)
      ON CONFLICT DO NOTHING;
    q := NULL; w := NULL;
    IF r.qual IS NOT NULL THEN EXECUTE fn_q INTO q USING r.qual; END IF;
    IF r.with_check IS NOT NULL THEN EXECUTE fn_q INTO w USING r.with_check; END IF;
    IF q IS NOT DISTINCT FROM r.qual AND w IS NOT DISTINCT FROM r.with_check THEN CONTINUE; END IF;
    IF q IS NOT NULL AND w IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)', r.policyname, r.tablename, q, w);
    ELSIF q IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', r.policyname, r.tablename, q);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', r.policyname, r.tablename, w);
    END IF;
    RAISE NOTICE 'política ajustada: %.%', r.tablename, r.policyname;
  END LOOP;

  -- conferência: nenhuma política das 6 tabelas chama mais a função por linha
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename = ANY (alvo)
             AND coalesce(qual,'') || coalesce(with_check,'') ~ 'user_can_access_property\(auth\.uid') THEN
    RAISE EXCEPTION 'sobrou user_can_access_property por linha — revertendo';
  END IF;
END $$;

COMMIT;

-- =====================================================================
-- REVERSÃO (rodar só se necessário): devolve cada política à expressão original
-- =====================================================================
-- BEGIN;
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN SELECT * FROM public._rls_backup_20261102 LOOP
--     IF r.qual IS NOT NULL AND r.with_check IS NOT NULL THEN
--       EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)', r.policyname, r.tablename, r.qual, r.with_check);
--     ELSIF r.qual IS NOT NULL THEN
--       EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', r.policyname, r.tablename, r.qual);
--     ELSIF r.with_check IS NOT NULL THEN
--       EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', r.policyname, r.tablename, r.with_check);
--     END IF;
--   END LOOP;
-- END $$;
-- COMMIT;
