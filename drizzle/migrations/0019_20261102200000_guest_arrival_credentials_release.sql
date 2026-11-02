alter table public.guest_arrival_status
  add column if not exists credentials_released_at timestamptz,
  add column if not exists credentials_released_by uuid references auth.users(id) on delete set null;
comment on column public.guest_arrival_status.credentials_released_at is
  'D13: quando a equipe liberou manualmente as credenciais neste cartão de check-in (NULL = não liberado). Não supera os vetos da D9.';
comment on column public.guest_arrival_status.credentials_released_by is
  'D13: quem liberou manualmente as credenciais (auth.users).';
create index if not exists idx_guest_arrival_status_credentials_released
  on public.guest_arrival_status (property_id)
  where credentials_released_at is not null;
