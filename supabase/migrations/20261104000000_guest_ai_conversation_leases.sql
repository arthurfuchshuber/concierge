-- ConciergeIA Guest AI · Gate B3.1 — lease distribuído por conversa (migration excepcional, autorizada em 03/11/2026).
--
-- Escopo ÚNICO: coordenação de workers do coletor (um lote por conversa por vez). Nenhum conteúdo de
-- mensagem, texto de hóspede, resposta, dado pessoal ou segredo. Nenhuma outra estrutura é alterada.
--
-- Máquina de estados (espelho de `src/lib/guest-ai/batch/lease.ts`):
--   (ausente) --observe--> collecting --mark_ready--> ready --claim--> claimed --start--> processing
--   processing --complete--> completed
--   claimed|processing --fail(retryable, tentativas < 3)--> ready ; --fail(definitiva ou 3ª)--> failed
--   claimed|processing com prazo vencido --expire/claim--> expired --claim--> claimed (nova posse, nova versão)
--   collecting|ready|claimed|processing|expired --cancel--> cancelled
--   completed|failed|cancelled|expired --observe (mensagens novas)--> collecting (novo ciclo)
--   claimed|processing --observe--> mesmo estado, mensagens novas só em deferred_message_ids (versão inalterada)
-- Tentativas: orçamento por LOTE — novo ciclo zera só se trouxer mensagem fora do lote anterior.
-- Toda escrita: uma transação, linha travada, compare-and-swap de `version` (+ `owner_token` quando há
-- posse, inclusive no expire), versão incrementada — exceto o adiamento de mensagens durante a posse,
-- que não muda a versão para não tirar a autoridade do dono legítimo. A aquisição usa FOR UPDATE SKIP LOCKED. Instantes vêm do banco (now()).
-- Acesso: RLS ligada sem política; nenhum DML direto para ninguém; service_role só SELECT e EXECUTE.

create table public.guest_ai_conversation_leases (
  conversation_id      uuid primary key references public.property_chat_conversations(id) on delete cascade,
  state                text not null,
  version              integer not null default 1,
  batch_id             uuid,
  message_ids          uuid[],
  owner_token          text,
  lease_expires_at     timestamptz,
  attempts             integer not null default 0,
  deferred_message_ids uuid[],
  updated_at           timestamptz not null default now(),

  constraint gacl_state_ck check (state in ('collecting', 'ready', 'claimed', 'processing', 'completed', 'failed', 'cancelled', 'expired')),
  constraint gacl_version_ck check (version >= 1),
  constraint gacl_attempts_ck check (attempts between 0 and 3),
  -- posse válida só em claimed/processing; nunca em estados terminais, de coleta ou expirados
  constraint gacl_owner_ck check (
    (state in ('claimed', 'processing') and owner_token is not null and lease_expires_at is not null)
    or (state not in ('claimed', 'processing') and owner_token is null)
  ),
  constraint gacl_owner_format_ck check (owner_token is null or owner_token ~ '^[0-9a-f]{64}$'),
  constraint gacl_expiry_ck check (lease_expires_at is null or state in ('claimed', 'processing', 'expired')),
  -- lote fechado: identificador e mensagens obrigatórios a partir de ready; coleta sem lote fechado
  constraint gacl_batch_ck check (
    (state in ('ready', 'claimed', 'processing', 'completed') and batch_id is not null and message_ids is not null
       and cardinality(message_ids) between 1 and 20)
    or (state = 'collecting' and batch_id is null)
    or state in ('failed', 'cancelled', 'expired')
  ),
  constraint gacl_messages_ck check (message_ids is null or (cardinality(message_ids) <= 50 and array_position(message_ids, null) is null)),
  constraint gacl_deferred_ck check (deferred_message_ids is null or (cardinality(deferred_message_ids) <= 200 and array_position(deferred_message_ids, null) is null))
);

comment on table public.guest_ai_conversation_leases is
  'Guest AI B3.1: lease distribuído por conversa (coordenação de workers). Só metadados; escrita só pelas funções claim_/transition_conversation_lease.';

alter table public.guest_ai_conversation_leases enable row level security;
-- nenhuma política: clientes (anon/authenticated) não enxergam nem alteram nada
revoke all on table public.guest_ai_conversation_leases from public, anon, authenticated, service_role;
grant select on table public.guest_ai_conversation_leases to service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    execute 'revoke all on table public.guest_ai_conversation_leases from sandbox_exec';
  end if;
