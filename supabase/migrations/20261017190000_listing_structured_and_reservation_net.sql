-- 17/10/2026: valores líquidos da reserva e campos estruturados do anúncio.
-- No Airbnb o `amount` já vem LÍQUIDO da comissão do canal (base + extras + limpeza - comissão);
-- o repasse do co-anfitrião (`cohost_payout`) sai dessa parte.
alter table public.property_reservations
  add column if not exists net_total numeric(12,2),
  add column if not exists host_net_payout numeric(12,2);

update public.property_reservations
   set net_total = round(amount::numeric, 2),
       host_net_payout = round(greatest(0, amount::numeric - coalesce(cohost_payout, 0)), 2)
 where amount > 0 and ota_name ilike 'airbnb' and net_total is null;

alter table public.properties
  add column if not exists airbnb_instant_booking boolean,
  add column if not exists airbnb_cancellation_category text;
