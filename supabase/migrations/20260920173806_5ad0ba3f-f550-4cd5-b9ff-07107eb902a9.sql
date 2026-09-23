DELETE FROM public.reservation_records r
USING public.reservation_records k
WHERE r.storage_path IS NOT NULL
  AND r.storage_path = k.storage_path
  AND (r.created_at, r.id) > (k.created_at, k.id);

CREATE UNIQUE INDEX IF NOT EXISTS reservation_records_storage_path_uniq
  ON public.reservation_records (storage_path)
  WHERE storage_path IS NOT NULL;