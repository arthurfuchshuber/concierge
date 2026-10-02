-- LIMPEZA CRIADA MANUALMENTE (pedido de 02/10/2026).
--
-- A limpeza manual mora na MESMA tabela das limpezas da esteira
-- (guest_arrival_status, kind = 'checkout'), para entrar nos totais, no
-- ranking e na aprovação da completa sem conta paralela. Ela não tem
-- formulário (log_id) nem ocupa o lugar da limpeza da saída de uma reserva
-- (reservation_id): por isso a reserva vinculada fica em coluna própria e a
-- regra "toda linha aponta para um log ou uma reserva" ganha a exceção.
--
-- Tudo aditivo: colunas novas anuláveis (ou com padrão) e uma regra que só
-- fica MAIS permissiva. O código publicado antes desta migração continua
-- funcionando igual.

alter table public.guest_arrival_status
  add column if not exists manual boolean not null default false,
  add column if not exists manual_date date,
  add column if not exists manual_cleaning_type text,
  add column if not exists manual_reservation_id uuid
    references public.property_reservations(id) on delete set null,
  add column if not exists manual_created_by uuid;

alter table public.guest_arrival_status
  drop constraint if exists guest_arrival_status_manual_type_check;
alter table public.guest_arrival_status
  add constraint guest_arrival_status_manual_type_check
  check (manual_cleaning_type is null or manual_cleaning_type in ('normal', 'completa'));

-- Uma limpeza manual precisa do dia em que entra na fila.
alter table public.guest_arrival_status
  drop constraint if exists guest_arrival_status_manual_date_check;
alter table public.guest_arrival_status
  add constraint guest_arrival_status_manual_date_check
  check (not manual or manual_date is not null);

alter table public.guest_arrival_status
  drop constraint if exists guest_arrival_status_target_check;
alter table public.guest_arrival_status
  add constraint guest_arrival_status_target_check
  check (log_id is not null or reservation_id is not null or manual);

-- A fila consulta "manuais em aberto por imóvel".
create index if not exists guest_arrival_status_manual_open_idx
  on public.guest_arrival_status (property_id, manual_date)
  where manual and concluded_at is null;

create index if not exists guest_arrival_status_manual_reservation_idx
  on public.guest_arrival_status (manual_reservation_id)
  where manual_reservation_id is not null;
