-- ConciergeIA Guest AI · DECISÃO HUMANA COM 1 CLIQUE (10/11/2026, Opção 2 aprovada pelo titular).
--
-- Quando o hóspede pede uma exceção (late checkout, early check-in, concessão operacional), a IA NÃO responde:
-- abre UMA decisão pendente para a equipe, com pergunta curta (~35 palavras) e 2–4 botões. Enquanto houver
-- decisão pendente na conversa, a IA fica em silêncio absoluto para o hóspede (o slot consulta esta tabela).
-- Depois do clique: a ação sistêmica oficial roda (ex.: `internal_set_late_checkout`) e a IA envia UMA única
-- resposta ao hóspede — salvo "Eu assumo a conversa", que marca `ai_reply_status = 'silent'`.
--
-- Acesso: RLS ligada; leitura pelos membros do imóvel (`user_can_access_property`, a mesma regra das demais
-- tabelas da IA, que já cobre o tenant). Nenhuma escrita direta por anon/authenticated: tudo passa por RPCs
-- SECURITY DEFINER com search_path fixo e EXECUTE só para service_role (o servidor valida o usuário logado e
-- repassa o ator). A trava contra duplo clique é atômica no banco (UPDATE ... WHERE status = 'pending').
-- Sem texto livre do hóspede além da pergunta resumida; sem cron, sem pg_net, sem chamada externa. D9 intocada.

do $pre$
begin
  if to_regclass('public.property_chat_conversations') is null
     or to_regclass('public.property_chat_messages') is null
     or to_regclass('public.properties') is null
     or to_regprocedure('public.user_can_access_property(uuid, uuid)') is null then
    raise exception 'GUEST_AI_DECISIONS_PRE: estrutura base ausente; nada foi alterado';
  end if;
end $pre$;

create table if not exists public.guest_ai_human_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  conversation_id uuid not null,
  trigger_message_id uuid not null,
  kind text not null check (kind in ('late_checkout', 'early_checkin', 'operational_concession', 'general_decision')),
  question_text text not null check (length(btrim(question_text)) between 1 and 400),
  options jsonb not null check (
    jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4
  ),
  status text not null default 'pending' check (status in ('pending', 'decided', 'expired')),
  decided_option_id text,
  decided_by uuid,
  decided_at timestamptz,
  ai_reply_status text not null default 'pending' check (ai_reply_status in ('pending', 'sent', 'silent', 'error')),
  ai_reply_message_id uuid,
  created_at timestamptz not null default now(),
  -- uma decisão por mensagem do hóspede (reprocessar a mesma mensagem não duplica o cartão)
  constraint guest_ai_human_decisions_one_per_message unique (trigger_message_id),
  -- decidida ⇔ opção + autor + horário preenchidos
  constraint guest_ai_human_decisions_decided_fields check (
    (status = 'decided') = (decided_option_id is not null and decided_by is not null and decided_at is not null)
  ),
  -- resposta da IA só existe depois da decisão
  constraint guest_ai_human_decisions_reply_after_decision check (
    ai_reply_status = 'pending' or status = 'decided'
  )
);
-- no máximo UMA decisão pendente por conversa (é ela que mantém a IA em silêncio)
create unique index if not exists guest_ai_human_decisions_one_pending_per_conv
  on public.guest_ai_human_decisions (conversation_id) where status = 'pending';
create index if not exists guest_ai_human_decisions_property_idx
  on public.guest_ai_human_decisions (property_id, created_at desc);

alter table public.guest_ai_human_decisions enable row level security;
revoke all on table public.guest_ai_human_decisions from public, anon, authenticated, service_role;
grant select on table public.guest_ai_human_decisions to authenticated;
grant select on table public.guest_ai_human_decisions to service_role;
drop policy if exists "decisões: membros do imóvel leem" on public.guest_ai_human_decisions;
create policy "decisões: membros do imóvel leem" on public.guest_ai_human_decisions
  for select to authenticated
  using (public.user_can_access_property(auth.uid(), property_id));

