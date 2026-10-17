-- Campos ricos da reserva (17/10/2026): modalidade de reserva, política de cancelamento
-- DA RESERVA e discriminação de valores, promovidos do JSON bruto a colunas.
alter table public.property_reservations
  add column if not exists booking_modality text check (booking_modality in ('instant_book','request_to_book')),
  add column if not exists cancellation_policy_category text,
  add column if not exists cancellation_policy_id text,
  add column if not exists is_non_refundable boolean not null default false,
  add column if not exists is_humanitarian_stay boolean not null default false,
  add column if not exists listing_base_price numeric(12,2),
  add column if not exists cleaning_fee numeric(12,2),
  add column if not exists channel_host_fee numeric(12,2),
  add column if not exists cohost_payout numeric(12,2),
  add column if not exists financial_breakdown jsonb;

-- Backfill a partir do bruto já gravado (raw_message pode ser texto JSON ou objeto).
with src as (
  select id,
    case when jsonb_typeof(raw_payload->'raw_message')='string'
         then (raw_payload->>'raw_message')::jsonb->'reservation'
         else raw_payload->'raw_message'->'reservation' end as res,
    raw_payload->>'notes' as notes
  from public.property_reservations
  where raw_payload ? 'raw_message'
), val as (
  select id, res, notes,
    (regexp_match(notes, 'Listing Base Price:\s*([0-9.]+)'))[1]::numeric as base,
    (regexp_match(notes, 'Cleaning Fee:\s*([0-9.]+)'))[1]::numeric as clean,
    (regexp_match(notes, 'Cohost Payout:\s*([0-9.]+)'))[1]::numeric as cohost
  from src where res is not null
)
update public.property_reservations p set
  booking_modality = case res->>'instant_booked' when 'true' then 'instant_book' when 'false' then 'request_to_book' else null end,
  cancellation_policy_category = res->>'cancellation_policy_category',
  cancellation_policy_id = res->>'cancellation_policy_id',
  is_non_refundable = (res->>'cancellation_policy_category') = 'tiered_pricing_non_refundable',
  is_humanitarian_stay = coalesce((res->>'is_airbnborg_stay')::boolean, false),
  listing_base_price = base,
  cleaning_fee = clean,
  cohost_payout = cohost,
  channel_host_fee = case when res ? 'host_fee_base'
        then round(coalesce((res->>'host_fee_base')::numeric,0) + coalesce((res->>'host_fee_vat')::numeric,0), 2) end
from val where p.id = val.id;

grant all on public.property_reservations to service_role;
grant select on public.property_reservations to authenticated;
