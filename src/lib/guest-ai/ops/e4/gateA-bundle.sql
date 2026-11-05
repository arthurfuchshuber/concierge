-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · GATE A · BUNDLE SQL ÚNICO (Caminho 2 ratificado).
-- NÃO EXECUTAR sem a autorização expressa do Anfitrião Sigma para o Gate A. Aplicação INERTE: escopo `none`,
-- estado `disabled`, nenhum interruptor, nenhum cron. Gerado por `src/lib/guest-ai/ops/e4/gen-gateA-bundle.mjs`
-- (determinístico; conferir com `--check`). Não editar à mão.
--
-- EXECUÇÃO: o texto INTEIRO numa ÚNICA chamada, como `postgres`, pela interface SQL do Lovable Cloud (que envia
-- tudo numa mensagem do protocolo simples ⇒ UMA transação implícita). SEM `BEGIN`/`COMMIT` de propósito: erro em
-- qualquer comando desfaz TUDO no próprio servidor e solta os locks (um BEGIN explícito deixaria a conexão do pool
-- em transação abortada segurando locks). A guarda abaixo PROVA, antes de qualquer DDL, que os comandos estão na
-- mesma transação e que os timeouts valem; se não estiverem (autocommit por comando), aborta sem aplicar nada.
-- Antes: 01-preflight.sql e 09-sonda-transacao.sql (na MESMA interface). Depois: 02-validate.sql, 07, 08.
--
-- Origem (ordem de dependência):
--   1/3  supabase/migrations/20261104000000_guest_ai_conversation_leases.sql  sha256 4501bf5ecde0907cacd66b190299837888c9da96021b8fc349cfae10b6144de3
--   2/3  supabase/migrations/20261104120000_guest_ai_shadow.sql  sha256 24d7e6b1c756c0a814560ddc0905bc951033213a5dace9da5a7acb307a49ba6b
--   3/3  supabase/migrations/20261105120000_guest_ai_shadow_global.sql  sha256 af4280f68e24b984bfe60d8b611df350028347a32a9dc0c3a47cc902673e4b39
-- Conteúdo conferido no servidor (entre os marcadores INÍCIO/FIM): sha256 ee6623fa3812215fb6566faa257bf8be3e5f66d8b1b77a8b6916222924a35c9d

set local lock_timeout = '3s';
set local statement_timeout = '120s';
select set_config('guest_ai.gate_a_bundle', 'on', true);
-- Guarda (antes de qualquer DDL): (1) mesma transação; (2) timeouts efetivos; (3) INTEGRIDADE do texto recebido pelo
-- servidor: o SHA-256 do conteúdo entre os marcadores INÍCIO/FIM (lido de `current_query()`, a mensagem inteira) tem
-- de ser igual ao gerado. Corte, troca de quebra de linha ou remoção de comentários pela interface ⇒ aborta sem aplicar.
do $gate_a$
declare
  q text := current_query();
  s integer;
  e integer;
begin
  if current_setting('guest_ai.gate_a_bundle', true) is distinct from 'on' then
    raise exception 'gate_a_bundle: comandos fora de uma transação única (autocommit por comando); nada foi aplicado' using errcode = 'P0001';
  end if;
  if current_setting('lock_timeout') <> '3s' or current_setting('statement_timeout') <> '2min' then
    raise exception 'gate_a_bundle: timeouts não efetivos (lock_timeout=%, statement_timeout=%); nada foi aplicado',
      current_setting('lock_timeout'), current_setting('statement_timeout') using errcode = 'P0001';
  end if;
  -- marcadores montados por concatenação: a própria guarda não contém o texto literal deles
  s := strpos(q, E'\n-- ═══ INÍCIO DO CONTEÚDO' || E' DO GATE A ═══\n');
  e := strpos(q, E'\n-- ═══ FIM DO CONTEÚDO' || E' DO GATE A ═══\n');
  if s = 0 or e = 0 or e < s then
    raise exception 'gate_a_bundle: marcadores de conteúdo ausentes no texto recebido (texto cortado ou alterado pela interface); nada foi aplicado' using errcode = 'P0001';
  end if;
  if encode(sha256(convert_to(substr(q, s, e - s), 'UTF8')), 'hex') <> 'ee6623fa3812215fb6566faa257bf8be3e5f66d8b1b77a8b6916222924a35c9d' then
    raise exception 'gate_a_bundle: conteúdo recebido difere do gerado (SHA-256); nada foi aplicado' using errcode = 'P0001';
  end if;
end
$gate_a$;
-- ═══ INÍCIO DO CONTEÚDO DO GATE A ═══
-- ═════════════════ 1/3 · supabase/migrations/20261104000000_guest_ai_conversation_leases.sql ═════════════════
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
--   completed|failed|cancelled|expired --observe--> collecting (novo ciclo): pendentes = lote não concluído
--     ∪ adiadas ∪ observadas, sem duplicar, na ordem de chegada (independe de o coletor reapresentar tudo);
--     só o lote CONCLUÍDO sai (vai para processed_message_ids e nunca volta, mesmo reapresentado); excedente além de 50 fica em deferred_message_ids; teto total 200 ⇒ recusa
--   mark_ready: o lote (1–20) precisa ser subconjunto das pendentes; o resto continua adiado
--   acknowledge: remoção explícita de pendentes que não serão processadas (nunca do lote fechado); também
--     vão para processed_message_ids
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
  -- ids já concluídos/dispensados (janela das 200 mais recentes, > 40 que o coletor reapresenta):
  -- nunca voltam a ser pendentes, mesmo que o coletor os reapresente
  processed_message_ids uuid[] not null default '{}',
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
  constraint gacl_deferred_ck check (deferred_message_ids is null or (cardinality(deferred_message_ids) <= 200 and array_position(deferred_message_ids, null) is null)),
  constraint gacl_processed_ck check (cardinality(processed_message_ids) <= 200 and array_position(processed_message_ids, null) is null)
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
  v_prev uuid[];
  v_rem uuid[];
  v_obs uuid[];
  v_live boolean;
  v_owner_ok boolean;
begin
  if p_conversation_id is null or p_expected_version is null or p_expected_version < 0
     or p_event is null or p_event not in ('observe', 'mark_ready', 'start', 'renew', 'complete', 'fail', 'cancel', 'expire', 'acknowledge')
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
    -- já concluídas/dispensadas nunca voltam a ser pendentes (o coletor pode reapresentá-las)
    select coalesce(array_agg(x order by o), '{}') into v_obs
      from unnest(p_message_ids) with ordinality t(x, o) where not (x = any (r.processed_message_ids));
    if r.state in ('claimed', 'processing') then
      -- lote reivindicado é imutável: mensagens novas só no adiamento (sem perda, sem duplicação)
      select coalesce(array_agg(x order by o), '{}') into v_fresh
        from unnest(v_obs) with ordinality t(x, o)
       where not (x = any (coalesce(r.message_ids, '{}'))) and not (x = any (coalesce(r.deferred_message_ids, '{}')));
      if cardinality(v_fresh) = 0 then
        return jsonb_build_object('result', 'noop', 'version', r.version, 'state', r.state);
      end if;
      -- teto explícito de pendentes: nunca trunca; recusa e o chamador escala
      if cardinality(coalesce(r.deferred_message_ids, '{}')) + cardinality(v_fresh) > 200 then
        return jsonb_build_object('result', 'pending_overflow', 'version', r.version, 'state', r.state);
      end if;
      -- o adiamento NÃO muda a versão: a versão de posse do dono continua válida (só ele a altera
      -- com start/renew/complete/fail, ou a perde por expiração/recuperação). Linha travada ⇒ observações
      -- concorrentes são serializadas e o cálculo de `v_fresh` evita perda e duplicação.
      update public.guest_ai_conversation_leases
         set deferred_message_ids = coalesce(r.deferred_message_ids, '{}') || v_fresh, updated_at = now()
       where conversation_id = p_conversation_id returning * into r;
      return jsonb_build_object('result', 'deferred', 'version', r.version, 'state', r.state, 'deferred_message_ids', to_jsonb(r.deferred_message_ids));
    end if;
    -- Pendentes do novo ciclo = lote NÃO concluído ∪ adiadas ∪ reapresentadas/novas: sem duplicar, na
    -- ordem de chegada. Não depende de o coletor reapresentar tudo (ele pode mandar só as novas).
    -- Lote concluído sai; nada mais sai sem 'acknowledge' explícito.
    v_prev := coalesce(r.message_ids, '{}') || coalesce(r.deferred_message_ids, '{}');
    select coalesce(array_agg(x order by o), '{}') into v_ids
      from (select x, min(o) as o
              from unnest(case when r.state = 'completed' then coalesce(r.deferred_message_ids, '{}') else v_prev end || v_obs)
                   with ordinality t(x, o)
             group by x) s;
    if cardinality(v_ids) = 0 then
      return jsonb_build_object('result', 'noop', 'version', r.version, 'state', r.state);
    end if;
    -- observação repetida sem nada novo não reabre coleta nem desfaz lote pronto (idempotente)
    if r.state in ('collecting', 'ready') and not exists (select 1 from unnest(v_ids) x where not (x = any (v_prev))) then
      return jsonb_build_object('result', 'noop', 'version', r.version, 'state', r.state);
    end if;
    -- teto explícito de pendentes (50 no array em coleta + excedente adiado): nunca trunca
    if cardinality(v_ids) > 200 then
      return jsonb_build_object('result', 'pending_overflow', 'version', r.version, 'state', r.state);
    end if;
    update public.guest_ai_conversation_leases
       set state = 'collecting', batch_id = null,
           message_ids = v_ids[1:50],
           deferred_message_ids = coalesce(v_ids[51:cardinality(v_ids)], '{}'),
           owner_token = null, lease_expires_at = null,
           -- orçamento de tentativas é do LOTE: zera quando o ciclo anterior concluiu ou quando entra
           -- mensagem que não estava pendente; mesmas pendentes (recuperação do mesmo lote) preservam o contador
           attempts = case
             when r.state = 'completed' then 0
             when exists (select 1 from unnest(v_ids) x where not (x = any (v_prev))) then 0
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
    -- o lote só pode conter mensagens pendentes; o que não entra no lote continua pendente (adiado)
    v_prev := coalesce(r.message_ids, '{}') || coalesce(r.deferred_message_ids, '{}');
    if exists (select 1 from unnest(p_message_ids) x where not (x = any (v_prev))) then
      return jsonb_build_object('result', 'invalid_argument');
    end if;
    select coalesce(array_agg(x order by o), '{}') into v_rem
      from unnest(v_prev) with ordinality t(x, o) where not (x = any (p_message_ids));
    update public.guest_ai_conversation_leases
       set state = 'ready', batch_id = gen_random_uuid(), message_ids = p_message_ids, deferred_message_ids = v_rem,
           version = r.version + 1, updated_at = now()
     where conversation_id = p_conversation_id returning * into r;
    return jsonb_build_object('result', 'applied', 'version', r.version, 'state', r.state, 'batch_id', r.batch_id, 'message_ids', to_jsonb(r.message_ids));
  end if;

  -- remoção EXPLÍCITA de pendentes que não serão processadas (ex.: mensagens da pausa já tratadas pela
  -- equipe). Nunca toca um lote fechado (ready/claimed/processing/completed) nem age durante a posse.
  if p_event = 'acknowledge' then
    if p_message_ids is null or cardinality(p_message_ids) = 0 then
      return jsonb_build_object('result', 'invalid_argument');
    end if;
    if r.state in ('claimed', 'processing')
       or (r.state in ('ready', 'completed') and exists (select 1 from unnest(p_message_ids) x where x = any (coalesce(r.message_ids, '{}')))) then
      return jsonb_build_object('result', 'invalid_transition', 'version', r.version, 'state', r.state);
    end if;
    select coalesce(array_agg(x order by o), '{}') into v_rem
      from unnest(coalesce(r.deferred_message_ids, '{}')) with ordinality t(x, o) where not (x = any (p_message_ids));
    if r.state in ('collecting', 'failed', 'cancelled', 'expired') then
      select coalesce(array_agg(x order by o), '{}') into v_ids
        from unnest(coalesce(r.message_ids, '{}')) with ordinality t(x, o) where not (x = any (p_message_ids));
    else
      v_ids := r.message_ids;
    end if;
    -- dispensadas entram na janela de processadas (não voltam se o coletor as reapresentar)
    select coalesce(array_agg(x order by o), '{}') into v_obs
      from unnest(p_message_ids) with ordinality t(x, o) where not (x = any (r.processed_message_ids));
    if cardinality(v_rem) = cardinality(coalesce(r.deferred_message_ids, '{}')) and cardinality(coalesce(v_ids, '{}')) = cardinality(coalesce(r.message_ids, '{}'))
       and cardinality(v_obs) = 0 then
      return jsonb_build_object('result', 'noop', 'version', r.version, 'state', r.state);
    end if;
    v_obs := r.processed_message_ids || v_obs;
    update public.guest_ai_conversation_leases
       set message_ids = v_ids, deferred_message_ids = v_rem,
           processed_message_ids = v_obs[greatest(cardinality(v_obs) - 199, 1):cardinality(v_obs)],
           version = r.version + 1, updated_at = now()
     where conversation_id = p_conversation_id returning * into r;
    return jsonb_build_object('result', 'applied', 'version', r.version, 'state', r.state);
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
    -- o lote concluído entra na janela de processadas (as 200 mais recentes)
    v_obs := r.processed_message_ids || r.message_ids;
    update public.guest_ai_conversation_leases
       set state = 'completed', owner_token = null, lease_expires_at = null,
           processed_message_ids = v_obs[greatest(cardinality(v_obs) - 199, 1):cardinality(v_obs)],
           version = r.version + 1, updated_at = now()
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

