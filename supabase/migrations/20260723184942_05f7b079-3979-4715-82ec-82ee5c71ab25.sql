DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_policy p ON p.polrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
    GROUP BY c.oid
    HAVING count(p.*) = 0
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon, authenticated', r.rel);
    EXECUTE format('GRANT ALL ON TABLE %s TO service_role', r.rel);
  END LOOP;
END $$;