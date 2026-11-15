-- ConciergeIA Guest AI · CHAMADO DE OCORRÊNCIA (15/11/2026, decisão do titular).
--
-- Quando o hóspede aponta uma situação negativa, a IA abre um chamado (um por assunto) e a equipe acompanha. O chamado
-- NÃO silencia a conversa: a IA segue atendendo os demais assuntos e apenas não promete nem resolve o assunto dele
-- (ele entra no contexto como chamado aberto, escopo "somente este assunto"). A IA fecha o chamado quando a conversa
-- mostra que foi resolvido; ocorrência GRAVE só é encerrada por uma pessoa. Reclamação repetida reabre.
-- Aditivo e idempotente. Escrita só pelo servidor (service_role); leitura pelos membros do imóvel. Sem cron, sem rede.

do $pre$
begin
  if to_regclass('public.property_chat_conversations') is null
     or to_regclass('public.properties') is null
     or to_regprocedure('public.user_can_access_property(uuid, uuid)') is null then
    raise exception 'GUEST_AI_INCIDENTS_PRE: estrutura base ausente; nada foi alterado';
  end if;
end $pre$;

create table if not exists public.guest_ai_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  conversation_id uuid not null,
  reservation_id uuid,
  status text not null default 'open' check (status in ('open', 'resolved')),
  severity text not null default 'normal' check (severity in ('normal', 'grave')),
  category text check (category is null or length(category) <= 40),
  summary text not null check (length(btrim(summary)) between 1 and 300),
  opened_message_id uuid,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text check (resolved_by is null or resolved_by in ('ai', 'human')),
  resolution_reason text check (resolution_reason is null or length(resolution_reason) <= 300),
  reopened_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint guest_ai_incidents_resolved_fields check (
    (status = 'resolved') = (resolved_at is not null and resolved_by is not null)
  )
);
create index if not exists guest_ai_incidents_open_by_conv
  on public.guest_ai_incidents (conversation_id) where status = 'open';
create index if not exists guest_ai_incidents_open_by_reservation
  on public.guest_ai_incidents (reservation_id) where status = 'open' and reservation_id is not null;
create index if not exists guest_ai_incidents_property_idx
  on public.guest_ai_incidents (property_id, opened_at desc);

alter table public.guest_ai_incidents enable row level security;
revoke all on table public.guest_ai_incidents from public, anon, authenticated, service_role;
grant select on table public.guest_ai_incidents to authenticated;
grant select, insert, update on table public.guest_ai_incidents to service_role;
drop policy if exists "ocorrências: membros do imóvel leem" on public.guest_ai_incidents;
create policy "ocorrências: membros do imóvel leem" on public.guest_ai_incidents
  for select to authenticated
  using (public.user_can_access_property(auth.uid(), property_id));