-- ═════════════════ 2/3 · supabase/migrations/20261104120000_guest_ai_shadow.sql ═════════════════
-- ConciergeIA Guest AI · Gate B3.3 (Entrega 2) — Shadow Mode: controle global, orçamento,
-- telemetria estruturada e auditoria de acesso. Migration LOCAL (autorizada em 04/11/2026 só como
-- arquivo); NÃO aplicar em produção sem autorização específica (Entrega 4).
--
-- Princípios (espelho de `src/lib/guest-ai/shadow-exec/contracts.ts`; o teste `b33-contracts` confere
-- que cada vocabulário daqui é IGUAL ao do TypeScript):
--  * Nenhuma coluna de texto livre: toda coluna `text` tem CHECK de vocabulário fechado ou de formato
--    (UUID, versão, SHA-256, fuso IANA). Arrays validam cada elemento. Nenhum `jsonb` em tabela.
--  * Nenhum prompt, resposta, pergunta, mensagem, contexto, histórico, justificativa ou erro livre.
--  * RLS ligada sem política; todos os privilégios revogados; escrita SÓ pelas funções abaixo
--    (SECURITY DEFINER, `search_path = pg_catalog, pg_temp`; EXECUTE de service_role SÓ nas RPCs do worker;
--    as administrativas só para o dono das funções — ver "Entrega 4 · escopo global").
--  * Estado global inicial `disabled`; nenhum imóvel ativo; nenhuma autorização de retenção; só o
--    teto diário APROVADO (US$ 1,00) vem preenchido — todos os demais limites nascem nulos e
--    impedem `ready`/`running` até serem configurados e válidos.
--  * Transições manuais exigem CAS de `state_version`, autor e motivo; transições automáticas só levam
--    a estados de falha, e nenhum estado de falha sai automaticamente.
--  * Orçamento diário transacional (linha do dia travada); reserva órfã nunca é liberada.
--  * Tabela extra em relação ao desenho: `guest_ai_shadow_budget_reservations` — sem ela a liquidação
--    teria de confiar no valor reservado informado pelo cliente; com ela o banco sabe o que liberar.
--
-- Entrega 4 (preparação, 04/11/2026; achados da auditoria de produção, ainda não aplicada):
--  * Guarda de reexecução: se qualquer objeto Shadow já existir, aborta ANTES de tocar em qualquer coisa
--    (a transação inteira é desfeita; nenhum objeto existente é sobrescrito).
--  * A produção concede SEQUÊNCIAS novas do schema public a anon/authenticated/service_role por DEFAULT
--    PRIVILEGES: as identidades das tabelas Shadow têm os privilégios revogados explicitamente.
--
-- Entrega 4 · escopo GLOBAL (diretriz complementar de 04/11/2026; ainda não aplicada):
--  * O MANIFESTO (lista fechada e versionada de imóveis) foi REMOVIDO: não existe mais lista nem teto de
--    imóveis. Quem decide se um imóvel participa é `guest_ai_shadow_property_gate` (escopo global +
--    elegibilidade técnica + interruptores por tenant e por imóvel), definida pela migration
--    `20261105120000_guest_ai_shadow_global.sql`. AQUI ela nasce FECHADA (devolve `scope_off` para
--    qualquer imóvel): sem a migration global, nenhuma reivindicação passa.
--  * RPCs administrativas (configurar, autorizar retenção, transicionar, relatório, expurgo) só para o
--    DONO das funções: service_role (a chave do servidor da aplicação) não as executa.
--  * Nenhuma FK para `properties`: nada aqui bloqueia a exclusão de imóveis pela Capacidade B.
--
-- Entrega 3.1 (corretiva, 04/11/2026):
--  * F-07: trava GLOBAL de tick (token de cerca + prazo do banco) — um único worker ativo; nenhuma
--    execução começa sem tempo de tick suficiente para terminar (15 s).
--  * F-01/F-05: `guest_ai_shadow_inflight` + `shadow_claim_execution` (reivindica E inicia numa transação,
--    só a partir de `ready`, nunca recupera lote vencido) + `shadow_reconcile` (assume lote de worker
--    perdido: SELA o lote — nunca o reprocessa —, liquida a reserva órfã pelo pior caso e registra a falha).
--  * F-02/F-11/F-12: `shadow_finalize_execution` — liquidação + fechamento do lease (com cerca de versão e
--    token) + registro + disjuntores numa ÚNICA transação idempotente por execução.
--  * F-03: janela e ordem do disjuntor pelo relógio do BANCO (`recorded_at`).
--  * F-04: reserva idempotente; liquidação só por função interna auditável (`settlement_kind`).
--  * Parâmetros aprovados como TETOS (não como ativação): custo por turno ≤ US$ 0,15; ≤ 3 conversas por tick;
--    tick de 60 s; amostra mínima 20; dia de orçamento em UTC; teto diário ≤ US$ 1,00.
--  * Decisão A1 (ratificada): ao atingir o teto diário a reserva é RECUSADA (`exceeded`; o worker registra
--    `budget_blocked`) SEM desarmar — o estado (running/ready) é preservado e a cota renova sozinha à 0h UTC
--    (a chave do dia é `now() at time zone 'UTC'`). Só anomalia grave desarma: uso real acima do reservado
--    (`over_reservation` ⇒ `budget_exhausted` / `token_limit_violation`). Não existe motivo de desarme por cota.

-- ───────────────────────── Guarda de reexecução (E4) ─────────────────────────
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname like 'guest\_ai\_shadow\_%')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and (p.proname like 'shadow\_%' or p.proname like 'guest\_ai\_shadow\_%')) then
    raise exception 'guest_ai_shadow: objetos já existem; migration não reaplicada (conferir com o script de validação)'
      using errcode = 'P0001';
  end if;
  if to_regclass('public.guest_ai_conversation_leases') is null or to_regclass('public.properties') is null then
    raise exception 'guest_ai_shadow: pré-requisito ausente (lease B3.1 ou properties)' using errcode = 'P0001';
  end if;
end $$;

-- ───────────────────────── Controle global (linha única) ─────────────────────────
create table public.guest_ai_shadow_control (
  id                          smallint primary key default 1,
  state                       text not null default 'disabled',
  state_version               integer not null default 1,
  model_id                    text,
  reasoning_effort            text,
  max_input_tokens            integer,
  max_output_tokens           integer,
  max_total_tokens            integer,
  max_turn_cost_usd           numeric(14, 8),
  daily_cost_limit_usd        numeric(14, 8),
  max_daily_tokens            bigint,
  max_daily_calls             integer,
  error_window_minutes        integer,
  error_min_sample            integer,
  budget_day_timezone         text,
  telemetry_retention_days    integer,
  tick_interval_seconds       integer,
  max_conversations_per_tick  integer,
  retention_scope             text,
  retention_authorized_at     timestamptz,
  retention_authorized_by     uuid,
  retention_evidence_sha256   text,
  changed_at                  timestamptz not null default now(),
  changed_by                  uuid,
  reason_code                 text not null default 'initial',
  -- F-07: trava global do tick (token gerado pelo banco; prazo pelo relógio do banco)
  tick_owner_token            text,
  tick_expires_at             timestamptz,

  constraint gasc_singleton_ck check (id = 1),
  constraint gasc_state_ck check (state in ('disabled', 'ready', 'running', 'paused', 'circuit_open', 'budget_exhausted', 'integrity_violation', 'technical_failure')),
  constraint gasc_version_ck check (state_version >= 1),
  constraint gasc_model_ck check (model_id is null or model_id in ('openai/gpt-6-astra', 'openai/gpt-5.6-sol')),
  constraint gasc_effort_ck check (reasoning_effort is null or reasoning_effort in ('none', 'low', 'medium', 'high')),
  constraint gasc_input_ck check (max_input_tokens is null or max_input_tokens > 0),
  constraint gasc_output_ck check (max_output_tokens is null or (max_output_tokens > 0 and max_output_tokens <= 4096)),
  constraint gasc_total_ck check (max_total_tokens is null or max_total_tokens > 0),
  constraint gasc_turn_cost_ck check (max_turn_cost_usd is null or (max_turn_cost_usd > 0 and max_turn_cost_usd <= 0.15)),
  constraint gasc_daily_cost_ck check (daily_cost_limit_usd is null or (daily_cost_limit_usd > 0 and daily_cost_limit_usd <= 1.00)),
  constraint gasc_daily_tokens_ck check (max_daily_tokens is null or max_daily_tokens > 0),
  constraint gasc_daily_calls_ck check (max_daily_calls is null or max_daily_calls > 0),
  constraint gasc_window_ck check (error_window_minutes is null or error_window_minutes > 0),
  constraint gasc_sample_ck check (error_min_sample is null or error_min_sample = 20),
  constraint gasc_tz_ck check (budget_day_timezone is null or budget_day_timezone = 'UTC'),
  constraint gasc_retention_days_ck check (telemetry_retention_days is null or telemetry_retention_days > 0),
  constraint gasc_tick_ck check (tick_interval_seconds is null or tick_interval_seconds = 60),
  constraint gasc_per_tick_ck check (max_conversations_per_tick is null or max_conversations_per_tick between 1 and 3),
  constraint gasc_tick_owner_ck check ((tick_owner_token is null) = (tick_expires_at is null) and (tick_owner_token is null or tick_owner_token ~ '^[0-9a-f]{64}$')),
  constraint gasc_retention_scope_ck check (retention_scope is null or retention_scope in ('openai_responses')),
  constraint gasc_retention_ck check (
    (retention_scope is null and retention_authorized_at is null and retention_authorized_by is null and retention_evidence_sha256 is null)
    or (retention_scope is not null and retention_authorized_at is not null and retention_authorized_by is not null and retention_evidence_sha256 is not null)
  ),
  constraint gasc_evidence_ck check (retention_evidence_sha256 is null or retention_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint gasc_reason_ck check (reason_code in ('initial', 'authorized_activation', 'authorized_pause', 'authorized_resume', 'authorized_disable', 'authorized_recovery', 'error_rate_exceeded', 'consecutive_failures', 'token_limit_violation', 'integrity_divergence', 'measurement_unavailable', 'telemetry_failure', 'config_invalid'))
);

-- Estado inicial: desligado; só o teto diário aprovado (US$ 1,00). Nenhum outro limite ou retenção.
insert into public.guest_ai_shadow_control (id, state, daily_cost_limit_usd) values (1, 'disabled', 1.00);

-- ───────────────────────── Histórico imutável de transições ─────────────────────────
create table public.guest_ai_shadow_transitions (
  id              bigint generated always as identity primary key,
  from_state      text not null,
  to_state        text not null,
  state_version   integer not null,
  actor           uuid,
  automatic       boolean not null,
  reason_code     text not null,
  evidence_sha256 text,
  at              timestamptz not null default now(),
  constraint gast_from_ck check (from_state in ('disabled', 'ready', 'running', 'paused', 'circuit_open', 'budget_exhausted', 'integrity_violation', 'technical_failure')),
  constraint gast_to_ck check (to_state in ('disabled', 'ready', 'running', 'paused', 'circuit_open', 'budget_exhausted', 'integrity_violation', 'technical_failure')),
  constraint gast_reason_ck check (reason_code in ('initial', 'authorized_activation', 'authorized_pause', 'authorized_resume', 'authorized_disable', 'authorized_recovery', 'error_rate_exceeded', 'consecutive_failures', 'token_limit_violation', 'integrity_divergence', 'measurement_unavailable', 'telemetry_failure', 'config_invalid')),
  constraint gast_evidence_ck check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  -- manual ⇒ autor obrigatório; automática ⇒ sem autor e só para estado de falha
  constraint gast_actor_ck check (
    (automatic = false and actor is not null)
    or (automatic = true and actor is null and to_state in ('circuit_open', 'budget_exhausted', 'integrity_violation', 'technical_failure'))
  )
);

-- ───────────────────────── Execuções (telemetria sem texto) ─────────────────────────
create table public.guest_ai_shadow_executions (
  execution_id               uuid primary key,
  tenant_id                  uuid not null,
  property_id                uuid not null,
  conversation_id            uuid not null,
  batch_id                   uuid unique,
  lease_version              integer,
  channel                    text not null,
  chain_version              text not null,
  shadow_version             text not null,
  composer_version           text,
  model_id                   text,
  started_at                 timestamptz not null,
  finished_at                timestamptz not null,
  total_ms                   integer not null,
  lease_ms                   integer not null,
  context_ms                 integer not null,
  gateway_ms                 integer not null,
  validation_ms              integer not null,
  timing_context             integer,
  timing_dossier             integer,
  timing_history             integer,
  timing_scope_check         integer,
  timing_stay_authorizations integer,
  timing_human_ownership     integer,
  timing_human_pause         integer,
  timing_sender_identity     integer,
  timing_guard               integer,
  timing_compose             integer,
  timing_model_output        integer,
  timing_parse               integer,
  timing_structural_validation integer,
  timing_semantic_validation integer,
  timing_final_decision      integer,
  input_tokens               integer not null,
  output_tokens              integer not null,
  reasoning_tokens           integer not null,
  total_tokens               integer not null,
  usage_source               text not null,
  cost_usd                   numeric(14, 8) not null,
  gateway_calls              smallint not null,
  estimated_input_tokens     integer,
  candidate_available        boolean not null,
  decision                   text not null,
  strategy                   text,
  intents                    text[] not null,
  intent_count               smallint not null,
  commitment_kinds           text[] not null,
  human_intervention_needed  boolean not null,
  handoff_urgency            text,
  pause_state                text not null,
  context_check              text not null,
  execution_state            text not null,
  response_discarded         boolean not null,
  timeout                    boolean not null,
  token_limit_violation      boolean not null,
  concurrency_detected       boolean not null,
  gateway_error              text,
  budget_exceeded            text,
  refusal_code               text,
  technical_code             text,
  block_code                 text,
  integrity_code             text,
  recorded_at                timestamptz not null default now(),
  -- denominador e numerador da taxa de erro (mesma regra de `breakers.ts`)
  evaluable                  boolean generated always as (decision not in ('human_pause_active', 'budget_blocked', 'blocked_not_authorized', 'aborted_by_shutdown')) stored,
  technical_error            boolean generated always as (decision = 'technical_failure') stored,

  constraint gase_channel_ck check (channel in ('airbnb', 'whatsapp', 'web')),
  constraint gase_versions_ck check (
    chain_version ~ '^[a-z0-9][a-z0-9.-]{0,47}$' and shadow_version ~ '^[a-z0-9][a-z0-9.-]{0,47}$'
    and (composer_version is null or composer_version ~ '^[a-z0-9][a-z0-9.-]{0,47}$')
  ),
  constraint gase_model_ck check (model_id is null or model_id in ('openai/gpt-6-astra', 'openai/gpt-5.6-sol')),
  constraint gase_times_ck check (finished_at >= started_at),
  constraint gase_ms_ck check (total_ms >= 0 and lease_ms >= 0 and context_ms >= 0 and gateway_ms >= 0 and validation_ms >= 0),
  constraint gase_timings_ck check (
    coalesce(timing_context, 0) >= 0 and coalesce(timing_dossier, 0) >= 0 and coalesce(timing_history, 0) >= 0 and coalesce(timing_scope_check, 0) >= 0
    and coalesce(timing_stay_authorizations, 0) >= 0 and coalesce(timing_human_ownership, 0) >= 0 and coalesce(timing_human_pause, 0) >= 0
    and coalesce(timing_sender_identity, 0) >= 0 and coalesce(timing_guard, 0) >= 0 and coalesce(timing_compose, 0) >= 0
    and coalesce(timing_model_output, 0) >= 0 and coalesce(timing_parse, 0) >= 0 and coalesce(timing_structural_validation, 0) >= 0
    and coalesce(timing_semantic_validation, 0) >= 0 and coalesce(timing_final_decision, 0) >= 0
  ),
  constraint gase_tokens_ck check (input_tokens >= 0 and output_tokens >= 0 and reasoning_tokens >= 0 and total_tokens >= 0 and (estimated_input_tokens is null or estimated_input_tokens >= 0)),
  constraint gase_usage_ck check (usage_source in ('provider', 'estimated', 'none')),
  constraint gase_cost_ck check (cost_usd >= 0),
  constraint gase_calls_ck check (gateway_calls between 0 and 2),
  constraint gase_decision_ck check (decision in ('answer_candidate', 'silence', 'human_intervention', 'human_pause_active', 'urgent_internal_alert', 'insufficient_context', 'operational_restriction', 'integrity_violation', 'technical_failure', 'budget_blocked', 'blocked_not_authorized', 'aborted_by_shutdown')),
  constraint gase_candidate_ck check (candidate_available = (decision = 'answer_candidate')),
  constraint gase_strategy_ck check (strategy is null or strategy in ('answer', 'clarify', 'guide', 'suggest_alternatives', 'handoff', 'answer_and_handoff', 'silence')),
  constraint gase_intents_ck check (
    intents <@ array['acknowledgment', 'informational_query', 'operational_request', 'problem_report', 'emergency', 'formal_change_request', 'arrival_confirmation', 'departure_confirmation', 'other']::text[]
    and array_position(intents, null) is null and cardinality(intents) = intent_count
  ),
  constraint gase_kinds_ck check (
    commitment_kinds <@ array['reservation_change', 'early_checkin', 'late_checkout', 'availability', 'service_or_benefit', 'credential_release', 'action_completed', 'resolution', 'team_relay', 'information_followup']::text[]
    and array_position(commitment_kinds, null) is null
  ),
  constraint gase_urgency_ck check (handoff_urgency is null or handoff_urgency in ('low', 'normal', 'high')),
  constraint gase_pause_ck check (pause_state in ('not_evaluated', 'active', 'inactive', 'indefinite', 'unknown')),
  constraint gase_context_ck check (context_check in ('not_run', 'ok', 'refused')),
  constraint gase_exec_state_ck check (execution_state in ('completed', 'blocked', 'failed', 'timed_out', 'aborted')),
  constraint gase_discarded_ck check (response_discarded = true),
  constraint gase_gateway_error_ck check (gateway_error is null or gateway_error in ('invalid_request', 'sensitive_content_blocked', 'config_missing', 'timeout', 'aborted', 'rate_limited', 'billing', 'auth', 'model_unavailable', 'bad_request', 'provider_unavailable', 'network', 'invalid_response', 'empty_response', 'truncated_response', 'content_filtered', 'internal_error')),
  constraint gase_budget_ck check (budget_exceeded is null or budget_exceeded in ('turn_input_tokens', 'turn_output_tokens', 'turn_total_tokens', 'turn_cost', 'daily_cost', 'daily_tokens', 'daily_calls')),
  constraint gase_refusal_ck check (refusal_code is null or refusal_code in (
    'turn_not_validated', 'trace_invalid', 'context_incomplete', 'tenant_unknown', 'property_tenant_mismatch', 'property_identity_mismatch',
    'conversation_identity_mismatch', 'reservation_conversation_mismatch', 'credentials_present', 'internal_audience', 'context_inconsistent',
    'credential_policy_inconsistent', 'ai_paused_by_team', 'human_ownership_inconsistent', 'batch_not_validated', 'batch_scope_mismatch',
    'batch_turn_mismatch', 'batch_history_mismatch', 'batch_contains_paused_messages', 'reply_during_pause', 'paused_decision_invalid',
    'dossier_out_of_scope', 'dossier_internal_audience', 'history_unavailable', 'history_scope_mismatch', 'guard_missing', 'guard_failed',
    'guard_ambiguous', 'guard_blocked', 'compose_unavailable', 'compose_over_budget', 'grounding_unverifiable', 'parse_not_text',
    'parse_empty_output', 'parse_output_too_large', 'parse_malformed_json', 'parse_truncated_json', 'parse_not_object',
    'parse_scope_field_forbidden', 'parse_unexpected_field', 'parse_missing_field', 'parse_mixed_version', 'parse_version_mismatch',
    'parse_invalid_strategy', 'parse_invalid_reply', 'parse_invalid_handoff', 'parse_invalid_case_relation', 'parse_invalid_credential_intent',
    'parse_invalid_list', 'parse_invalid_capability', 'parse_invalid_signals', 'parse_invalid_commitment_kinds', 'parse_invalid_promised_times',
    'structural_block', 'structural_validator_invalid', 'semantic_block', 'semantic_validator_invalid', 'final_inconsistent'
  )),
  constraint gase_technical_ck check (technical_code is null or technical_code in (
    'stage_timeout', 'stage_aborted', 'stage_failed', 'model_call_failed', 'validator_exception', 'gateway_error', 'shadow_timeout',
    'postprocess_failed', 'telemetry_failed', 'lease_integrity_failure', 'finalization_failed', 'measurement_unavailable', 'read_failed',
    'worker_lost'
  )),
  constraint gase_block_ck check (block_code is null or block_code in (
    'master_switch_off', 'not_released', 'state_not_running', 'state_unreadable', 'scope_off', 'property_ineligible', 'property_disabled', 'tenant_disabled',
    'retention_not_authorized', 'limits_missing', 'limits_invalid', 'model_not_allowed', 'generator_not_issued', 'budget_turn_exceeded',
    'budget_daily_exceeded', 'budget_reservation_failed', 'deadline_expired', 'pause_active', 'pause_indefinite', 'pause_unreadable',
    'ownership_indeterminate', 'ownership_unreadable', 'shutdown_requested'
  )),
  constraint gase_integrity_ck check (integrity_code is null or integrity_code in (
    'tenant_mismatch', 'property_unresolved', 'surface_mismatch', 'message_conversation_mismatch', 'candidate_tenant_mismatch',
    'candidate_property_mismatch', 'lease_conversation_mismatch', 'ownership_tenant_mismatch', 'ownership_property_mismatch',
    'ownership_identity_inconsistent', 'tenant_unknown', 'property_tenant_mismatch', 'property_identity_mismatch',
    'conversation_identity_mismatch', 'reservation_conversation_mismatch', 'dossier_out_of_scope', 'history_scope_mismatch',
    'batch_scope_mismatch', 'listing_other_tenant', 'listing_property_mismatch', 'twin_inconsistent', 'preference_other_tenant',
    'channel_other_tenant', 'cross_tenant', 'cross_property', 'cross_conversation', 'cross_channel'
  )),
  constraint gase_decision_codes_ck check (
    (decision <> 'integrity_violation' or integrity_code is not null)
    and (decision <> 'technical_failure' or technical_code is not null)
  )
);
-- F-03: a janela do disjuntor é medida pelo relógio do BANCO (`recorded_at`), nunca pelo do worker
create index guest_ai_shadow_executions_window_idx on public.guest_ai_shadow_executions (recorded_at desc) where evaluable;
create index guest_ai_shadow_executions_tenant_idx on public.guest_ai_shadow_executions (tenant_id, finished_at desc);

-- ───────────────────────── Orçamento diário e reservas ─────────────────────────
create table public.guest_ai_shadow_budget_days (
  budget_day       date primary key,
  reserved_cost    numeric(14, 8) not null default 0,
  settled_cost     numeric(14, 8) not null default 0,
  reserved_tokens  bigint not null default 0,
  settled_tokens   bigint not null default 0,
  reserved_calls   integer not null default 0,
  settled_calls    integer not null default 0,
  open_reservations integer not null default 0,
  constraint gasb_nonneg_ck check (reserved_cost >= 0 and settled_cost >= 0 and reserved_tokens >= 0 and settled_tokens >= 0 and reserved_calls >= 0 and settled_calls >= 0 and open_reservations >= 0)
);

create table public.guest_ai_shadow_budget_reservations (
  reservation_id  uuid primary key default gen_random_uuid(),
  execution_id    uuid not null unique,
  budget_day      date not null references public.guest_ai_shadow_budget_days(budget_day),
  tokens          bigint not null,
  cost_usd        numeric(14, 8) not null,
  calls           smallint not null,
  status          text not null default 'open',
  reserved_at     timestamptz not null default now(),
  settled_at      timestamptz,
  settled_tokens  bigint,
  settled_cost    numeric(14, 8),
  settled_calls   smallint,
  -- F-04: como a reserva foi encerrada — uso real informado pelo worker, ou PIOR CASO (órfã reconciliada)
  settlement_kind text,
  constraint gasr_amounts_ck check (tokens > 0 and cost_usd > 0 and calls between 1 and 2),
  constraint gasr_status_ck check (status in ('open', 'settled')),
  constraint gasr_kind_ck check (settlement_kind is null or settlement_kind in ('actual', 'orphan_worst_case')),
  constraint gasr_settle_ck check (
    (status = 'open' and settled_at is null and settled_tokens is null and settled_cost is null and settled_calls is null and settlement_kind is null)
    or (status = 'settled' and settled_at is not null and settled_tokens >= 0 and settled_cost >= 0 and settled_calls between 0 and 2 and settlement_kind is not null)
  )
);

-- ───────────────────────── Execuções em andamento (F-01/F-02) ─────────────────────────
-- Uma linha por execução que chegou a reivindicar o lote. Fecha por `shadow_finalize_execution` (worker)
-- ou por `shadow_reconcile` (worker perdido). No máximo UMA em andamento por conversa.
create table public.guest_ai_shadow_inflight (
  execution_id    uuid primary key,
  conversation_id uuid not null,
  tenant_id       uuid not null,
  property_id     uuid not null,
  channel         text not null,
  batch_id        uuid not null,
  lease_version   integer not null,
  started_at      timestamptz not null default now(),
  status          text not null default 'running',
  closed_at       timestamptz,
  constraint gasi_channel_ck check (channel in ('airbnb', 'whatsapp', 'web')),
  constraint gasi_status_ck check (status in ('running', 'finalized', 'reconciled')),
  constraint gasi_closed_ck check ((closed_at is null) = (status not in ('finalized', 'reconciled'))),
  constraint gasi_version_ck check (lease_version >= 1)
);
create unique index guest_ai_shadow_inflight_one_running_idx on public.guest_ai_shadow_inflight (conversation_id) where status = 'running';

-- ───────────────────────── Auditoria de acesso à telemetria ─────────────────────────
create table public.guest_ai_shadow_access_log (
  id         bigint generated always as identity primary key,
  actor      uuid not null,
  report     text not null,
  tenant_id  uuid not null,
  from_at    timestamptz not null,
  to_at      timestamptz not null,
  at         timestamptz not null default now(),
  constraint gasa_report_ck check (report in ('decision_summary', 'daily_cost')),
  constraint gasa_range_ck check (to_at > from_at)
);

-- ───────────────────────── Segurança das tabelas ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['guest_ai_shadow_control', 'guest_ai_shadow_transitions', 'guest_ai_shadow_executions',
                           'guest_ai_shadow_budget_days', 'guest_ai_shadow_budget_reservations', 'guest_ai_shadow_access_log',
                           'guest_ai_shadow_inflight'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on table public.%I from sandbox_exec', t);
    end if;
  end loop;
  -- E4: identidades (sequências) recebem DEFAULT PRIVILEGES de clientes na produção ⇒ revogação explícita
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'guest\_ai\_shadow\_%' loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated, service_role', t);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on sequence public.%I from sandbox_exec', t);
    end if;
  end loop;
end $$;

-- ───────────────────────── Funções internas (sem EXECUTE para ninguém) ─────────────────────────
-- Configuração completa para ready/running: devolve o primeiro problema, ou null.
create or replace function public.guest_ai_shadow_config_problem(c public.guest_ai_shadow_control)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if c.retention_scope is null or c.retention_authorized_at is null then return 'retention_not_authorized'; end if;
  if c.model_id is null then return 'model_not_allowed'; end if;
  if c.reasoning_effort is null or c.max_input_tokens is null or c.max_output_tokens is null or c.max_total_tokens is null
     or c.max_turn_cost_usd is null or c.daily_cost_limit_usd is null or c.max_daily_tokens is null or c.max_daily_calls is null
     or c.error_window_minutes is null or c.error_min_sample is null or c.budget_day_timezone is null
     or c.telemetry_retention_days is null or c.tick_interval_seconds is null or c.max_conversations_per_tick is null then
    return 'limits_missing';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = c.budget_day_timezone) then return 'limits_invalid'; end if;
  return null;