end $$;

-- ───────────────────────── Aquisição ─────────────────────────
create or replace function public.claim_conversation_lease(
  p_conversation_id uuid,
  p_expected_version integer,
  p_ttl_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  r public.guest_ai_conversation_leases%rowtype;
  v_token text;
  v_recover boolean;
begin
  if p_conversation_id is null or p_expected_version is null or p_expected_version < 1
     or p_ttl_seconds is null or p_ttl_seconds < 5 or p_ttl_seconds > 300 then
    return jsonb_build_object('result', 'invalid_argument');
  end if;

  -- linha travada por outra transação ⇒ indisponível (nunca espera, nunca disputa a mesma posse)
  select * into r from public.guest_ai_conversation_leases
   where conversation_id = p_conversation_id
   for update skip locked;
  if not found then
    if exists (select 1 from public.guest_ai_conversation_leases where conversation_id = p_conversation_id) then
      return jsonb_build_object('result', 'unavailable');
    end if;
    return jsonb_build_object('result', 'not_found');
  end if;

  if r.version <> p_expected_version then
    return jsonb_build_object('result', 'stale_version', 'version', r.version, 'state', r.state);
  end if;

  v_recover := r.state = 'expired'
            or (r.state in ('claimed', 'processing') and r.lease_expires_at <= now());
  if r.state in ('claimed', 'processing') and not v_recover then
    return jsonb_build_object('result', 'conflict', 'version', r.version, 'state', r.state);
  end if;
  if r.state <> 'ready' and not v_recover then
    return jsonb_build_object('result', 'not_claimable', 'version', r.version, 'state', r.state);
  end if;
  if r.attempts >= 3 then
    return jsonb_build_object('result', 'attempts_exhausted', 'version', r.version, 'state', r.state, 'attempts', r.attempts);
  end if;
  if r.batch_id is null or r.message_ids is null or cardinality(r.message_ids) = 0 then
    return jsonb_build_object('result', 'not_claimable', 'version', r.version, 'state', r.state);
  end if;

  -- token imprevisível (2 × UUID v4 aleatório ⇒ 244 bits), gerado pelo banco
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.guest_ai_conversation_leases
     set state = 'claimed',
         owner_token = v_token,
         lease_expires_at = now() + make_interval(secs => p_ttl_seconds),
         attempts = r.attempts + 1,
         version = r.version + 1,
         updated_at = now()
   where conversation_id = p_conversation_id
   returning * into r;

  return jsonb_build_object(
    'result', case when v_recover then 'recovered' else 'acquired' end,
    'version', r.version, 'state', r.state, 'owner_token', r.owner_token,
    'lease_expires_at', r.lease_expires_at, 'attempts', r.attempts,
    'batch_id', r.batch_id, 'message_ids', to_jsonb(r.message_ids));
end;
$function$;

-- ───────────────────────── Transições ─────────────────────────
create or replace function public.transition_conversation_lease(
  p_conversation_id uuid,
  p_event text,
  p_expected_version integer,
  p_owner_token text default null,
  p_message_ids uuid[] default null,
  p_retryable boolean default null,
  p_ttl_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  r public.guest_ai_conversation_leases%rowtype;
  v_ids uuid[];
  v_fresh uuid[];
  v_live boolean;
  v_owner_ok boolean;
begin
  if p_conversation_id is null or p_expected_version is null or p_expected_version < 0
     or p_event is null or p_event not in ('observe', 'mark_ready', 'start', 'renew', 'complete', 'fail', 'cancel', 'expire')
     or (p_owner_token is not null and p_owner_token !~ '^[0-9a-f]{64}$')
     or (p_message_ids is not null and (cardinality(p_message_ids) > 50 or array_position(p_message_ids, null) is not null
          or cardinality(p_message_ids) <> (select count(distinct x) from unnest(p_message_ids) x)))
     or p_ttl_seconds is null or p_ttl_seconds < 5 or p_ttl_seconds > 300 then
    return jsonb_build_object('result', 'invalid_argument');
  end if;

  -- primeira observação cria a linha (versão 1); concorrência resolvida pela PK
  if p_event = 'observe' and p_expected_version = 0 then
    if p_message_ids is null or cardinality(p_message_ids) = 0 then
      return jsonb_build_object('result', 'invalid_argument');
    end if;
    if not exists (select 1 from public.property_chat_conversations where id = p_conversation_id) then
      return jsonb_build_object('result', 'not_found');
    end if;
    insert into public.guest_ai_conversation_leases (conversation_id, state, version, message_ids, deferred_message_ids)
    values (p_conversation_id, 'collecting', 1, p_message_ids, '{}')
    on conflict (conversation_id) do nothing
    returning * into r;
    if not found then
      select * into r from public.guest_ai_conversation_leases where conversation_id = p_conversation_id;
      return jsonb_build_object('result', 'stale_version', 'version', r.version, 'state', r.state);
    end if;
    return jsonb_build_object('result', 'applied', 'version', r.version, 'state', r.state);
  end if;

  select * into r from public.guest_ai_conversation_leases where conversation_id = p_conversation_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  -- 'complete' repetido sobre o próprio lote concluído: idempotente e explícito
  if p_event = 'complete' and r.state = 'completed' then
    return jsonb_build_object('result', 'already_processed', 'version', r.version, 'state', r.state);
  end if;
  if r.version <> p_expected_version then
    return jsonb_build_object('result', 'stale_version', 'version', r.version, 'state', r.state);
  end if;

  -- expire também respeita o CAS: só a partir da versão que o chamador leu, e só se o prazo
  -- realmente venceu pelo relógio do banco (lease vigente ⇒ noop, sem mudar a versão)
  if p_event = 'expire' then
    if r.state in ('claimed', 'processing') and r.lease_expires_at <= now() then
      update public.guest_ai_conversation_leases
         set state = 'expired', owner_token = null, version = r.version + 1, updated_at = now()
       where conversation_id = p_conversation_id returning * into r;
      return jsonb_build_object('result', 'applied', 'version', r.version, 'state', r.state);
    end if;
    return jsonb_build_object('result', 'noop', 'version', r.version, 'state', r.state);
  end if;

  v_live := r.state in ('claimed', 'processing') and r.lease_expires_at > now();
  v_owner_ok := p_owner_token is not null and r.owner_token is not null and p_owner_token = r.owner_token;

  if p_event = 'observe' then
    if p_message_ids is null or cardinality(p_message_ids) = 0 then
      return jsonb_build_object('result', 'invalid_argument');
    end if;
    if r.state in ('claimed', 'processing') then
      -- lote reivindicado é imutável: mensagens novas só no adiamento (sem perda, sem duplicação)
      select coalesce(array_agg(x order by o), '{}') into v_fresh
        from unnest(p_message_ids) with ordinality t(x, o)
       where not (x = any (coalesce(r.message_ids, '{}'))) and not (x = any (coalesce(r.deferred_message_ids, '{}')));
      if cardinality(v_fresh) = 0 then
        return jsonb_build_object('result', 'noop', 'version', r.version, 'state', r.state);
      end if;
      -- o adiamento NÃO muda a versão: a versão de posse do dono continua válida (só ele a altera
      -- com start/renew/complete/fail, ou a perde por expiração/recuperação). Linha travada ⇒ observações
      -- concorrentes são serializadas e o cálculo de `v_fresh` evita perda e duplicação.
      update public.guest_ai_conversation_leases
         set deferred_message_ids = coalesce(r.deferred_message_ids, '{}') || v_fresh, updated_at = now()
       where conversation_id = p_conversation_id returning * into r;
      return jsonb_build_object('result', 'deferred', 'version', r.version, 'state', r.state, 'deferred_message_ids', to_jsonb(r.deferred_message_ids));
    end if;
    if r.state = 'completed' then
      select coalesce(array_agg(x order by o), '{}') into v_ids
        from unnest(p_message_ids) with ordinality t(x, o)
       where not (x = any (r.message_ids));
      if cardinality(v_ids) = 0 then
        return jsonb_build_object('result', 'noop', 'version', r.version, 'state', r.state);
      end if;
    else
      v_ids := p_message_ids;
    end if;
    update public.guest_ai_conversation_leases
       set state = 'collecting', batch_id = null, message_ids = v_ids, owner_token = null, lease_expires_at = null,
           deferred_message_ids = '{}',
           -- orçamento de tentativas é do LOTE: zera só quando entra mensagem que o lote anterior não
           -- tinha (novo lote); mesmas mensagens (recuperação do mesmo lote) preservam o contador
           attempts = case
             when r.state = 'completed' then 0
             when exists (select 1 from unnest(v_ids) x where not (x = any (coalesce(r.message_ids, '{}')))) then 0
             else r.attempts
           end,
           version = r.version + 1, updated_at = now()
     where conversation_id = p_conversation_id returning * into r;
    return jsonb_build_object('result', 'applied', 'version', r.version, 'state', r.state);
  end if;

  if p_event = 'mark_ready' then
    if r.state <> 'collecting' then
      return jsonb_build_object('result', 'invalid_transition', 'version', r.version, 'state', r.state);
    end if;
    if p_message_ids is null or cardinality(p_message_ids) < 1 or cardinality(p_message_ids) > 20 then
      return jsonb_build_object('result', 'invalid_argument');
    end if;
    update public.guest_ai_conversation_leases
       set state = 'ready', batch_id = gen_random_uuid(), message_ids = p_message_ids, version = r.version + 1, updated_at = now()
     where conversation_id = p_conversation_id returning * into r;
    return jsonb_build_object('result', 'applied', 'version', r.version, 'state', r.state, 'batch_id', r.batch_id, 'message_ids', to_jsonb(r.message_ids));
  end if;

  if p_event = 'cancel' then
    if r.state in ('completed', 'failed', 'cancelled') then
      return jsonb_build_object('result', 'invalid_transition', 'version', r.version, 'state', r.state);
    end if;
    -- posse vigente só pode ser cancelada pelo próprio dono
    if v_live and not v_owner_ok then
      return jsonb_build_object('result', 'stale_owner', 'version', r.version, 'state', r.state);
    end if;
    update public.guest_ai_conversation_leases
       set state = 'cancelled', owner_token = null, lease_expires_at = null, version = r.version + 1, updated_at = now()
     where conversation_id = p_conversation_id returning * into r;
    return jsonb_build_object('result', 'applied', 'version', r.version, 'state', r.state);
  end if;

  -- start / renew / complete / fail: exigem posse (versão + token) vigente
  if r.state not in ('claimed', 'processing') then
    return jsonb_build_object('result', 'invalid_transition', 'version', r.version, 'state', r.state);
  end if;
  if not v_owner_ok then
    return jsonb_build_object('result', 'stale_owner', 'version', r.version, 'state', r.state);
  end if;
  if not v_live then
    return jsonb_build_object('result', 'lease_expired', 'version', r.version, 'state', r.state);
  end if;

  if p_event = 'start' then
    if r.state <> 'claimed' then
      return jsonb_build_object('result', 'invalid_transition', 'version', r.version, 'state', r.state);
    end if;
    update public.guest_ai_conversation_leases set state = 'processing', version = r.version + 1, updated_at = now()
     where conversation_id = p_conversation_id returning * into r;
  elsif p_event = 'renew' then
    update public.guest_ai_conversation_leases
       set lease_expires_at = now() + make_interval(secs => p_ttl_seconds), version = r.version + 1, updated_at = now()
     where conversation_id = p_conversation_id returning * into r;
  elsif p_event = 'complete' then
    if r.state <> 'processing' then
      return jsonb_build_object('result', 'invalid_transition', 'version', r.version, 'state', r.state);
    end if;
    update public.guest_ai_conversation_leases
       set state = 'completed', owner_token = null, lease_expires_at = null, version = r.version + 1, updated_at = now()
     where conversation_id = p_conversation_id returning * into r;
  elsif p_event = 'fail' then
    if p_retryable is null then
      return jsonb_build_object('result', 'invalid_argument');
    end if;
    update public.guest_ai_conversation_leases
       set state = case when p_retryable and r.attempts < 3 then 'ready' else 'failed' end,
           owner_token = null, lease_expires_at = null, version = r.version + 1, updated_at = now()
     where conversation_id = p_conversation_id returning * into r;
  end if;
  return jsonb_build_object('result', 'applied', 'version', r.version, 'state', r.state, 'lease_expires_at', r.lease_expires_at, 'attempts', r.attempts);
end;
$function$;

revoke all on function public.claim_conversation_lease(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.transition_conversation_lease(uuid, text, integer, text, uuid[], boolean, integer) from public, anon, authenticated;
grant execute on function public.claim_conversation_lease(uuid, integer, integer) to service_role;
grant execute on function public.transition_conversation_lease(uuid, text, integer, text, uuid[], boolean, integer) to service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    execute 'revoke all on function public.claim_conversation_lease(uuid, integer, integer) from sandbox_exec';
    execute 'revoke all on function public.transition_conversation_lease(uuid, text, integer, text, uuid[], boolean, integer) from sandbox_exec';
  end if;
end $$;
