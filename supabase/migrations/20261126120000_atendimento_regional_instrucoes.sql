-- ATENDIMENTO REFATORADO (mockups ATD/REG/APR aprovados em 23–26/11/2026)
--
-- 1) Aprendizado vindo da janela "Instruir a IA": nova origem `team_instruction`.
-- 2) Situação regional confirmada pela equipe (a IA nunca decide sozinha que algo é regional, 23/11/2026):
--    `guest_ai_regional_situations` guarda a situação ativa por conta + cidade (tipo, bairros, texto para a IA,
--    validade) e também a SUGESTÃO de marcar (status `suggested`, presa à mensagem da equipe) e o "Agora Não"
--    (`dismissed`). Leitura: equipe da conta. Escrita: só pelo servidor (service_role), com a checagem de
--    `chat_respond` feita nas server functions.

alter table public.guest_ai_learning_entries drop constraint if exists guest_ai_learning_entries_source_check;
alter table public.guest_ai_learning_entries
  add constraint guest_ai_learning_entries_source_check
  check (source = any (array['checkout_done'::text, 'incident_resolved'::text, 'guest_confirmation'::text, 'team_instruction'::text]));

create table if not exists public.guest_ai_regional_situations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  city text not null check (char_length(btrim(city)) between 1 and 120),
  kind text not null check (char_length(btrim(kind)) between 1 and 80),
  neighborhoods text not null default 'Toda a cidade' check (char_length(neighborhoods) <= 200),
  ai_text text not null check (char_length(btrim(ai_text)) between 1 and 600),
  status text not null default 'active' check (status in ('suggested', 'active', 'ended', 'dismissed')),
  source_conversation_id uuid null references public.property_chat_conversations(id) on delete set null,
  source_message_id uuid null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz null,
  created_by uuid null,
  ended_by uuid null,
  ended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists guest_ai_regional_situations_active_idx
  on public.guest_ai_regional_situations (owner_id, status, expires_at);
create unique index if not exists guest_ai_regional_situations_source_msg_uq
  on public.guest_ai_regional_situations (source_message_id) where source_message_id is not null and status in ('suggested', 'dismissed');

alter table public.guest_ai_regional_situations enable row level security;

drop policy if exists "situações regionais: equipe da conta lê" on public.guest_ai_regional_situations;
create policy "situações regionais: equipe da conta lê"
  on public.guest_ai_regional_situations for select
  using (owner_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role) or is_account_member(auth.uid(), owner_id));

revoke insert, update, delete on public.guest_ai_regional_situations from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'guest_ai_regional_situations') then
    alter publication supabase_realtime add table public.guest_ai_regional_situations;
  end if;
end $$;
