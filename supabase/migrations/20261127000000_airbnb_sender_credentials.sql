-- COFRE DO TOKEN DA CONTA REMETENTE NO AIRBNB (26/11/2026)
--
-- A Channex passou a devolver o token OAuth do Airbnb mascarado ("***") em GET /channels/:id, e o envio pela
-- conta do "Assina como" (ex.: "Anfitrião Sigma" em anúncio da Regina) parou de funcionar. Aqui o ConciergeIA
-- guarda, CIFRADO (AES-256-GCM no servidor), o último token real de cada conta, capturado sempre que a Channex
-- devolver um token de verdade. O envio direto usa este cofre primeiro e a Channex depois.
-- Só o servidor (service_role) lê e grava: nenhuma policy ⇒ acesso negado a anon/authenticated.

create table if not exists public.airbnb_sender_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channex_channel_id text not null,
  airbnb_user_id text,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  updated_at timestamptz not null default now(),
  constraint unique_tenant_channel_cred unique (owner_id, channex_channel_id)
);

create index if not exists airbnb_sender_credentials_channel_idx
  on public.airbnb_sender_credentials (channex_channel_id);

alter table public.airbnb_sender_credentials enable row level security;
revoke all on public.airbnb_sender_credentials from public, anon, authenticated;
grant all on public.airbnb_sender_credentials to service_role;