end;
$function$;

-- Veredito do disjuntor de erro técnico (mesma regra de `evaluateErrorBreaker`).
create or replace function public.guest_ai_shadow_error_verdict(p_window_minutes integer, p_min_sample integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_n integer;
  v_errors integer;
  v_last2 boolean[];
begin
  if p_window_minutes is null or p_window_minutes <= 0 or p_min_sample is null or p_min_sample < 2 then
    return jsonb_build_object('result', 'measurement_unavailable');
  end if;
  select count(*), count(*) filter (where technical_error) into v_n, v_errors
    from public.guest_ai_shadow_executions
   where evaluable and recorded_at > now() - make_interval(mins => p_window_minutes);
  if v_n >= p_min_sample then
    return jsonb_build_object('result', case when v_errors * 100 > v_n * 5 then 'error_rate_exceeded' else 'ok' end, 'n', v_n, 'errors', v_errors);
  end if;
  select array_agg(technical_error order by recorded_at desc, execution_id desc) into v_last2
    from (select technical_error, recorded_at, execution_id from public.guest_ai_shadow_executions
           where evaluable and recorded_at > now() - make_interval(mins => p_window_minutes)
           order by recorded_at desc, execution_id desc limit 2) s;
  return jsonb_build_object(
    'result', case when coalesce(cardinality(v_last2), 0) = 2 and v_last2[1] and v_last2[2] then 'consecutive_failures' else 'ok' end,
    'n', v_n, 'errors', v_errors);
end;
$function$;

-- Disparo automático interno (estado travado pelo chamador): só leva a estado de falha.
create or replace function public.guest_ai_shadow_trip_locked(r public.guest_ai_shadow_control, p_to text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if p_to not in ('circuit_open', 'budget_exhausted', 'integrity_violation', 'technical_failure') then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  -- integridade escala a partir de qualquer estado ativo ou de falha; as demais, só a partir de running
  if not (r.state = 'running' or (p_to = 'integrity_violation' and r.state in ('ready', 'paused', 'circuit_open', 'budget_exhausted', 'technical_failure'))) then
    return jsonb_build_object('result', 'noop', 'state', r.state, 'state_version', r.state_version);
  end if;
  update public.guest_ai_shadow_control
     set state = p_to, state_version = r.state_version + 1, changed_at = now(), changed_by = null, reason_code = p_reason
   where id = 1;
  insert into public.guest_ai_shadow_transitions (from_state, to_state, state_version, actor, automatic, reason_code)
  values (r.state, p_to, r.state_version + 1, null, true, p_reason);
  return jsonb_build_object('result', 'applied', 'state', p_to, 'state_version', r.state_version + 1);
end;
$function$;

-- ───────────────────────── RPCs (lista fechada; EXECUTE só service_role) ─────────────────────────

-- 1) Estado global + configuração (nunca o autor).
create or replace function public.shadow_get_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  select * into c from public.guest_ai_shadow_control where id = 1;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  return jsonb_build_object(
    'result', 'ok', 'state', c.state, 'state_version', c.state_version, 'model_id', c.model_id, 'reasoning_effort', c.reasoning_effort,
    'max_input_tokens', c.max_input_tokens, 'max_output_tokens', c.max_output_tokens, 'max_total_tokens', c.max_total_tokens,
    'max_turn_cost_usd', c.max_turn_cost_usd, 'daily_cost_limit_usd', c.daily_cost_limit_usd, 'max_daily_tokens', c.max_daily_tokens,
    'max_daily_calls', c.max_daily_calls, 'error_window_minutes', c.error_window_minutes, 'error_min_sample', c.error_min_sample,
    'budget_day_timezone', c.budget_day_timezone, 'telemetry_retention_days', c.telemetry_retention_days,
    'tick_interval_seconds', c.tick_interval_seconds, 'max_conversations_per_tick', c.max_conversations_per_tick,
    'retention_scope', c.retention_scope,
    'retention_authorized', c.retention_scope is not null and c.retention_authorized_at is not null,
    -- F-09/F-03: o instante do BANCO; o worker ancora nele todo instante de parede (pausa, coletor, registro)
    'db_now', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$function$;

-- 2) Porta de IMÓVEL (interna): devolve NULL se o imóvel pode participar, ou o motivo fechado do bloqueio.
--    FECHADA nesta migration (todo imóvel ⇒ `scope_off`); a migration de escopo global a redefine com a
--    regra real. Sem ela, nenhuma reivindicação passa (fail-closed).
create or replace function public.guest_ai_shadow_property_gate(p_tenant_id uuid, p_property_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
  select 'scope_off'::text;
$function$;

-- 4) Configuração (CAS; nunca em ready/running; valores validados pelas CHECK; fuso real).
create or replace function public.shadow_configure(
  p_expected_version integer, p_actor uuid,
  p_model_id text, p_reasoning_effort text, p_max_input_tokens integer, p_max_output_tokens integer, p_max_total_tokens integer,
  p_max_turn_cost_usd numeric, p_daily_cost_limit_usd numeric, p_max_daily_tokens bigint, p_max_daily_calls integer,
  p_error_window_minutes integer, p_error_min_sample integer, p_budget_day_timezone text, p_telemetry_retention_days integer,
  p_tick_interval_seconds integer, p_max_conversations_per_tick integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare r public.guest_ai_shadow_control%rowtype;
begin
  if p_expected_version is null or p_actor is null then return jsonb_build_object('result', 'invalid_argument'); end if;
  select * into r from public.guest_ai_shadow_control where id = 1 for update;
  if r.state_version <> p_expected_version then return jsonb_build_object('result', 'stale_version', 'state_version', r.state_version); end if;
  if r.state in ('ready', 'running') then return jsonb_build_object('result', 'invalid_transition', 'state', r.state); end if;
  if p_budget_day_timezone is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = p_budget_day_timezone) then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  begin
    update public.guest_ai_shadow_control set
      model_id = p_model_id, reasoning_effort = p_reasoning_effort, max_input_tokens = p_max_input_tokens, max_output_tokens = p_max_output_tokens,
      max_total_tokens = p_max_total_tokens, max_turn_cost_usd = p_max_turn_cost_usd, daily_cost_limit_usd = p_daily_cost_limit_usd,
      max_daily_tokens = p_max_daily_tokens, max_daily_calls = p_max_daily_calls, error_window_minutes = p_error_window_minutes,
      error_min_sample = p_error_min_sample, budget_day_timezone = p_budget_day_timezone, telemetry_retention_days = p_telemetry_retention_days,
      tick_interval_seconds = p_tick_interval_seconds, max_conversations_per_tick = p_max_conversations_per_tick,
      state_version = r.state_version + 1, changed_at = now(), changed_by = p_actor
     where id = 1;
  exception when check_violation then
    return jsonb_build_object('result', 'invalid_argument');
  end;
  return jsonb_build_object('result', 'applied', 'state_version', r.state_version + 1);
end;
$function$;

-- 5) Autorização (ou revogação, com escopo nulo) de retenção — independente do modelo.
create or replace function public.shadow_authorize_retention(p_expected_version integer, p_actor uuid, p_scope text, p_evidence_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare r public.guest_ai_shadow_control%rowtype;
begin
  if p_expected_version is null or p_actor is null or (p_scope is null) <> (p_evidence_sha256 is null) then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  select * into r from public.guest_ai_shadow_control where id = 1 for update;
  if r.state_version <> p_expected_version then return jsonb_build_object('result', 'stale_version', 'state_version', r.state_version); end if;
  -- conceder só fora de ready/running; revogar é sempre permitido e, em ready/running, desliga
  if p_scope is not null and r.state in ('ready', 'running') then return jsonb_build_object('result', 'invalid_transition', 'state', r.state); end if;
  begin
    update public.guest_ai_shadow_control set
      retention_scope = p_scope,
      retention_authorized_at = case when p_scope is null then null else now() end,
      retention_authorized_by = case when p_scope is null then null else p_actor end,
      retention_evidence_sha256 = p_evidence_sha256,
      state = case when p_scope is null and r.state in ('ready', 'running') then 'disabled' else r.state end,
      reason_code = case when p_scope is null and r.state in ('ready', 'running') then 'authorized_disable' else r.reason_code end,
      state_version = r.state_version + 1, changed_at = now(), changed_by = p_actor
     where id = 1;
  exception when check_violation then
    return jsonb_build_object('result', 'invalid_argument');
  end;
  if p_scope is null and r.state in ('ready', 'running') then
    insert into public.guest_ai_shadow_transitions (from_state, to_state, state_version, actor, automatic, reason_code)
    values (r.state, 'disabled', r.state_version + 1, p_actor, false, 'authorized_disable');
  end if;
  return jsonb_build_object('result', 'applied', 'state_version', r.state_version + 1);
end;
$function$;

-- 6) Transição AUTORIZADA (CAS, autor, motivo; matriz fechada; ready/running exigem configuração completa).
create or replace function public.shadow_transition(p_expected_version integer, p_to text, p_actor uuid, p_reason text, p_evidence_sha256 text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  r public.guest_ai_shadow_control%rowtype;
  v_problem text;
  v_ok boolean;
begin
  if p_expected_version is null or p_to is null or p_actor is null or p_reason is null
     or p_reason not in ('authorized_activation', 'authorized_pause', 'authorized_resume', 'authorized_disable', 'authorized_recovery')
     or (p_evidence_sha256 is not null and p_evidence_sha256 !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  select * into r from public.guest_ai_shadow_control where id = 1 for update;
  if r.state_version <> p_expected_version then return jsonb_build_object('result', 'stale_version', 'state_version', r.state_version); end if;
  v_ok := case
    when p_to = 'disabled' then r.state <> 'disabled' and p_reason = 'authorized_disable'
    when p_to = 'ready' then (r.state = 'disabled' and p_reason = 'authorized_activation')
                          or (r.state in ('circuit_open', 'technical_failure', 'budget_exhausted') and p_reason = 'authorized_recovery' and p_evidence_sha256 is not null)
    when p_to = 'running' then (r.state = 'ready' and p_reason = 'authorized_activation') or (r.state = 'paused' and p_reason = 'authorized_resume')
    when p_to = 'paused' then r.state = 'running' and p_reason = 'authorized_pause'
    else false
  end;
  -- integridade: só sai para disabled, e com referência da correção
  if r.state = 'integrity_violation' and (p_to <> 'disabled' or p_evidence_sha256 is null) then v_ok := false; end if;
  if not v_ok then return jsonb_build_object('result', 'invalid_transition', 'state', r.state); end if;
  if p_to in ('ready', 'running') then
    v_problem := public.guest_ai_shadow_config_problem(r);
    if v_problem is not null then return jsonb_build_object('result', 'config_incomplete', 'problem', v_problem); end if;
  end if;
  update public.guest_ai_shadow_control
     set state = p_to, state_version = r.state_version + 1, changed_at = now(), changed_by = p_actor, reason_code = p_reason
   where id = 1;
  insert into public.guest_ai_shadow_transitions (from_state, to_state, state_version, actor, automatic, reason_code, evidence_sha256)
  values (r.state, p_to, r.state_version + 1, p_actor, false, p_reason, p_evidence_sha256);
  return jsonb_build_object('result', 'applied', 'state', p_to, 'state_version', r.state_version + 1);
end;
$function$;

-- 7) Disparo AUTOMÁTICO de disjuntor (sem autor; só estados de falha; nunca sai de falha).
create or replace function public.shadow_trip(p_to text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare r public.guest_ai_shadow_control%rowtype;
begin
  if p_to is null or p_reason is null
     or p_reason not in ('error_rate_exceeded', 'consecutive_failures', 'token_limit_violation', 'integrity_divergence', 'measurement_unavailable', 'telemetry_failure', 'config_invalid') then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  select * into r from public.guest_ai_shadow_control where id = 1 for update;
  return public.guest_ai_shadow_trip_locked(r, p_to, p_reason);
end;
$function$;

-- 8) Reserva ATÔMICA de orçamento (pior caso), só para uma execução EM ANDAMENTO (reivindicada pelo
--    `shadow_claim_execution`), com estado running e configuração completa. Idempotente por execução
--    (F-11): repetir a chamada depois de uma resposta perdida devolve a MESMA reserva, sem contar duas vezes.
create or replace function public.shadow_reserve_budget(p_execution_id uuid, p_tokens bigint, p_cost numeric, p_calls integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  d public.guest_ai_shadow_budget_days%rowtype;
  ex public.guest_ai_shadow_budget_reservations%rowtype;
  v_day date;
  v_res uuid;
  v_problem text;
  v_limit text;
begin
  if p_execution_id is null or p_tokens is null or p_tokens <= 0 or p_cost is null or p_cost <= 0 or p_cost <> round(p_cost, 8)
     or p_calls is null or p_calls < 1 or p_calls > 2 then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  -- trava o controle (serializa reservas com transições, disparos, finalizações e reconciliações)
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  -- repetição idempotente: a reserva já confirmada é devolvida tal como está (nunca uma segunda)
  select * into ex from public.guest_ai_shadow_budget_reservations where execution_id = p_execution_id;
  if found then
    if ex.status = 'open' and ex.tokens = p_tokens and ex.cost_usd = p_cost and ex.calls = p_calls then
      return jsonb_build_object('result', 'reserved', 'reservation_id', ex.reservation_id, 'budget_day', ex.budget_day, 'repeated', true);
    end if;
    return jsonb_build_object('result', 'duplicate');
  end if;
  if not exists (select 1 from public.guest_ai_shadow_inflight where execution_id = p_execution_id and status = 'running') then
    return jsonb_build_object('result', 'not_claimed');
  end if;
  if c.state <> 'running' then return jsonb_build_object('result', 'state_not_running', 'state', c.state); end if;
  v_problem := public.guest_ai_shadow_config_problem(c);
  if v_problem is not null then return jsonb_build_object('result', 'config_incomplete', 'problem', v_problem); end if;
  -- limites por turno (pior caso informado pelo chamador)
  if p_cost > c.max_turn_cost_usd then return jsonb_build_object('result', 'exceeded', 'limit', 'turn_cost'); end if;
  if p_tokens > c.max_total_tokens::bigint * p_calls then return jsonb_build_object('result', 'exceeded', 'limit', 'turn_total_tokens'); end if;
  -- dia de orçamento em UTC (CHECK `gasc_tz_ck`): `timestamptz at time zone 'UTC'` independe do fuso da sessão
  v_day := (now() at time zone c.budget_day_timezone)::date;
  insert into public.guest_ai_shadow_budget_days (budget_day) values (v_day) on conflict (budget_day) do nothing;
  -- controle (acima) e dia travados: reservas concorrentes são serializadas e nunca somam além do teto
  select * into d from public.guest_ai_shadow_budget_days where budget_day = v_day for update;
  v_limit := case
    when d.settled_cost + d.reserved_cost + p_cost > c.daily_cost_limit_usd then 'daily_cost'
    when d.settled_tokens + d.reserved_tokens + p_tokens > c.max_daily_tokens then 'daily_tokens'
    when d.settled_calls + d.reserved_calls + p_calls > c.max_daily_calls then 'daily_calls'
    else null end;
  if v_limit is not null then
    -- A1: cota diária esgotada é controle NORMAL de orçamento — recusa a reserva e NÃO desarma (o estado
    -- running/ready fica como está; o worker registra o turno como `budget_blocked`; a cota volta à 0h UTC)
    return jsonb_build_object('result', 'exceeded', 'limit', v_limit);
  end if;
  insert into public.guest_ai_shadow_budget_reservations (execution_id, budget_day, tokens, cost_usd, calls)
  values (p_execution_id, v_day, p_tokens, p_cost, p_calls) returning reservation_id into v_res;
  update public.guest_ai_shadow_budget_days
     set reserved_cost = reserved_cost + p_cost, reserved_tokens = reserved_tokens + p_tokens, reserved_calls = reserved_calls + p_calls,
         open_reservations = open_reservations + 1
   where budget_day = v_day;
  return jsonb_build_object('result', 'reserved', 'reservation_id', v_res, 'budget_day', v_day);
end;
$function$;

-- 9) Liquidação INTERNA (controle já travado pelo chamador; sem EXECUTE para ninguém): troca a reserva
--    aberta da execução pelo uso informado — real (`actual`) ou o PIOR CASO reservado (`orphan_worst_case`).
--    Uma vez só (a linha da reserva é travada). Devolve o desfecho para os disjuntores do chamador.
create or replace function public.guest_ai_shadow_settle_locked(c public.guest_ai_shadow_control, p_execution_id uuid, p_kind text, p_tokens bigint, p_cost numeric, p_calls integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  res public.guest_ai_shadow_budget_reservations%rowtype;
  d public.guest_ai_shadow_budget_days%rowtype;
  v_tokens bigint;
  v_cost numeric;
  v_calls integer;
begin
  select * into res from public.guest_ai_shadow_budget_reservations where execution_id = p_execution_id for update;
  if not found then return jsonb_build_object('result', 'no_reservation'); end if;
  if res.status = 'settled' then return jsonb_build_object('result', 'already_settled'); end if;
  if p_kind = 'orphan_worst_case' then
    v_tokens := res.tokens; v_cost := res.cost_usd; v_calls := res.calls;
  else
    v_tokens := p_tokens; v_cost := p_cost; v_calls := p_calls;
  end if;
  update public.guest_ai_shadow_budget_reservations
     set status = 'settled', settled_at = now(), settled_tokens = v_tokens, settled_cost = v_cost, settled_calls = v_calls, settlement_kind = p_kind
   where reservation_id = res.reservation_id;
  update public.guest_ai_shadow_budget_days
     set reserved_cost = reserved_cost - res.cost_usd, reserved_tokens = reserved_tokens - res.tokens, reserved_calls = reserved_calls - res.calls,
         settled_cost = settled_cost + v_cost, settled_tokens = settled_tokens + v_tokens, settled_calls = settled_calls + v_calls,
         open_reservations = open_reservations - 1
   where budget_day = res.budget_day
   returning * into d;
  return jsonb_build_object(
    'result', 'settled',
    -- uso real ACIMA do reservado: o limite estrito falhou ⇒ violação (o chamador desarma o Shadow)
    'over_reservation', v_cost > res.cost_usd or v_tokens > res.tokens or v_calls > res.calls,
    'day_exhausted', c.daily_cost_limit_usd is null or d.settled_cost + d.reserved_cost >= c.daily_cost_limit_usd
       or (c.max_daily_tokens is not null and d.settled_tokens + d.reserved_tokens >= c.max_daily_tokens)
       or (c.max_daily_calls is not null and d.settled_calls + d.reserved_calls >= c.max_daily_calls));
end;
$function$;

-- 10) Avaliação dos disjuntores (leitura; falha de medição ⇒ o chamador bloqueia).
create or replace function public.shadow_evaluate_breakers()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  select * into c from public.guest_ai_shadow_control where id = 1;
  return public.guest_ai_shadow_error_verdict(c.error_window_minutes, c.error_min_sample);
end;
$function$;

-- Inserção INTERNA de um registro de execução: chaves EXATAS, valores pelas CHECK da tabela.
create or replace function public.guest_ai_shadow_insert_execution(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_keys text[];
  v_expected constant text[] := array[
    'batch_id', 'budget_exceeded', 'candidate_available', 'chain_version', 'channel', 'commitment_kinds', 'composer_version', 'concurrency_detected',
    'context_check', 'context_ms', 'conversation_id', 'cost_usd', 'decision', 'estimated_input_tokens', 'execution_id', 'execution_state',
    'finished_at', 'gateway_calls', 'gateway_error', 'gateway_ms', 'handoff_urgency', 'human_intervention_needed', 'input_tokens',
    'integrity_code', 'intent_count', 'intents', 'lease_ms', 'lease_version', 'model_id', 'output_tokens', 'pause_state', 'property_id',
    'reasoning_tokens', 'refusal_code', 'response_discarded', 'shadow_version', 'started_at', 'strategy', 'technical_code', 'block_code',
    'tenant_id', 'timeout', 'timing_compose', 'timing_context', 'timing_dossier', 'timing_final_decision', 'timing_guard', 'timing_history',
    'timing_human_ownership', 'timing_human_pause', 'timing_model_output', 'timing_parse', 'timing_scope_check', 'timing_semantic_validation',
    'timing_sender_identity', 'timing_stay_authorizations', 'timing_structural_validation', 'token_limit_violation', 'total_ms', 'total_tokens',
    'usage_source', 'validation_ms'];
  v_decision text;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then return jsonb_build_object('result', 'invalid_argument'); end if;
  select array_agg(k order by k) into v_keys from jsonb_object_keys(p_record) k;
  if v_keys is distinct from (select array_agg(k order by k) from unnest(v_expected) k) then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  -- valores escalares: nenhum objeto aninhado; arrays só nas duas colunas de vocabulário
  if exists (select 1 from jsonb_each(p_record) e
              where jsonb_typeof(e.value) = 'object'
                 or (jsonb_typeof(e.value) = 'array' and e.key not in ('intents', 'commitment_kinds'))
                 or (e.key in ('intents', 'commitment_kinds') and jsonb_typeof(e.value) <> 'array')) then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  begin
    insert into public.guest_ai_shadow_executions (
      execution_id, tenant_id, property_id, conversation_id, batch_id, lease_version, channel, chain_version, shadow_version, composer_version,
      model_id, started_at, finished_at, total_ms, lease_ms, context_ms, gateway_ms, validation_ms, timing_context, timing_dossier, timing_history,
      timing_scope_check, timing_stay_authorizations, timing_human_ownership, timing_human_pause, timing_sender_identity, timing_guard,
      timing_compose, timing_model_output, timing_parse, timing_structural_validation, timing_semantic_validation, timing_final_decision,
      input_tokens, output_tokens, reasoning_tokens, total_tokens, usage_source, cost_usd, gateway_calls, estimated_input_tokens,
      candidate_available, decision, strategy, intents, intent_count, commitment_kinds, human_intervention_needed, handoff_urgency,
      pause_state, context_check, execution_state, response_discarded, timeout, token_limit_violation, concurrency_detected, gateway_error,
      budget_exceeded, refusal_code, technical_code, block_code, integrity_code)
    select
      r.execution_id, r.tenant_id, r.property_id, r.conversation_id, r.batch_id, r.lease_version, r.channel, r.chain_version, r.shadow_version, r.composer_version,
      r.model_id, r.started_at, r.finished_at, r.total_ms, r.lease_ms, r.context_ms, r.gateway_ms, r.validation_ms, r.timing_context, r.timing_dossier, r.timing_history,
      r.timing_scope_check, r.timing_stay_authorizations, r.timing_human_ownership, r.timing_human_pause, r.timing_sender_identity, r.timing_guard,
      r.timing_compose, r.timing_model_output, r.timing_parse, r.timing_structural_validation, r.timing_semantic_validation, r.timing_final_decision,
      r.input_tokens, r.output_tokens, r.reasoning_tokens, r.total_tokens, r.usage_source, r.cost_usd, r.gateway_calls, r.estimated_input_tokens,
      r.candidate_available, r.decision, r.strategy, r.intents, r.intent_count, r.commitment_kinds, r.human_intervention_needed, r.handoff_urgency,
      r.pause_state, r.context_check, r.execution_state, r.response_discarded, r.timeout, r.token_limit_violation, r.concurrency_detected, r.gateway_error,
      r.budget_exceeded, r.refusal_code, r.technical_code, r.block_code, r.integrity_code
    from jsonb_populate_record(null::public.guest_ai_shadow_executions, p_record) r
    returning decision into v_decision;
  exception
    when unique_violation then return jsonb_build_object('result', 'duplicate');
    when check_violation or not_null_violation or invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range
         or invalid_datetime_format or invalid_parameter_value then
      return jsonb_build_object('result', 'invalid_argument');
  end;
  return jsonb_build_object('result', 'inserted', 'decision', v_decision);
end;
$function$;

-- Disjuntores depois de um registro (controle travado pelo chamador): integridade, taxa, consecutivas.
create or replace function public.guest_ai_shadow_breakers_locked(c public.guest_ai_shadow_control, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_verdict jsonb;
  v_trip jsonb := null;
begin
  if p_decision = 'integrity_violation' then
    v_trip := public.guest_ai_shadow_trip_locked(c, 'integrity_violation', 'integrity_divergence');
    return jsonb_build_object('breaker', 'integrity_violation', 'trip', v_trip->>'result');
  end if;
  v_verdict := public.guest_ai_shadow_error_verdict(c.error_window_minutes, c.error_min_sample);
  if v_verdict->>'result' = 'error_rate_exceeded' then
    v_trip := public.guest_ai_shadow_trip_locked(c, 'circuit_open', 'error_rate_exceeded');
  elsif v_verdict->>'result' = 'consecutive_failures' then
    v_trip := public.guest_ai_shadow_trip_locked(c, 'circuit_open', 'consecutive_failures');
  elsif v_verdict->>'result' = 'measurement_unavailable' then
    v_trip := public.guest_ai_shadow_trip_locked(c, 'technical_failure', 'measurement_unavailable');
  end if;
  return jsonb_build_object('breaker', v_verdict->>'result', 'n', v_verdict->'n', 'errors', v_verdict->'errors', 'trip', v_trip->>'result');
end;
$function$;

-- 11) Registro de execução SEM lote (desfechos anteriores à reivindicação: imóvel não ativo, pausa,
--     integridade, leitura). Execução com lote só fecha por `shadow_finalize_execution` (mesma transação
--     do lease e da liquidação). Mesma transação avalia os disjuntores.
create or replace function public.shadow_record_execution(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  v_ins jsonb;
  v_br jsonb;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' or jsonb_typeof(p_record->'batch_id') is distinct from 'null' then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  v_ins := public.guest_ai_shadow_insert_execution(p_record);
  if v_ins->>'result' <> 'inserted' then return v_ins; end if;
  v_br := public.guest_ai_shadow_breakers_locked(c, v_ins->>'decision');
  return jsonb_build_object('result', 'recorded') || v_br;
end;
$function$;

-- ───────────────────────── Tick único, reivindicação, finalização e reconciliação (E3.1) ─────────────────────────

-- 14) Trava GLOBAL do tick (F-07): um único worker ativo. O prazo cobre o tick inteiro
--     (conversas × 15 s + 10 s) pelo relógio do banco; trava vencida pode ser assumida.
create or replace function public.shadow_acquire_tick()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  v_token text;
  v_problem text;
begin
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if c.state <> 'running' then return jsonb_build_object('result', 'state_not_running', 'state', c.state); end if;
  v_problem := public.guest_ai_shadow_config_problem(c);
  if v_problem is not null then return jsonb_build_object('result', 'config_incomplete', 'problem', v_problem); end if;
  if c.tick_owner_token is not null and c.tick_expires_at > now() then
    return jsonb_build_object('result', 'busy');
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.guest_ai_shadow_control
     set tick_owner_token = v_token, tick_expires_at = now() + make_interval(secs => c.max_conversations_per_tick * 15 + 10)
   where id = 1
   returning * into c;
  return jsonb_build_object('result', 'acquired', 'tick_token', v_token,
    'tick_expires_at', to_char(c.tick_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'db_now', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$function$;

-- 15) Libera a trava do tick (só o dono; idempotente).
create or replace function public.shadow_release_tick(p_tick_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if p_tick_token is null or p_tick_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('result', 'invalid_argument'); end if;
  update public.guest_ai_shadow_control set tick_owner_token = null, tick_expires_at = null
   where id = 1 and tick_owner_token = p_tick_token;
  return jsonb_build_object('result', case when found then 'released' else 'noop' end);
end;
$function$;

-- 16) Reivindica E inicia o lote numa transação (F-01/F-05): só a partir de `ready` (NUNCA recupera um
--     lote vencido — esse é selado pela reconciliação), só com a trava do tick e tempo de tick para a
--     execução inteira (15 s), só para imóvel ATIVO (`guest_ai_shadow_property_gate`). Abre a linha em andamento (cerca:
--     execução ↔ versão do lease). Idempotente por execução (F-11).
create or replace function public.shadow_claim_execution(
  p_tick_token text, p_execution_id uuid, p_conversation_id uuid, p_expected_version integer,
  p_tenant_id uuid, p_property_id uuid, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  r public.guest_ai_conversation_leases%rowtype;
  f public.guest_ai_shadow_inflight%rowtype;
  v_token text;
  v_gate text;
begin
  if p_tick_token is null or p_tick_token !~ '^[0-9a-f]{64}$' or p_execution_id is null or p_conversation_id is null
     or p_expected_version is null or p_expected_version < 1 or p_tenant_id is null or p_property_id is null
     or p_channel is null or p_channel not in ('airbnb', 'whatsapp', 'web') then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  -- repetição idempotente (resposta perdida depois do commit): devolve a MESMA posse, se ainda vigente
  select * into f from public.guest_ai_shadow_inflight where execution_id = p_execution_id;
  if found then
    select * into r from public.guest_ai_conversation_leases where conversation_id = f.conversation_id;
    if f.status = 'running' and f.conversation_id = p_conversation_id and r.version = f.lease_version and r.state = 'processing' and r.lease_expires_at > now() then
      return jsonb_build_object('result', 'claimed', 'repeated', true, 'version', r.version, 'owner_token', r.owner_token, 'batch_id', r.batch_id,
        'message_ids', to_jsonb(r.message_ids), 'attempts', r.attempts);
    end if;
    return jsonb_build_object('result', 'duplicate');
  end if;
  if c.state <> 'running' then return jsonb_build_object('result', 'state_not_running', 'state', c.state); end if;
  if c.tick_owner_token is distinct from p_tick_token or c.tick_expires_at < now() + interval '15 seconds' then
    return jsonb_build_object('result', 'tick_not_held');
  end if;
  -- imóvel ATIVO: escopo global, elegibilidade, interruptores e dono conferidos no banco (fail-closed)
  v_gate := public.guest_ai_shadow_property_gate(p_tenant_id, p_property_id);
  if v_gate is not null then return jsonb_build_object('result', 'property_blocked', 'reason', v_gate); end if;
  select * into r from public.guest_ai_conversation_leases where conversation_id = p_conversation_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.version <> p_expected_version then return jsonb_build_object('result', 'stale_version', 'version', r.version, 'state', r.state); end if;
  if r.state <> 'ready' or r.batch_id is null or r.message_ids is null or cardinality(r.message_ids) = 0 then
    return jsonb_build_object('result', 'not_claimable', 'version', r.version, 'state', r.state);
  end if;
  if r.attempts >= 3 then return jsonb_build_object('result', 'attempts_exhausted', 'version', r.version, 'state', r.state); end if;
  if exists (select 1 from public.guest_ai_shadow_inflight where conversation_id = p_conversation_id and status = 'running') then
    return jsonb_build_object('result', 'conflict', 'version', r.version, 'state', r.state);
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.guest_ai_conversation_leases
     set state = 'processing', owner_token = v_token, lease_expires_at = now() + interval '30 seconds',
         attempts = r.attempts + 1, version = r.version + 1, updated_at = now()
   where conversation_id = p_conversation_id
   returning * into r;
  insert into public.guest_ai_shadow_inflight (execution_id, conversation_id, tenant_id, property_id, channel, batch_id, lease_version)
  values (p_execution_id, p_conversation_id, p_tenant_id, p_property_id, p_channel, r.batch_id, r.version);
  return jsonb_build_object('result', 'claimed', 'version', r.version, 'owner_token', r.owner_token, 'batch_id', r.batch_id,
    'message_ids', to_jsonb(r.message_ids), 'attempts', r.attempts);
end;
$function$;

-- Sela INTERNAMENTE o lote encerrado (F-05): as mensagens do lote entram na janela de processadas e saem
-- das pendentes — nenhuma reabertura sem mensagem NOVA. O identificador do lote é preservado (histórico).
create or replace function public.guest_ai_shadow_seal_lease(r public.guest_ai_conversation_leases, p_to text)
returns public.guest_ai_conversation_leases
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_obs uuid[];
  o public.guest_ai_conversation_leases%rowtype;
begin
  select r.processed_message_ids || coalesce(array_agg(x order by i), '{}') into v_obs
    from unnest(coalesce(r.message_ids, '{}')) with ordinality t(x, i) where not (x = any (r.processed_message_ids));
  update public.guest_ai_conversation_leases
     set state = p_to, owner_token = null, lease_expires_at = null,
         -- concluído mantém o lote (CHECK de completed); falha sela: lote sai das pendentes
         message_ids = case when p_to = 'completed' then r.message_ids else '{}'::uuid[] end,
         processed_message_ids = v_obs[greatest(cardinality(v_obs) - 199, 1):cardinality(v_obs)],
         version = r.version + 1, updated_at = now()
   where conversation_id = r.conversation_id
   returning * into o;
  return o;
end;
$function$;

-- 17) FINALIZAÇÃO ATÔMICA (F-02/F-01/F-11/F-12): numa única transação — cerca do lease (versão + token +
--     prazo), fechamento do lease (complete / fail selado), liquidação pelo uso real, registro e
--     disjuntores. Cerca violada ⇒ o registro de fallback (`lease_integrity_failure`) substitui o normal e
--     o lease de outro dono nunca é tocado. Idempotente por execução: repetir depois de resposta perdida
--     devolve `duplicate` sem liquidar nem registrar de novo.
create or replace function public.shadow_finalize_execution(
  p_execution_id uuid, p_owner_token text, p_outcome text, p_settlement jsonb, p_record jsonb, p_fenced_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  f public.guest_ai_shadow_inflight%rowtype;
  r public.guest_ai_conversation_leases%rowtype;
  v_tokens bigint;
  v_cost numeric;
  v_calls integer;
  v_live boolean;
  v_same boolean;
  v_lease text;
  v_rec jsonb;
  v_set jsonb;
  v_ins jsonb;
  v_br jsonb;
  v_rr jsonb;
begin
  if p_execution_id is null or p_owner_token is null or p_owner_token !~ '^[0-9a-f]{64}$' or p_outcome not in ('complete', 'fail')
     or p_settlement is null or jsonb_typeof(p_settlement) <> 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_settlement) k) is distinct from array['calls', 'cost_usd', 'tokens']
     or jsonb_typeof(p_settlement->'tokens') <> 'number' or jsonb_typeof(p_settlement->'calls') <> 'number' or jsonb_typeof(p_settlement->'cost_usd') <> 'string'
     or p_record is null or jsonb_typeof(p_record) <> 'object' or p_fenced_record is null or jsonb_typeof(p_fenced_record) <> 'object' then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  begin
    v_tokens := (p_settlement->>'tokens')::bigint;
    v_calls := (p_settlement->>'calls')::integer;
    v_cost := (p_settlement->>'cost_usd')::numeric;
  exception when others then
    return jsonb_build_object('result', 'invalid_argument');
  end;
  if v_tokens < 0 or v_calls < 0 or v_calls > 2 or v_cost < 0 or v_cost <> round(v_cost, 8) or (p_settlement->>'tokens')::numeric <> v_tokens then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  -- ordem de travas: controle → em andamento → lease → reserva → dia (igual à reconciliação)
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  select * into f from public.guest_ai_shadow_inflight where execution_id = p_execution_id for update;
  if not found then return jsonb_build_object('result', 'not_claimed'); end if;
  if f.status = 'finalized' then return jsonb_build_object('result', 'duplicate'); end if;
  if f.status = 'reconciled' then return jsonb_build_object('result', 'reconciled'); end if;
  -- os dois registros pertencem a ESTA execução, a ESTE lote e contam o MESMO uso liquidado
  for v_rr in select x from (values (p_record), (p_fenced_record)) v(x) loop
    if v_rr->>'execution_id' is distinct from f.execution_id::text or v_rr->>'conversation_id' is distinct from f.conversation_id::text
       or v_rr->>'tenant_id' is distinct from f.tenant_id::text or v_rr->>'property_id' is distinct from f.property_id::text
       or v_rr->>'channel' is distinct from f.channel or v_rr->>'batch_id' is distinct from f.batch_id::text
       or v_rr->>'lease_version' is distinct from f.lease_version::text
       or jsonb_typeof(v_rr->'cost_usd') is distinct from 'string' or (v_rr->>'cost_usd')::numeric is distinct from v_cost
       or (v_rr->>'gateway_calls')::integer is distinct from v_calls or (v_rr->>'total_tokens')::bigint is distinct from v_tokens then
      return jsonb_build_object('result', 'invalid_argument');
    end if;
  end loop;
  if p_fenced_record->>'decision' <> 'technical_failure' or p_fenced_record->>'technical_code' <> 'lease_integrity_failure' then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  select * into r from public.guest_ai_conversation_leases where conversation_id = f.conversation_id for update;
  v_same := found and r.version = f.lease_version and r.state = 'processing' and r.owner_token = p_owner_token and r.batch_id = f.batch_id;
  v_live := v_same and r.lease_expires_at > now();
  if v_live then
    r := public.guest_ai_shadow_seal_lease(r, case when p_outcome = 'complete' then 'completed' else 'failed' end);
    v_lease := r.state;
    v_rec := p_record;
  elsif v_same then
    -- prazo vencido, mas o lote ainda é desta execução: selado como falha (nunca concluído fora do prazo)
    r := public.guest_ai_shadow_seal_lease(r, 'failed');
    v_lease := 'fenced_expired';
    v_rec := p_fenced_record;
  else
    -- outro dono/versão: o lease NÃO é tocado
    v_lease := 'fenced_foreign';
    v_rec := p_fenced_record;
  end if;
  v_ins := public.guest_ai_shadow_insert_execution(v_rec);
  if v_ins->>'result' <> 'inserted' then
    -- registro inválido ⇒ nada desta transação persiste (o lease volta ao estado anterior)
    raise exception using errcode = 'P0001', message = 'shadow_finalize_record_rejected';
  end if;
  v_set := public.guest_ai_shadow_settle_locked(c, p_execution_id, 'actual', v_tokens, v_cost, v_calls);
  if v_set->>'result' = 'no_reservation' and v_calls > 0 then
    -- Gateway chamado sem reserva: divergência de integridade
    perform public.guest_ai_shadow_trip_locked(c, 'integrity_violation', 'integrity_divergence');
    select * into c from public.guest_ai_shadow_control where id = 1;
  elsif (v_set->>'over_reservation')::boolean then
    -- anomalia grave (uso real acima do reservado): DESARMA (fail-closed)
    perform public.guest_ai_shadow_trip_locked(c, 'budget_exhausted', 'token_limit_violation');
    select * into c from public.guest_ai_shadow_control where id = 1;
  end if;
  -- A1: dia esgotado (`day_exhausted`) NÃO desarma; as próximas reservas do mesmo dia UTC são recusadas
  update public.guest_ai_shadow_inflight set status = 'finalized', closed_at = now() where execution_id = p_execution_id;
  v_br := public.guest_ai_shadow_breakers_locked(c, v_ins->>'decision');
  return jsonb_build_object('result', 'finalized', 'lease', v_lease, 'decision', v_ins->>'decision', 'settlement', v_set->>'result') || v_br;
exception
  when raise_exception then
    if sqlerrm = 'shadow_finalize_record_rejected' then return jsonb_build_object('result', 'invalid_argument'); end if;
    raise;
end;
$function$;

-- 18) RECONCILIAÇÃO (F-01/F-04/F-05): assume ATOMICAMENTE cada execução cujo worker se perdeu (o lease
--     da execução venceu ou mudou de dono), sem nunca reprocessar: sela o lote, liquida a reserva órfã
--     pelo PIOR CASO reservado e registra `technical_failure / worker_lost`. Só com a trava do tick.
--     Idempotente: execução já finalizada/reconciliada não é tocada de novo.
create or replace function public.shadow_reconcile(p_tick_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  f public.guest_ai_shadow_inflight%rowtype;
  r public.guest_ai_conversation_leases%rowtype;
  v_set jsonb;
  v_ins jsonb;
  v_n integer := 0;
  v_ms bigint;
  v_last text := null;
begin
  if p_tick_token is null or p_tick_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('result', 'invalid_argument'); end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  if c.tick_owner_token is distinct from p_tick_token or c.tick_expires_at <= now() then
    return jsonb_build_object('result', 'tick_not_held');
  end if;
  for f in select * from public.guest_ai_shadow_inflight where status = 'running' order by started_at for update loop
    select * into r from public.guest_ai_conversation_leases where conversation_id = f.conversation_id for update;
    -- worker vivo dentro do prazo do lease: não é órfão
    continue when found and r.version = f.lease_version and r.state = 'processing' and r.lease_expires_at > now();
    if found and r.batch_id = f.batch_id and (
         (r.version = f.lease_version and r.state = 'processing')
         or (r.state in ('expired', 'cancelled', 'failed') and cardinality(coalesce(r.message_ids, '{}')) > 0)) then
      perform public.guest_ai_shadow_seal_lease(r, 'failed');
    end if;
    v_set := public.guest_ai_shadow_settle_locked(c, f.execution_id, 'orphan_worst_case', null, null, null);
    v_ms := least(2147483647, greatest(0, floor(extract(epoch from (now() - f.started_at)) * 1000)))::bigint;
    v_ins := public.guest_ai_shadow_insert_execution(jsonb_build_object(
      'execution_id', f.execution_id, 'tenant_id', f.tenant_id, 'property_id', f.property_id, 'conversation_id', f.conversation_id,
      'batch_id', f.batch_id, 'lease_version', f.lease_version, 'channel', f.channel,
      'chain_version', 'db-reconcile.2026-11-04.1', 'shadow_version', 'db-reconcile.2026-11-04.1', 'composer_version', null,
      'model_id', c.model_id, 'started_at', f.started_at, 'finished_at', now(), 'total_ms', v_ms, 'lease_ms', 0, 'context_ms', 0,
      'gateway_ms', 0, 'validation_ms', 0, 'timing_context', null, 'timing_dossier', null, 'timing_history', null, 'timing_scope_check', null,
      'timing_stay_authorizations', null, 'timing_human_ownership', null, 'timing_human_pause', null, 'timing_sender_identity', null,
      'timing_guard', null, 'timing_compose', null, 'timing_model_output', null, 'timing_parse', null, 'timing_structural_validation', null,
      'timing_semantic_validation', null, 'timing_final_decision', null) || jsonb_build_object(
      -- uso desconhecido: o registro conta o que foi LIQUIDADO (pior caso), nunca menos
      'input_tokens', 0, 'output_tokens', 0, 'reasoning_tokens', 0,
      'total_tokens', coalesce((select settled_tokens from public.guest_ai_shadow_budget_reservations where execution_id = f.execution_id), 0),
      'usage_source', 'none',
      'cost_usd', coalesce((select settled_cost from public.guest_ai_shadow_budget_reservations where execution_id = f.execution_id), 0),
      'gateway_calls', coalesce((select settled_calls from public.guest_ai_shadow_budget_reservations where execution_id = f.execution_id), 0),
      'estimated_input_tokens', null, 'candidate_available', false, 'decision', 'technical_failure', 'strategy', null,
      'intents', '[]'::jsonb, 'intent_count', 0, 'commitment_kinds', '[]'::jsonb, 'human_intervention_needed', false, 'handoff_urgency', null,
      'pause_state', 'not_evaluated', 'context_check', 'not_run', 'execution_state', 'failed', 'response_discarded', true, 'timeout', false,
      'token_limit_violation', false, 'concurrency_detected', false, 'gateway_error', null, 'budget_exceeded', null, 'refusal_code', null,
      'technical_code', 'worker_lost', 'block_code', null, 'integrity_code', null));
    if v_ins->>'result' <> 'inserted' then
      raise exception using errcode = 'P0001', message = 'shadow_reconcile_record_rejected';
    end if;
    update public.guest_ai_shadow_inflight set status = 'reconciled', closed_at = now() where execution_id = f.execution_id;
    v_n := v_n + 1;
    -- A1: a liquidação pelo pior caso fica registrada; dia esgotado NÃO desarma
    v_last := 'technical_failure';
  end loop;
  if v_n > 0 then
    return jsonb_build_object('result', 'ok', 'reconciled', v_n) || public.guest_ai_shadow_breakers_locked(c, v_last);
  end if;
  return jsonb_build_object('result', 'ok', 'reconciled', 0);
end;
$function$;

-- 12) Relatório autorizado (agregados por tenant, sem texto) + registro do acesso.
create or replace function public.shadow_report(p_actor uuid, p_report text, p_tenant_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare v jsonb;
begin
  if p_actor is null or p_tenant_id is null or p_from is null or p_to is null or p_to <= p_from or p_report not in ('decision_summary', 'daily_cost') then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  insert into public.guest_ai_shadow_access_log (actor, report, tenant_id, from_at, to_at) values (p_actor, p_report, p_tenant_id, p_from, p_to);
  if p_report = 'decision_summary' then
    select coalesce(jsonb_agg(jsonb_build_object('property_id', property_id, 'decision', decision, 'executions', n) order by property_id, decision), '[]'::jsonb)
      into v
      from (select property_id, decision, count(*) as n from public.guest_ai_shadow_executions
             where tenant_id = p_tenant_id and finished_at >= p_from and finished_at < p_to group by property_id, decision) s;
  else
    select coalesce(jsonb_agg(jsonb_build_object('day', day, 'property_id', property_id, 'cost_usd', cost, 'total_tokens', tokens, 'gateway_calls', calls) order by day, property_id), '[]'::jsonb)
      into v
      from (select (finished_at at time zone 'UTC')::date as day, property_id, sum(cost_usd) as cost, sum(total_tokens) as tokens, sum(gateway_calls) as calls
              from public.guest_ai_shadow_executions
             where tenant_id = p_tenant_id and finished_at >= p_from and finished_at < p_to group by 1, 2) s;
  end if;
  return jsonb_build_object('result', 'ok', 'rows', v);
end;
$function$;

-- 13) Expurgo por idade (retenção configurada; sem retenção configurada nada é apagado).
create or replace function public.shadow_purge_expired()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_days integer;
  v_n integer;
begin
  select telemetry_retention_days into v_days from public.guest_ai_shadow_control where id = 1;
  if v_days is null then return jsonb_build_object('result', 'retention_not_configured'); end if;
  delete from public.guest_ai_shadow_executions where finished_at < now() - make_interval(days => v_days);
  get diagnostics v_n = row_count;
  return jsonb_build_object('result', 'ok', 'deleted', v_n);
end;
$function$;

-- ───────────────────────── Privilégios das funções ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.guest_ai_shadow_config_problem(public.guest_ai_shadow_control)',
    'public.guest_ai_shadow_error_verdict(integer, integer)',
    'public.guest_ai_shadow_trip_locked(public.guest_ai_shadow_control, text, text)',
    'public.guest_ai_shadow_settle_locked(public.guest_ai_shadow_control, uuid, text, bigint, numeric, integer)',
    'public.guest_ai_shadow_insert_execution(jsonb)',
    'public.guest_ai_shadow_breakers_locked(public.guest_ai_shadow_control, text)',
    'public.guest_ai_shadow_seal_lease(public.guest_ai_conversation_leases, text)',
    'public.guest_ai_shadow_property_gate(uuid, uuid)',
    'public.shadow_get_control()',
    'public.shadow_configure(integer, uuid, text, text, integer, integer, integer, numeric, numeric, bigint, integer, integer, integer, text, integer, integer, integer)',
    'public.shadow_authorize_retention(integer, uuid, text, text)',
    'public.shadow_transition(integer, text, uuid, text, text)',
    'public.shadow_trip(text, text)',
    'public.shadow_reserve_budget(uuid, bigint, numeric, integer)',
    'public.shadow_evaluate_breakers()',
    'public.shadow_record_execution(jsonb)',
    'public.shadow_acquire_tick()',
    'public.shadow_release_tick(text)',
    'public.shadow_claim_execution(text, uuid, uuid, integer, uuid, uuid, text)',
    'public.shadow_finalize_execution(uuid, text, text, jsonb, jsonb, jsonb)',
    'public.shadow_reconcile(text)',
    'public.shadow_report(uuid, text, uuid, timestamptz, timestamptz)',
    'public.shadow_purge_expired()'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on function %s from sandbox_exec', f);
    end if;
  end loop;
  -- RPCs do WORKER (lista fechada): EXECUTE só para service_role. Internas e ADMINISTRATIVAS
  -- (configurar, retenção, transição, relatório, expurgo) ficam sem EXECUTE para ninguém além do dono.
  foreach f in array array[
    'public.shadow_get_control()',
    'public.shadow_trip(text, text)',
    'public.shadow_reserve_budget(uuid, bigint, numeric, integer)',
    'public.shadow_evaluate_breakers()',
    'public.shadow_record_execution(jsonb)',
    'public.shadow_acquire_tick()',
    'public.shadow_release_tick(text)',
    'public.shadow_claim_execution(text, uuid, uuid, integer, uuid, uuid, text)',
    'public.shadow_finalize_execution(uuid, text, text, jsonb, jsonb, jsonb)',
    'public.shadow_reconcile(text)'] loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ═════════════════ 3/3 · supabase/migrations/20261105120000_guest_ai_shadow_global.sql ═════════════════
-- ConciergeIA Guest AI · Gate B3.3 · ENTREGA 4 (revisão GLOBAL, diretriz complementar de 04/11/2026)
-- Shadow Mode para TODOS os imóveis ELEGÍVEIS da plataforma — sem lista fixa e sem teto de imóveis.
-- Migration LOCAL: NÃO aplicar em produção sem a autorização do GATE A (aplicação inerte).
-- Depende de `20261104000000_guest_ai_conversation_leases.sql` e `20261104120000_guest_ai_shadow.sql`.
--
-- Quem participa (decidido SEMPRE no banco, por `guest_ai_shadow_property_gate`, na ordem):
--  1. ESCOPO GLOBAL (`guest_ai_shadow_control.property_scope`): nasce `none` ⇒ nenhum imóvel participa.
--     Só um ato administrativo do dono, com evidência, muda para `all_eligible` (GATE B).
--  2. O imóvel existe e o seu dono (`properties.owner_id`) é o tenant informado.
--  3. Interruptor do TENANT (`guest_ai_shadow_tenant_switch`): desligado ⇒ todos os imóveis dele saem.
--  4. Interruptor do IMÓVEL (`guest_ai_shadow_property_switch`): desligado ⇒ só ele sai.
--  5. ELEGIBILIDADE TÉCNICA (`guest_ai_shadow_eligibility_reason`, regra `eligibility.2026-11-05.1`):
--     property_not_found · archived · tenant_unresolved · listing_inconsistent · no_guest_channel ·
--     operational_data_missing. Motivo sempre por código fechado; foto auditável em
--     `guest_ai_shadow_property_eligibility` (`shadow_refresh_eligibility`).
--  * A elegibilidade é avaliada AO VIVO em cada leitura de candidatas, em cada consulta do worker e em
--    cada reivindicação: um imóvel arquivado, excluído ou desligado sai na hora, sem ação no Shadow.
--  * Candidatas escolhidas NO BANCO (`shadow_list_candidates`): só com a trava do tick, só imóveis
--    ativos, só ids e códigos (nunca texto nem o identificador de sessão do hóspede), rodízio entre
--    tenants e ordem de chegada dentro de cada tenant; nunca mais que o teto por tick do controle (≤ 3).
--  * Emergência: `shadow_emergency_stop` (para tudo), interruptores de tenant/imóvel (desligar nunca é
--    bloqueado), `shadow_admin_reconcile` (encerra execuções abandonadas com o Shadow parado).
--  * Administração SÓ pelo dono das funções (operador no SQL do banco): nenhuma RPC administrativa é
--    executável por service_role, authenticated ou anon. Nenhum privilégio é ampliado.
--  * Nenhuma tabela operacional é alterada; nada de imóvel ou hóspede é copiado (só ids e códigos).

-- ───────────────────────── Guarda (pré-requisitos e reexecução) ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['public.guest_ai_shadow_control', 'public.guest_ai_shadow_inflight', 'public.guest_ai_shadow_executions',
                           'public.guest_ai_conversation_leases', 'public.properties', 'public.property_chat_conversations',
                           'public.property_chat_messages', 'public.profiles', 'public.property_listing_raw_data',
                           'public.channex_twin_links', 'public.host_whatsapp_config'] loop
    if to_regclass(t) is null then
      raise exception 'guest_ai_shadow_global: pré-requisito ausente (%)', t using errcode = 'P0001';
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'guest_ai_shadow_control' and column_name = 'property_scope')
     or exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname in ('guest_ai_shadow_property_switch', 'guest_ai_shadow_tenant_switch',
                                                               'guest_ai_shadow_switch_log', 'guest_ai_shadow_property_eligibility'))
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('shadow_set_scope', 'shadow_set_tenant_enabled', 'shadow_set_property_enabled',
                   'shadow_emergency_stop', 'shadow_admin_reconcile', 'shadow_refresh_eligibility', 'shadow_list_candidates',
                   'shadow_property_status', 'guest_ai_shadow_eligibility_reason', 'guest_ai_shadow_reconcile_core')) then
    raise exception 'guest_ai_shadow_global: objetos já existem; migration não reaplicada (conferir com o script de validação)' using errcode = 'P0001';
  end if;
