
update public.guest_arrival_status s
set status = 'pending', done_at = null, concluded_at = null
from public.guide_access_logs l
where s.log_id = l.id
  and s.kind = 'checkout'
  and l.checkin_date = '2026-07-26'
  and l.checkout_date = '2026-07-27'
  and (l.guest_name ilike 'thiago%' or l.guest_name ilike 'ana carla%');

update public.guest_arrival_status s
set concluded_at = null
from public.guide_access_logs l
where s.log_id = l.id
  and s.kind = 'checkin'
  and l.checkin_date = '2026-07-26'
  and l.checkout_date = '2026-07-27'
  and (l.guest_name ilike 'thiago%' or l.guest_name ilike 'ana carla%');