-- 1) ABRIR: o orquestrador cria a decisão pendente (idempotente por mensagem; recusa se já houver outra pendente)
create or replace function public.guest_ai_decision_open(
  p_tenant_id uuid, p_property_id uuid, p_conversation_id uuid, p_trigger_message_id uuid,
  p_kind text, p_question_text text, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid;
  v_opt jsonb;
begin
  if p_tenant_id is null or p_property_id is null or p_conversation_id is null or p_trigger_message_id is null
     or p_kind is null or p_question_text is null or p_options is null then
    return jsonb_build_object('result', 'invalid', 'reason', 'arguments');
  end if;
  if not exists (select 1 from public.property_chat_conversations c join public.properties p on p.id = c.property_id
                 where c.id = p_conversation_id and c.property_id = p_property_id and p.owner_id = p_tenant_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'scope');
  end if;
  if not exists (select 1 from public.property_chat_messages m
                  where m.id = p_trigger_message_id and m.conversation_id = p_conversation_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'message');
  end if;
  -- cada botão: { id, label, variant, ai_intent } com id curto e rótulo não vazio
  if jsonb_typeof(p_options) <> 'array' then
    return jsonb_build_object('result', 'invalid', 'reason', 'options');
  end if;
  for v_opt in select * from jsonb_array_elements(p_options) loop
    if jsonb_typeof(v_opt) <> 'object'
       or coalesce(v_opt->>'id', '') !~ '^[a-z][a-z0-9_]{0,31}$'
       or length(btrim(coalesce(v_opt->>'label', ''))) not between 1 and 40
       or coalesce(v_opt->>'variant', '') not in ('primary', 'secondary', 'neutral', 'assume')
       or coalesce(v_opt->>'ai_intent', '') not in ('approve', 'charge', 'decline', 'assume') then
      return jsonb_build_object('result', 'invalid', 'reason', 'options');
    end if;
  end loop;
  begin
    insert into public.guest_ai_human_decisions
      (tenant_id, property_id, conversation_id, trigger_message_id, kind, question_text, options)
    values
      (p_tenant_id, p_property_id, p_conversation_id, p_trigger_message_id, p_kind, btrim(p_question_text), p_options)
    on conflict (trigger_message_id) do nothing
    returning id into v_id;
  exception
    when unique_violation then return jsonb_build_object('result', 'pending_exists');
    when check_violation then return jsonb_build_object('result', 'invalid', 'reason', 'values');
  end;
  if v_id is null then return jsonb_build_object('result', 'exists'); end if;
  return jsonb_build_object('result', 'opened', 'id', v_id);
end $$;

-- 2) DECIDIR: trava atômica contra duplo clique; o ator precisa ter acesso ao imóvel
create or replace function public.guest_ai_decision_claim(p_decision_id uuid, p_actor uuid, p_option_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_row public.guest_ai_human_decisions%rowtype;
begin
  if p_decision_id is null or p_actor is null or p_option_id is null then
    return jsonb_build_object('result', 'invalid', 'reason', 'arguments');
  end if;
  select * into v_row from public.guest_ai_human_decisions where id = p_decision_id;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if not public.user_can_access_property(p_actor, v_row.property_id) then
    return jsonb_build_object('result', 'forbidden');
  end if;
  if not exists (select 1 from jsonb_array_elements(v_row.options) o where o->>'id' = p_option_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'option');
  end if;
  update public.guest_ai_human_decisions
     set status = 'decided', decided_option_id = p_option_id, decided_by = p_actor, decided_at = now()
   where id = p_decision_id and status = 'pending'
  returning * into v_row;
  if not found then
    select * into v_row from public.guest_ai_human_decisions where id = p_decision_id;
    return jsonb_build_object('result', 'already_decided', 'status', v_row.status,
                              'decided_option_id', v_row.decided_option_id, 'decided_by', v_row.decided_by);
  end if;
  return jsonb_build_object('result', 'claimed', 'id', v_row.id, 'kind', v_row.kind,
                            'option', (select o from jsonb_array_elements(v_row.options) o where o->>'id' = p_option_id limit 1));
end $$;

-- 3) RESPOSTA DA IA: registra o desfecho da mensagem única (só uma vez, só após decisão)
create or replace function public.guest_ai_decision_mark_reply(p_decision_id uuid, p_status text, p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_decision_id is null or p_status not in ('sent', 'silent', 'error') then
    return jsonb_build_object('result', 'invalid', 'reason', 'arguments');
  end if;
  if p_status = 'sent' and p_message_id is null then
    return jsonb_build_object('result', 'invalid', 'reason', 'message');
  end if;
  update public.guest_ai_human_decisions
     set ai_reply_status = p_status, ai_reply_message_id = p_message_id
   where id = p_decision_id and status = 'decided' and ai_reply_status in ('pending', 'error');
  if not found then return jsonb_build_object('result', 'noop'); end if;
  return jsonb_build_object('result', 'marked');
end $$;

-- 4) EXPIRAR: libera o silêncio quando a decisão perde o sentido (ex.: checkout concluído, conversa encerrada)
create or replace function public.guest_ai_decision_expire(p_decision_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  update public.guest_ai_human_decisions set status = 'expired'
   where id = p_decision_id and status = 'pending';
  if not found then return jsonb_build_object('result', 'noop'); end if;
  return jsonb_build_object('result', 'expired');
end $$;

revoke all on function public.guest_ai_decision_open(uuid, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.guest_ai_decision_claim(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.guest_ai_decision_mark_reply(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.guest_ai_decision_expire(uuid) from public, anon, authenticated;
grant execute on function public.guest_ai_decision_open(uuid, uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.guest_ai_decision_claim(uuid, uuid, text) to service_role;
grant execute on function public.guest_ai_decision_mark_reply(uuid, text, uuid) to service_role;
grant execute on function public.guest_ai_decision_expire(uuid) to service_role;

-- tempo real: o cartão muda de estado na hora para toda a equipe (pendente → decidido)
do $rt$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'guest_ai_human_decisions') then
    alter publication supabase_realtime add table public.guest_ai_human_decisions;
  end if;
end $rt$;