end $$;

-- ───────────────────────── Escopo global (no controle; nasce `none`) ─────────────────────────
alter table public.guest_ai_shadow_control
  add column property_scope        text not null default 'none',
  add column scope_version         integer not null default 0,
  add column scope_changed_at      timestamptz,
  add column scope_changed_by      uuid,
  add column scope_evidence_sha256 text,
  add constraint gasc_scope_ck check (property_scope in ('none', 'all_eligible')),
  add constraint gasc_scope_version_ck check (scope_version >= 0),
  add constraint gasc_scope_evidence_ck check (scope_evidence_sha256 is null or scope_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  -- escopo aberto exige autor, instante e referência da autorização
  add constraint gasc_scope_open_ck check (property_scope = 'none'
    or (scope_changed_at is not null and scope_changed_by is not null and scope_evidence_sha256 is not null));

-- ───────────────────────── Interruptores (desligar = sair; ausência de linha = segue o escopo) ─────────────────────────
create table public.guest_ai_shadow_tenant_switch (
  tenant_id    uuid primary key,
  enabled      boolean not null,
  version      integer not null,
  changed_at   timestamptz not null default now(),
  changed_by   uuid not null,
  reason_code  text not null,
  constraint gasts_version_ck check (version >= 1),
  constraint gasts_reason_ck check (reason_code in ('authorized_enable', 'authorized_disable', 'emergency_disable'))
);

create table public.guest_ai_shadow_property_switch (
  property_id  uuid primary key,
  tenant_id    uuid not null,
  enabled      boolean not null,
  version      integer not null,
  changed_at   timestamptz not null default now(),
  changed_by   uuid not null,
  reason_code  text not null,
  constraint gasps_version_ck check (version >= 1),
  constraint gasps_reason_ck check (reason_code in ('authorized_enable', 'authorized_disable', 'emergency_disable'))
);

-- Histórico ÚNICO e imutável de toda mudança de escopo e de interruptor: quem, papel do banco, quando,
-- antes/depois, motivo, evidência. Ninguém além do dono tem privilégio; nenhuma função altera ou apaga.
create table public.guest_ai_shadow_switch_log (
  id              bigint generated always as identity primary key,
  subject_kind    text not null,
  tenant_id       uuid,
  property_id     uuid,
  from_value      text not null,
  to_value        text not null,
  version         integer not null,
  actor           uuid not null,
  db_role         text not null,
  reason_code     text not null,
  evidence_sha256 text,
  at              timestamptz not null default now(),
  constraint gassl_kind_ck check (subject_kind in ('global', 'tenant', 'property')),
  constraint gassl_subject_ck check (
    (subject_kind = 'global' and tenant_id is null and property_id is null and from_value in ('none', 'all_eligible') and to_value in ('none', 'all_eligible'))
    or (subject_kind = 'tenant' and tenant_id is not null and property_id is null and from_value in ('enabled', 'disabled') and to_value in ('enabled', 'disabled'))
    or (subject_kind = 'property' and tenant_id is not null and property_id is not null and from_value in ('enabled', 'disabled') and to_value in ('enabled', 'disabled'))),
  constraint gassl_change_ck check (from_value <> to_value),
  constraint gassl_role_ck check (db_role ~ '^[a-z_][a-z0-9_]{0,62}$'),
  constraint gassl_reason_ck check (reason_code in ('authorized_global_activation', 'authorized_global_deactivation', 'emergency_scope_off',
                                                    'authorized_enable', 'authorized_disable', 'emergency_disable')),
  constraint gassl_evidence_ck check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  -- abrir o escopo ou religar exige referência da autorização
  constraint gassl_enable_evidence_ck check (to_value not in ('all_eligible', 'enabled') or evidence_sha256 is not null)
);

-- Foto auditável da elegibilidade (o motivo estruturado de cada imóvel inelegível). A decisão em tempo
-- de execução NÃO depende desta foto: é sempre ao vivo.
create table public.guest_ai_shadow_property_eligibility (
  property_id   uuid primary key,
  tenant_id     uuid,
  eligible      boolean not null,
  reason_code   text,
  rule_version  text not null,
  evaluated_at  timestamptz not null default now(),
  evaluated_by  uuid not null,
  constraint gaspe_reason_ck check (reason_code is null or reason_code in ('property_not_found', 'archived', 'tenant_unresolved', 'listing_inconsistent', 'no_guest_channel', 'operational_data_missing')),
  constraint gaspe_consistent_ck check (eligible = (reason_code is null)),
  constraint gaspe_rule_ck check (rule_version ~ '^eligibility\.[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);

do $$
declare t text;
begin
  foreach t in array array['guest_ai_shadow_tenant_switch', 'guest_ai_shadow_property_switch', 'guest_ai_shadow_switch_log',
                           'guest_ai_shadow_property_eligibility'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on table public.%I from sandbox_exec', t);
    end if;
  end loop;
  -- a ACL padrão da produção concede sequências novas a clientes: revogação explícita
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'guest\_ai\_shadow\_switch\_log%' loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated, service_role', t);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on sequence public.%I from sandbox_exec', t);
    end if;
  end loop;
end $$;

-- ───────────────────────── Elegibilidade técnica (interna; ao vivo) ─────────────────────────
-- NULL ⇒ elegível. Ordem fixa: o primeiro motivo encontrado é o registrado.
--  * property_not_found: o imóvel não existe (excluído pela operação convencional).
--  * archived: arquivado.
--  * tenant_unresolved: o dono não tem conta (perfil) — não há tenant a quem atribuir a execução.
--  * listing_inconsistent: anúncio do imóvel pertence a outro dono, ou o mesmo anúncio/propriedade Channex
--    está ligado a mais de um imóvel, ou vínculo gêmeo de outro dono (associação ambígua ⇒ nunca adivinhar).
--  * no_guest_channel: nenhum canal pelo qual um hóspede fala com o imóvel — guia não publicado (ou não
--    criado), nenhum anúncio utilizável (inexistente, não encontrado ou conta desconectada) e nenhum
--    WhatsApp ativo do dono.
--  * operational_data_missing: sem horário de check-in ou check-out (dado mínimo do dossiê).
create or replace function public.guest_ai_shadow_eligibility_reason(p_property_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  p record;
begin
  if p_property_id is null then return 'property_not_found'; end if;
  select id, owner_id, archived_at, published, guide_created, checkin_time, checkout_time into p
    from public.properties where id = p_property_id;
  if not found then return 'property_not_found'; end if;
  if p.archived_at is not null then return 'archived'; end if;
  if p.owner_id is null or not exists (select 1 from public.profiles where id = p.owner_id) then return 'tenant_unresolved'; end if;
  if exists (select 1 from public.property_listing_raw_data l
              where l.property_id = p.id
                and (l.owner_id is distinct from p.owner_id
                     or exists (select 1 from public.property_listing_raw_data o
                                 where o.property_id <> p.id
                                   and (o.airbnb_listing_id = l.airbnb_listing_id
                                        or (l.channex_property_id is not null and o.channex_property_id = l.channex_property_id)))))
     or exists (select 1 from public.channex_twin_links t where t.property_id = p.id and t.owner_id is distinct from p.owner_id) then
    return 'listing_inconsistent';
  end if;
  if not ((p.published and p.guide_created)
          or exists (select 1 from public.property_listing_raw_data l
                      where l.property_id = p.id and l.not_found_at is null
                        and not (l.sync_paused_at is not null and l.paused_reason = 'account_disconnected'))
          or exists (select 1 from public.host_whatsapp_config w where w.owner_id = p.owner_id and w.status = 'active')) then
    return 'no_guest_channel';
  end if;
  if coalesce(btrim(p.checkin_time), '') = '' or coalesce(btrim(p.checkout_time), '') = '' then
    return 'operational_data_missing';
  end if;
  return null;
end;
$function$;

-- ───────────────────────── Porta de imóvel (redefinida; antes FECHADA) ─────────────────────────
create or replace function public.guest_ai_shadow_property_gate(p_tenant_id uuid, p_property_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_scope text;
  v_owner uuid;
begin
  select property_scope into v_scope from public.guest_ai_shadow_control where id = 1;
  if v_scope is distinct from 'all_eligible' then return 'scope_off'; end if;
  if p_tenant_id is null or p_property_id is null then return 'property_not_found'; end if;
  select owner_id into v_owner from public.properties where id = p_property_id;
  if not found then return 'property_not_found'; end if;
  if v_owner is distinct from p_tenant_id then return 'tenant_mismatch'; end if;
  if exists (select 1 from public.guest_ai_shadow_tenant_switch where tenant_id = p_tenant_id and not enabled) then return 'tenant_disabled'; end if;
  if exists (select 1 from public.guest_ai_shadow_property_switch where property_id = p_property_id and not enabled) then return 'property_disabled'; end if;
  return public.guest_ai_shadow_eligibility_reason(p_property_id);
end;
$function$;

-- WORKER: o imóvel pode participar agora? (só leitura; o worker consulta ANTES de ler qualquer dado)
create or replace function public.shadow_property_status(p_tenant_id uuid, p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare v text;
begin
  if p_tenant_id is null or p_property_id is null then return jsonb_build_object('result', 'invalid_argument'); end if;
  v := public.guest_ai_shadow_property_gate(p_tenant_id, p_property_id);
  if v is null then return jsonb_build_object('result', 'active'); end if;
  return jsonb_build_object('result', 'blocked', 'reason', v);
end;
$function$;

-- WORKER: candidatas do tick, escolhidas no banco. Só com a trava do tick vigente e o Shadow em
-- `running`; só imóveis ativos; conversa com mensagem de hóspede dentro da janela de atividade, sem
-- execução em andamento e ainda não avaliada depois dessa mensagem. Rodízio entre tenants (1º de cada
-- tenant, depois o 2º…), ordem de chegada dentro do tenant (a mais antiga primeiro: ninguém fica para
-- trás dentro da janela). Devolve só ids e o código da superfície — nunca texto nem o id de sessão.
create or replace function public.shadow_list_candidates(p_tick_token text, p_lookback_seconds integer, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  v_limit integer;
  v jsonb;
begin
  if p_tick_token is null or p_tick_token !~ '^[0-9a-f]{64}$' or p_lookback_seconds is null or p_lookback_seconds not between 60 and 900
     or p_limit is null or p_limit < 1 then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  select * into c from public.guest_ai_shadow_control where id = 1;
  if c.state <> 'running' then return jsonb_build_object('result', 'state_not_running', 'state', c.state); end if;
  if c.tick_owner_token is distinct from p_tick_token or c.tick_expires_at <= now() then return jsonb_build_object('result', 'tick_not_held'); end if;
  if c.property_scope <> 'all_eligible' then return jsonb_build_object('result', 'scope_off'); end if;
  if c.max_conversations_per_tick is null then return jsonb_build_object('result', 'config_incomplete'); end if;
  v_limit := least(p_limit, c.max_conversations_per_tick);
  -- parte dos IMÓVEIS e usa o índice existente (property_id, last_message_at desc) de cada um; nenhum índice
  -- novo em tabela da operação convencional
  with recent as (
    select cv.id as conversation_id, p.id as property_id, p.owner_id as tenant_id,
           case when cv.guest_session_id like 'wa:%' then 'whatsapp' when cv.guest_session_id like 'airbnb:%' then 'airbnb' else 'guide_chat' end as surface
      from public.properties p
      cross join lateral (
        select x.id, x.guest_session_id from public.property_chat_conversations x
         where x.property_id = p.id and x.last_message_at >= now() - make_interval(secs => p_lookback_seconds)
         -- teto por imóvel (50 conversas ativas na janela): impede o planejador de achatar a junção e varrer a
         -- tabela inteira; cada imóvel vira uma leitura de índice, custo ∝ imóveis, não ∝ histórico de conversas
         order by x.last_message_at desc limit 50) cv
     where p.archived_at is null
  ), last_guest as (
    select r.*, lm.id as message_id, lm.created_at as message_at
      from recent r
      cross join lateral (
        select m.id, m.created_at from public.property_chat_messages m
         where m.conversation_id = r.conversation_id and m.sender_type = 'guest' and m.role = 'user'
         order by m.created_at desc, m.id desc limit 1) lm
     where lm.created_at >= now() - make_interval(secs => p_lookback_seconds)
  ), eligible as (
    select g.* from last_guest g
     where public.guest_ai_shadow_property_gate(g.tenant_id, g.property_id) is null
       and not exists (select 1 from public.guest_ai_shadow_inflight f where f.conversation_id = g.conversation_id and f.status = 'running')
       and not exists (select 1 from public.guest_ai_shadow_executions e where e.conversation_id = g.conversation_id and e.started_at >= g.message_at)
  ), ranked as (
    select e.*, row_number() over (partition by e.tenant_id order by e.message_at, e.conversation_id) as rn from eligible e
  ), chosen as (
    select * from ranked order by rn, message_at, conversation_id limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object('conversation_id', conversation_id, 'property_id', property_id, 'tenant_id', tenant_id,
                                               'surface', surface, 'message_id', message_id) order by rn, message_at, conversation_id), '[]'::jsonb)
    into v from chosen;
  return jsonb_build_object('result', 'ok', 'candidates', v);
end;
$function$;

-- ───────────────────────── Administração (só o dono) ─────────────────────────
-- Escopo global: `none` ⇒ `all_eligible` exige motivo `authorized_global_activation`, CAS e evidência;
-- voltar a `none` nunca é bloqueado (versão opcional). Não mexe no estado global (running/paused/…).
create or replace function public.shadow_set_scope(p_actor uuid, p_expected_scope_version integer, p_scope text, p_reason text, p_evidence_sha256 text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  if p_actor is null or p_scope is null or p_scope not in ('none', 'all_eligible') or p_reason is null
     or (p_scope = 'all_eligible' and (p_reason <> 'authorized_global_activation' or p_evidence_sha256 is null or p_expected_scope_version is null))
     or (p_scope = 'none' and p_reason not in ('authorized_global_deactivation', 'emergency_scope_off'))
     or (p_evidence_sha256 is not null and p_evidence_sha256 !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  if p_expected_scope_version is not null and p_expected_scope_version <> c.scope_version then
    return jsonb_build_object('result', 'stale_version', 'scope_version', c.scope_version);
  end if;
  if c.property_scope = p_scope then return jsonb_build_object('result', 'noop', 'scope', p_scope, 'scope_version', c.scope_version); end if;
  update public.guest_ai_shadow_control
     set property_scope = p_scope, scope_version = c.scope_version + 1, scope_changed_at = now(), scope_changed_by = p_actor,
         scope_evidence_sha256 = p_evidence_sha256
   where id = 1;
  insert into public.guest_ai_shadow_switch_log (subject_kind, from_value, to_value, version, actor, db_role, reason_code, evidence_sha256)
  values ('global', c.property_scope, p_scope, c.scope_version + 1, p_actor, session_user, p_reason, p_evidence_sha256);
  return jsonb_build_object('result', 'applied', 'scope', p_scope, 'scope_version', c.scope_version + 1);
end;
$function$;

-- Interruptor do TENANT. Desligar nunca é bloqueado (versão opcional); religar exige CAS e evidência.
create or replace function public.shadow_set_tenant_enabled(
  p_actor uuid, p_tenant_id uuid, p_enabled boolean, p_expected_version integer, p_reason text, p_evidence_sha256 text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  s public.guest_ai_shadow_tenant_switch%rowtype;
  v_found boolean;
  v_version integer;
begin
  if p_actor is null or p_tenant_id is null or p_enabled is null or p_reason is null
     or p_reason not in ('authorized_enable', 'authorized_disable', 'emergency_disable')
     or (p_enabled and p_reason <> 'authorized_enable') or (not p_enabled and p_reason = 'authorized_enable')
     or (p_evidence_sha256 is not null and p_evidence_sha256 !~ '^[0-9a-f]{64}$')
     or (p_enabled and (p_evidence_sha256 is null or p_expected_version is null)) then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  perform 1 from public.guest_ai_shadow_control where id = 1 for update;
  if not exists (select 1 from public.profiles where id = p_tenant_id) then return jsonb_build_object('result', 'not_found'); end if;
  select * into s from public.guest_ai_shadow_tenant_switch where tenant_id = p_tenant_id for update;
  v_found := found;
  v_version := case when v_found then s.version else 0 end;
  if p_expected_version is not null and p_expected_version <> v_version then
    return jsonb_build_object('result', 'stale_version', 'version', v_version);
  end if;
  if coalesce(s.enabled, true) = p_enabled then return jsonb_build_object('result', 'noop', 'enabled', p_enabled, 'version', v_version); end if;
  insert into public.guest_ai_shadow_tenant_switch (tenant_id, enabled, version, changed_at, changed_by, reason_code)
  values (p_tenant_id, p_enabled, v_version + 1, now(), p_actor, p_reason)
  on conflict (tenant_id) do update
     set enabled = excluded.enabled, version = excluded.version, changed_at = excluded.changed_at,
         changed_by = excluded.changed_by, reason_code = excluded.reason_code;
  insert into public.guest_ai_shadow_switch_log (subject_kind, tenant_id, from_value, to_value, version, actor, db_role, reason_code, evidence_sha256)
  values ('tenant', p_tenant_id, case when coalesce(s.enabled, true) then 'enabled' else 'disabled' end,
          case when p_enabled then 'enabled' else 'disabled' end, v_version + 1, p_actor, session_user, p_reason, p_evidence_sha256);
  return jsonb_build_object('result', 'applied', 'enabled', p_enabled, 'version', v_version + 1);
end;
$function$;

-- Interruptor do IMÓVEL (do tenant informado). Mesmas regras; não afeta nenhum outro imóvel.
create or replace function public.shadow_set_property_enabled(
  p_actor uuid, p_property_id uuid, p_tenant_id uuid, p_enabled boolean, p_expected_version integer,
  p_reason text, p_evidence_sha256 text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  s public.guest_ai_shadow_property_switch%rowtype;
  v_owner uuid;
  v_found boolean;
  v_version integer;
begin
  if p_actor is null or p_property_id is null or p_tenant_id is null or p_enabled is null or p_reason is null
     or p_reason not in ('authorized_enable', 'authorized_disable', 'emergency_disable')
     or (p_enabled and p_reason <> 'authorized_enable') or (not p_enabled and p_reason = 'authorized_enable')
     or (p_evidence_sha256 is not null and p_evidence_sha256 !~ '^[0-9a-f]{64}$')
     or (p_enabled and (p_evidence_sha256 is null or p_expected_version is null)) then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  perform 1 from public.guest_ai_shadow_control where id = 1 for update;
  select * into s from public.guest_ai_shadow_property_switch where property_id = p_property_id for update;
  v_found := found;
  if v_found and s.tenant_id <> p_tenant_id then return jsonb_build_object('result', 'tenant_mismatch'); end if;
  select owner_id into v_owner from public.properties where id = p_property_id;
  -- imóvel já excluído: só desligar é aceito (para registrar a saída); religar exige imóvel do tenant
  if v_owner is null and (p_enabled or not v_found) then return jsonb_build_object('result', 'not_found'); end if;
  if v_owner is not null and v_owner <> p_tenant_id then return jsonb_build_object('result', 'tenant_mismatch'); end if;
  v_version := case when v_found then s.version else 0 end;
  if p_expected_version is not null and p_expected_version <> v_version then
    return jsonb_build_object('result', 'stale_version', 'version', v_version);
  end if;
  if coalesce(s.enabled, true) = p_enabled then return jsonb_build_object('result', 'noop', 'enabled', p_enabled, 'version', v_version); end if;
  insert into public.guest_ai_shadow_property_switch (property_id, tenant_id, enabled, version, changed_at, changed_by, reason_code)
  values (p_property_id, p_tenant_id, p_enabled, v_version + 1, now(), p_actor, p_reason)
  on conflict (property_id) do update
     set enabled = excluded.enabled, version = excluded.version, changed_at = excluded.changed_at,
         changed_by = excluded.changed_by, reason_code = excluded.reason_code;
  insert into public.guest_ai_shadow_switch_log (subject_kind, tenant_id, property_id, from_value, to_value, version, actor, db_role, reason_code, evidence_sha256)
  values ('property', p_tenant_id, p_property_id, case when coalesce(s.enabled, true) then 'enabled' else 'disabled' end,
          case when p_enabled then 'enabled' else 'disabled' end, v_version + 1, p_actor, session_user, p_reason, p_evidence_sha256);
  return jsonb_build_object('result', 'applied', 'enabled', p_enabled, 'version', v_version + 1);
end;
$function$;

-- Foto da elegibilidade de TODOS os imóveis (substitui a anterior) e resumo só com contadores.
create or replace function public.shadow_refresh_eligibility(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare v jsonb;
begin
  if p_actor is null then return jsonb_build_object('result', 'invalid_argument'); end if;
  perform 1 from public.guest_ai_shadow_control where id = 1 for update;
  delete from public.guest_ai_shadow_property_eligibility e where not exists (select 1 from public.properties p where p.id = e.property_id);
  insert into public.guest_ai_shadow_property_eligibility (property_id, tenant_id, eligible, reason_code, rule_version, evaluated_at, evaluated_by)
  select p.id, p.owner_id, r.reason is null, r.reason, 'eligibility.2026-11-05.1', now(), p_actor
    from public.properties p cross join lateral (select public.guest_ai_shadow_eligibility_reason(p.id) as reason) r
  on conflict (property_id) do update
     set tenant_id = excluded.tenant_id, eligible = excluded.eligible, reason_code = excluded.reason_code,
         rule_version = excluded.rule_version, evaluated_at = excluded.evaluated_at, evaluated_by = excluded.evaluated_by;
  select jsonb_build_object('result', 'ok', 'rule_version', 'eligibility.2026-11-05.1',
           'properties', count(*), 'tenants', count(distinct tenant_id), 'eligible', count(*) filter (where eligible),
           'ineligible', count(*) filter (where not eligible),
           'by_reason', coalesce((select jsonb_object_agg(reason_code, n) from (select reason_code, count(*) n from public.guest_ai_shadow_property_eligibility
                                    where not eligible group by reason_code) x), '{}'::jsonb))
    into v from public.guest_ai_shadow_property_eligibility;
  return v;
end;
$function$;

-- Parada de emergência GLOBAL (mesma da preparação do piloto): ready/running ⇒ paused, trava do tick
-- liberada; nada novo começa; execuções em andamento terminam e liquidam; nunca religa nada.
create or replace function public.shadow_emergency_stop(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  r public.guest_ai_shadow_control%rowtype;
begin
  if p_actor is null then return jsonb_build_object('result', 'invalid_argument'); end if;
  select * into r from public.guest_ai_shadow_control where id = 1 for update;
  if r.state in ('ready', 'running') then
    update public.guest_ai_shadow_control
       set state = 'paused', state_version = r.state_version + 1, changed_at = now(), changed_by = p_actor, reason_code = 'authorized_pause',
           tick_owner_token = null, tick_expires_at = null
     where id = 1;
    insert into public.guest_ai_shadow_transitions (from_state, to_state, state_version, actor, automatic, reason_code)
    values (r.state, 'paused', r.state_version + 1, p_actor, false, 'authorized_pause');
    return jsonb_build_object('result', 'stopped', 'from', r.state, 'state', 'paused', 'state_version', r.state_version + 1);
  end if;
  update public.guest_ai_shadow_control set tick_owner_token = null, tick_expires_at = null where id = 1;
  return jsonb_build_object('result', 'already_stopped', 'state', r.state, 'state_version', r.state_version);
end;
$function$;

-- ───────────────────────── Redefinições ─────────────────────────
create or replace function public.shadow_get_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  select * into c from public.guest_ai_shadow_control where id = 1;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  return jsonb_build_object(
    'result', 'ok', 'state', c.state, 'state_version', c.state_version, 'model_id', c.model_id, 'reasoning_effort', c.reasoning_effort,
    'max_input_tokens', c.max_input_tokens, 'max_output_tokens', c.max_output_tokens, 'max_total_tokens', c.max_total_tokens,
    'max_turn_cost_usd', c.max_turn_cost_usd, 'daily_cost_limit_usd', c.daily_cost_limit_usd, 'max_daily_tokens', c.max_daily_tokens,
    'max_daily_calls', c.max_daily_calls, 'error_window_minutes', c.error_window_minutes, 'error_min_sample', c.error_min_sample,
    'budget_day_timezone', c.budget_day_timezone, 'telemetry_retention_days', c.telemetry_retention_days,
    'tick_interval_seconds', c.tick_interval_seconds, 'max_conversations_per_tick', c.max_conversations_per_tick,
    'retention_scope', c.retention_scope,
    -- escopo GLOBAL de imóveis (E4 global): 'none' ⇒ nenhum imóvel participa
    'property_scope', c.property_scope, 'scope_version', c.scope_version,
    'retention_authorized', c.retention_scope is not null and c.retention_authorized_at is not null,
    -- F-09/F-03: o instante do BANCO; o worker ancora nele todo instante de parede (pausa, coletor, registro)
    'db_now', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$function$;

create or replace function public.guest_ai_shadow_reconcile_core(c public.guest_ai_shadow_control)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  f public.guest_ai_shadow_inflight%rowtype;
  r public.guest_ai_conversation_leases%rowtype;
  v_set jsonb;
  v_ins jsonb;
  v_n integer := 0;
  v_ms bigint;
  v_last text := null;
begin
  -- controle já travado pelo chamador (FOR UPDATE)
  for f in select * from public.guest_ai_shadow_inflight where status = 'running' order by started_at for update loop
    select * into r from public.guest_ai_conversation_leases where conversation_id = f.conversation_id for update;
    -- worker vivo dentro do prazo do lease: não é órfão
    continue when found and r.version = f.lease_version and r.state = 'processing' and r.lease_expires_at > now();
    if found and r.batch_id = f.batch_id and (
         (r.version = f.lease_version and r.state = 'processing')
         or (r.state in ('expired', 'cancelled', 'failed') and cardinality(coalesce(r.message_ids, '{}')) > 0)) then
      perform public.guest_ai_shadow_seal_lease(r, 'failed');
    end if;
    v_set := public.guest_ai_shadow_settle_locked(c, f.execution_id, 'orphan_worst_case', null, null, null);
    v_ms := least(2147483647, greatest(0, floor(extract(epoch from (now() - f.started_at)) * 1000)))::bigint;
    v_ins := public.guest_ai_shadow_insert_execution(jsonb_build_object(
      'execution_id', f.execution_id, 'tenant_id', f.tenant_id, 'property_id', f.property_id, 'conversation_id', f.conversation_id,
      'batch_id', f.batch_id, 'lease_version', f.lease_version, 'channel', f.channel,
      'chain_version', 'db-reconcile.2026-11-04.1', 'shadow_version', 'db-reconcile.2026-11-04.1', 'composer_version', null,
      'model_id', c.model_id, 'started_at', f.started_at, 'finished_at', now(), 'total_ms', v_ms, 'lease_ms', 0, 'context_ms', 0,
      'gateway_ms', 0, 'validation_ms', 0, 'timing_context', null, 'timing_dossier', null, 'timing_history', null, 'timing_scope_check', null,
      'timing_stay_authorizations', null, 'timing_human_ownership', null, 'timing_human_pause', null, 'timing_sender_identity', null,
      'timing_guard', null, 'timing_compose', null, 'timing_model_output', null, 'timing_parse', null, 'timing_structural_validation', null,
      'timing_semantic_validation', null, 'timing_final_decision', null) || jsonb_build_object(
      -- uso desconhecido: o registro conta o que foi LIQUIDADO (pior caso), nunca menos
      'input_tokens', 0, 'output_tokens', 0, 'reasoning_tokens', 0,
      'total_tokens', coalesce((select settled_tokens from public.guest_ai_shadow_budget_reservations where execution_id = f.execution_id), 0),
      'usage_source', 'none',
      'cost_usd', coalesce((select settled_cost from public.guest_ai_shadow_budget_reservations where execution_id = f.execution_id), 0),
      'gateway_calls', coalesce((select settled_calls from public.guest_ai_shadow_budget_reservations where execution_id = f.execution_id), 0),
      'estimated_input_tokens', null, 'candidate_available', false, 'decision', 'technical_failure', 'strategy', null,
      'intents', '[]'::jsonb, 'intent_count', 0, 'commitment_kinds', '[]'::jsonb, 'human_intervention_needed', false, 'handoff_urgency', null,
      'pause_state', 'not_evaluated', 'context_check', 'not_run', 'execution_state', 'failed', 'response_discarded', true, 'timeout', false,
      'token_limit_violation', false, 'concurrency_detected', false, 'gateway_error', null, 'budget_exceeded', null, 'refusal_code', null,
      'technical_code', 'worker_lost', 'block_code', null, 'integrity_code', null));
    if v_ins->>'result' <> 'inserted' then
      raise exception using errcode = 'P0001', message = 'shadow_reconcile_record_rejected';
    end if;
    update public.guest_ai_shadow_inflight set status = 'reconciled', closed_at = now() where execution_id = f.execution_id;
    v_n := v_n + 1;
    -- A1: a liquidação pelo pior caso fica registrada; dia esgotado NÃO desarma
    v_last := 'technical_failure';
  end loop;
  if v_n > 0 then
    return jsonb_build_object('result', 'ok', 'reconciled', v_n) || public.guest_ai_shadow_breakers_locked(c, v_last);
  end if;
  return jsonb_build_object('result', 'ok', 'reconciled', 0);
end;
$function$;

-- Reconciliação: o corpo vira interno (controle travado pelo chamador) para servir ao tick e ao operador.
create or replace function public.shadow_reconcile(p_tick_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  if p_tick_token is null or p_tick_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('result', 'invalid_argument'); end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  if c.tick_owner_token is distinct from p_tick_token or c.tick_expires_at <= now() then
    return jsonb_build_object('result', 'tick_not_held');
  end if;
  return public.guest_ai_shadow_reconcile_core(c);
end;
$function$;

-- ADMIN (só o dono): reconciliação com o Shadow parado. Recusa se um tick estiver com a trava vigente;
-- nunca toca execução cujo lease ainda vale.
create or replace function public.shadow_admin_reconcile(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  if p_actor is null then return jsonb_build_object('result', 'invalid_argument'); end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  if c.tick_owner_token is not null and c.tick_expires_at > now() then return jsonb_build_object('result', 'tick_busy'); end if;
  return public.guest_ai_shadow_reconcile_core(c);
end;
$function$;

-- ───────────────────────── Privilégios ─────────────────────────
do $$
declare f text;
begin
  -- internas e administrativas: SEM EXECUTE para ninguém além do dono
  foreach f in array array[
    'public.guest_ai_shadow_eligibility_reason(uuid)',
    'public.guest_ai_shadow_property_gate(uuid, uuid)',
    'public.guest_ai_shadow_reconcile_core(public.guest_ai_shadow_control)',
    'public.shadow_set_scope(uuid, integer, text, text, text)',
    'public.shadow_set_tenant_enabled(uuid, uuid, boolean, integer, text, text)',
    'public.shadow_set_property_enabled(uuid, uuid, uuid, boolean, integer, text, text)',
    'public.shadow_refresh_eligibility(uuid)',
    'public.shadow_emergency_stop(uuid)',
    'public.shadow_admin_reconcile(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on function %s from sandbox_exec', f);
    end if;
  end loop;
  -- RPCs do WORKER (novas ou redefinidas): só service_role
  foreach f in array array[
    'public.shadow_get_control()',
    'public.shadow_property_status(uuid, uuid)',
    'public.shadow_list_candidates(text, integer, integer)',
    'public.shadow_reconcile(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on function %s from sandbox_exec', f);
    end if;
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ═══ FIM DO CONTEÚDO DO GATE A ═══
-- ═════════════════ verificação final (mesma transação) ═════════════════
do $gate_a$
begin
  if current_setting('guest_ai.gate_a_bundle', true) is distinct from 'on' then
    raise exception 'gate_a_bundle: a transação mudou durante a aplicação; desfeito' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'guest\_ai\_%') <> 12
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
           and (p.proname like 'shadow\_%' or p.proname like 'guest\_ai\_shadow\_%' or p.proname like '%\_conversation\_lease')) <> 35
     or (select state || ':' || property_scope from public.guest_ai_shadow_control where id = 1) <> 'disabled:none' then
    raise exception 'gate_a_bundle: estado final diferente do inerte esperado; desfeito' using errcode = 'P0001';
  end if;
end
$gate_a$;
