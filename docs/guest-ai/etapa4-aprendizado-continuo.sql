-- =====================================================================================================
-- PROPOSTA (NÃO APLICADA) — Etapa 4 · Aprendizado contínuo da IA Guest · 08/11/2026
-- Status: aguardando aprovação do titular. NÃO é migration: não está em supabase/migrations e não foi
-- executada em nenhum banco. Depois de aprovada, vira migration própria (revisada e testada no PG).
--
-- Fluxo: CANDIDATO (IA sugere, só de fato encerrado) → REVISÃO HUMANA (só ai_train / dono / admin)
--        → DOCUMENTO VIVO (só aprovados e ativos, por imóvel, com histórico auditável).
-- Regras de candidatura (código puro já entregue: src/lib/guest-ai/learning/learning.ts):
--   origem ∈ {checkout_done, incident_resolved, guest_confirmation}, fato encerrado, mesmo imóvel,
--   duradouro (sem data/hora/valor/nome/código/telefone), sem segredo.
-- Nada aqui toca nas 29 tabelas da IA antiga. Sem DROP/TRUNCATE/DELETE de dados existentes.
-- =====================================================================================================

-- 1) Entradas (candidatas e aprovadas) — uma linha por aprendizado, isolada por imóvel
create table public.guest_ai_learning_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  property_id uuid not null references public.properties(id) on delete cascade,
  category text not null check (category in (
    'acesso_e_chegada','equipamentos','manutencao','regras_da_casa','vizinhanca','duvidas_frequentes')),
  statement text not null check (char_length(statement) between 15 and 400),
  source text not null check (source in ('checkout_done','incident_resolved','guest_confirmation')),
  evidence_refs text[] not null check (cardinality(evidence_refs) between 1 and 20),
  status text not null default 'pending' check (status in ('pending','approved','rejected','revoked')),
  proposed_by text not null default 'ai' check (proposed_by in ('ai','human')),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  -- decisão sempre com autor e instante; pendente nunca tem decisão
  constraint guest_ai_learning_decision_ck check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null))
);
create index guest_ai_learning_entries_property_idx on public.guest_ai_learning_entries (property_id, status);
-- mesma frase não é candidata duas vezes no mesmo imóvel enquanto pendente/aprovada
create unique index guest_ai_learning_entries_dedupe_idx
  on public.guest_ai_learning_entries (property_id, lower(statement))
  where status in ('pending','approved');

-- 2) Histórico auditável (append-only)
create table public.guest_ai_learning_events (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.guest_ai_learning_entries(id) on delete cascade,
  status text not null check (status in ('pending','approved','rejected','revoked')),
  actor uuid,            -- null = proposta da IA
  at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 300)
);
create index guest_ai_learning_events_entry_idx on public.guest_ai_learning_events (entry_id, at);

-- 3) RLS: leitura para quem enxerga o imóvel; NENHUMA escrita direta de cliente (só pelas RPCs)
alter table public.guest_ai_learning_entries enable row level security;
alter table public.guest_ai_learning_events enable row level security;

create policy "learning entries readable by property team" on public.guest_ai_learning_entries
  for select to authenticated
  using (owner_id = auth.uid()
         or has_role(auth.uid(), 'admin'::app_role)
         or member_can_see_property(auth.uid(), owner_id, property_id));

create policy "learning events readable by property team" on public.guest_ai_learning_events
  for select to authenticated
  using (exists (select 1 from public.guest_ai_learning_entries e
                 where e.id = entry_id
                   and (e.owner_id = auth.uid()
                        or has_role(auth.uid(), 'admin'::app_role)
                        or member_can_see_property(auth.uid(), e.owner_id, e.property_id))));

revoke all on public.guest_ai_learning_entries, public.guest_ai_learning_events from anon;
revoke insert, update, delete on public.guest_ai_learning_entries, public.guest_ai_learning_events from authenticated;
grant select on public.guest_ai_learning_entries, public.guest_ai_learning_events to authenticated;
grant all on public.guest_ai_learning_entries, public.guest_ai_learning_events to service_role;

-- 4) Proposta (só service_role — chamada pelo servidor depois de `evaluateCandidate` aprovar a candidatura)
create or replace function public.guest_ai_learning_propose(
  p_property_id uuid, p_category text, p_statement text, p_source text, p_evidence_refs text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_id uuid;
begin
  select owner_id into v_owner from public.properties where id = p_property_id;
  if v_owner is null then raise exception 'property_not_found'; end if;
  insert into public.guest_ai_learning_entries (owner_id, property_id, category, statement, source, evidence_refs)
  values (v_owner, p_property_id, p_category, btrim(p_statement), p_source, p_evidence_refs)
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.guest_ai_learning_events (entry_id, status, actor) values (v_id, 'pending', null);
  end if;
  return v_id; -- null = já existia (dedupe)
end $$;
revoke all on function public.guest_ai_learning_propose(uuid, text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.guest_ai_learning_propose(uuid, text, text, text, text[]) to service_role;

-- 5) Revisão humana (autor = auth.uid(); só dono, admin ou membro com ai_train; transições fechadas)
create or replace function public.guest_ai_learning_review(p_id uuid, p_action text, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare e public.guest_ai_learning_entries%rowtype; v_next text;
begin
  if auth.uid() is null then raise exception 'no_reviewer'; end if;
  select * into e from public.guest_ai_learning_entries where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if not (e.owner_id = auth.uid()
          or has_role(auth.uid(), 'admin'::app_role)
          or has_member_permission(auth.uid(), e.owner_id, 'ai_train'::member_permission)) then
    raise exception 'not_authorized';
  end if;
  v_next := case
    when e.status = 'pending'  and p_action = 'approve' then 'approved'
    when e.status = 'pending'  and p_action = 'reject'  then 'rejected'
    when e.status = 'approved' and p_action = 'revoke'  then 'revoked'
    else null end;
  if v_next is null then raise exception 'invalid_transition'; end if;
  update public.guest_ai_learning_entries
     set status = v_next, decided_by = auth.uid(), decided_at = now(),
         decision_note = left(nullif(btrim(p_note), ''), 300)
   where id = p_id;
  insert into public.guest_ai_learning_events (entry_id, status, actor, note)
  values (p_id, v_next, auth.uid(), left(nullif(btrim(p_note), ''), 300));
  return v_next;
end $$;
revoke all on function public.guest_ai_learning_review(uuid, text, text) from public, anon;
grant execute on function public.guest_ai_learning_review(uuid, text, text) to authenticated;

-- 6) Documento Vivo: leitura pela IA (service_role, só aprovados do imóvel do turno)
--    → no código: `renderLivingDocument(propertyId, entries)`; entra no prompt como bloco próprio do Dossiê,
--      audiência P, depois que o titular aprovar esta proposta E a tela de revisão (mockup antes).
