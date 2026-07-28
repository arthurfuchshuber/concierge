-- Backfill reservation_code em guide_access_logs a partir do guest_hint do iCal,
-- somente quando existe UMA reserva iCal com o mesmo par (property_id, checkin_date, checkout_date).
WITH candidates AS (
  SELECT l.id AS log_id, r.guest_hint AS code
  FROM public.guide_access_logs l
  JOIN public.property_reservations r
    ON r.property_id = l.property_id
   AND r.checkin_date = l.checkin_date
   AND r.checkout_date = l.checkout_date
   AND r.source = 'airbnb'
   AND r.guest_hint IS NOT NULL
  WHERE l.reservation_code IS NULL
),
uniq AS (
  SELECT log_id, MAX(code) AS code
  FROM candidates
  GROUP BY log_id
  HAVING COUNT(DISTINCT code) = 1
)
UPDATE public.guide_access_logs l
   SET reservation_code = u.code
  FROM uniq u
 WHERE l.id = u.log_id;