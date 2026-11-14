-- Remove os 4 snapshots de reparo de 24/09/2026 (sem FK, view ou função dependente).
-- As migrations antigas que os criaram permanecem como histórico.
DROP TABLE IF EXISTS public.recs_category_repair_20260924 CASCADE;
DROP TABLE IF EXISTS public.recs_dedupe_backup_20260924 CASCADE;
DROP TABLE IF EXISTS public.recs_orphan_cleanup_20260924 CASCADE;
DROP TABLE IF EXISTS public.recs_radius_cleanup_20260924 CASCADE;
