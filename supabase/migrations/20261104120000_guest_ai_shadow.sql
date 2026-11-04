-- ConciergeIA Guest AI · Gate B3.3 (Entrega 2) — Shadow Mode: controle global, manifesto, orçamento,
-- telemetria estruturada e auditoria de acesso. Migration LOCAL (autorizada em 04/11/2026 só como
-- arquivo); NÃO aplicar em produção sem autorização específica (Entrega 4).
--
-- Princípios (espelho de `src/lib/guest-ai/shadow-exec/contracts.ts`; o teste `b33-contracts` confere
-- que cada vocabulário daqui é IGUAL ao do TypeScript):
--  * Nenhuma coluna de texto livre: toda coluna `text` tem CHECK de vocabulário fechado ou de formato
--    (UUID, versão, SHA-256, fuso IANA). Arrays validam cada elemento. Nenhum `jsonb` em tabela.
--  * Nenhum prompt, resposta, pergunta, mensagem, contexto, histórico, justificativa ou erro livre.
--  * RLS ligada sem política; todos os privilégios revogados; escrita SÓ pelas funções abaixo
--    (SECURITY DEFINER, `search_path = pg_catalog, pg_temp`, EXECUTE só para service_role).
--  * Estado global inicial `disabled`; nenhum manifesto ativo; nenhuma autorização de retenção; só o
--    teto diário APROVADO (US$ 1,00) vem preenchido — todos os demais limites nascem nulos e
--    impedem `ready`/`running` até serem configurados e válidos.
--  * Transições manuais exigem CAS de `state_version`, autor e motivo; transições automáticas só levam
--    a estados de falha, e nenhum estado de falha sai automaticamente.
--  * Orçamento diário transacional (linha do dia travada); reserva órfã nunca é liberada.
--  * Tabela extra em relação ao desenho: `guest_ai_shadow_budget_reservations` — sem ela a liquidação
--    teria de confiar no valor reservado informado pelo cliente; com ela o banco sabe o que liberar.
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
--    tick de 60 s; amostra mínima 20; fuso America/Sao_Paulo; teto diário ≤ US$ 1,00.

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
  manifest_version            integer,
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
  constraint gasc_tz_ck check (budget_day_timezone is null or (budget_day_timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$' and budget_day_timezone = 'America/Sao_Paulo')),
  constraint gasc_retention_days_ck check (telemetry_retention_days is null or telemetry_retention_days > 0),
  constraint gasc_tick_ck check (tick_interval_seconds is null or tick_interval_seconds = 60),
  constraint gasc_per_tick_ck check (max_conversations_per_tick is null or max_conversations_per_tick between 1 and 3),
  constraint gasc_tick_owner_ck check ((tick_owner_token is null) = (tick_expires_at is null) and (tick_owner_token is null or tick_owner_token ~ '^[0-9a-f]{64}$')),
  constraint gasc_manifest_ck check (manifest_version is null or manifest_version > 0),
  constraint gasc_retention_scope_ck check (retention_scope is null or retention_scope in ('openai_responses')),
  constraint gasc_retention_ck check (
    (retention_scope is null and retention_authorized_at is null and retention_authorized_by is null and retention_evidence_sha256 is null)
    or (retention_scope is not null and retention_authorized_at is not null and retention_authorized_by is not null and retention_evidence_sha256 is not null)
  ),
  constraint gasc_evidence_ck check (retention_evidence_sha256 is null or retention_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint gasc_reason_ck check (reason_code in ('initial', 'authorized_activation', 'authorized_pause', 'authorized_resume', 'authorized_disable', 'authorized_recovery', 'error_rate_exceeded', 'consecutive_failures', 'budget_limit_reached', 'token_limit_violation', 'integrity_divergence', 'measurement_unavailable', 'telemetry_failure', 'config_invalid'))
);

-- Estado inicial: desligado; só o teto diário aprovado (US$ 1,00). Nenhum outro limite, manifesto ou retenção.
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
  constraint gast_reason_ck check (reason_code in ('initial', 'authorized_activation', 'authorized_pause', 'authorized_resume', 'authorized_disable', 'authorized_recovery', 'error_rate_exceeded', 'consecutive_failures', 'budget_limit_reached', 'token_limit_violation', 'integrity_divergence', 'measurement_unavailable', 'telemetry_failure', 'config_invalid')),
  constraint gast_evidence_ck check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  -- manual ⇒ autor obrigatório; automática ⇒ sem autor e só para estado de falha
  constraint gast_actor_ck check (
    (automatic = false and actor is not null)
    or (automatic = true and actor is null and to_state in ('circuit_open', 'budget_exhausted', 'integrity_violation', 'technical_failure'))
  )
);

-- ───────────────────────── Manifesto versionado (só inserção) ─────────────────────────
create table public.guest_ai_shadow_manifest (
  manifest_version integer not null,
  tenant_id        uuid not null,
  property_id      uuid not null references public.properties(id) on delete restrict,
  selection_reason text not null,
  twin_status      text not null,
  history_status   text not null,
  authorized_at    timestamptz not null default now(),
  authorized_by    uuid not null,
  primary key (manifest_version, property_id),
  constraint gasm_version_ck check (manifest_version > 0),
  constraint gasm_reason_ck check (selection_reason in ('highest_volume', 'high_human_intervention', 'reservation_linked_volume', 'typology_diversity', 'single_channel_diversity', 'approved_substitute')),
  constraint gasm_twin_ck check (twin_status in ('verified', 'failed', 'not_checked')),
  constraint gasm_history_ck check (history_status in ('verified', 'failed', 'not_checked'))
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
    'master_switch_off', 'not_released', 'state_not_running', 'state_unreadable', 'manifest_unreadable', 'not_in_manifest',
    'retention_not_authorized', 'limits_missing', 'limits_invalid', 'model_not_allowed', 'generator_not_issued', 'budget_turn_exceeded',
    'budget_daily_exceeded', 'budget_reservation_failed', 'deadline_expired', 'pause_active', 'pause_indefinite', 'pause_unreadable',
    'ownership_indeterminate', 'ownership_unreadable', 'shutdown_requested'
  )),
  constraint gase_integrity_ck check (integrity_code is null or integrity_code in (
    'tenant_mismatch', 'property_unresolved', 'surface_mismatch', 'message_conversation_mismatch', 'manifest_tenant_mismatch',
    'manifest_property_mismatch', 'lease_conversation_mismatch', 'ownership_tenant_mismatch', 'ownership_property_mismatch',
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
  foreach t in array array['guest_ai_shadow_control', 'guest_ai_shadow_transitions', 'guest_ai_shadow_manifest', 'guest_ai_shadow_executions',
                           'guest_ai_shadow_budget_days', 'guest_ai_shadow_budget_reservations', 'guest_ai_shadow_access_log',
                           'guest_ai_shadow_inflight'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on table public.%I from sandbox_exec', t);
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
     or c.telemetry_retention_days is null or c.tick_interval_seconds is null or c.max_conversations_per_tick is null
     or c.manifest_version is null then
    return 'limits_missing';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = c.budget_day_timezone) then return 'limits_invalid'; end if;
  if not exists (select 1 from public.guest_ai_shadow_manifest m where m.manifest_version = c.manifest_version) then return 'limits_missing'; end if;
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
    'manifest_version', c.manifest_version, 'retention_scope', c.retention_scope,
    'retention_authorized', c.retention_scope is not null and c.retention_authorized_at is not null,
    -- F-09/F-03: o instante do BANCO; o worker ancora nele todo instante de parede (pausa, coletor, registro)
    'db_now', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$function$;

-- 2) Manifesto ATIVO (ids e códigos fechados; nunca nomes).
create or replace function public.shadow_get_manifest()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare v integer;
begin
  select manifest_version into v from public.guest_ai_shadow_control where id = 1;
  if v is null then return jsonb_build_object('result', 'ok', 'manifest_version', null, 'entries', '[]'::jsonb); end if;
  return jsonb_build_object('result', 'ok', 'manifest_version', v, 'entries', coalesce((
    select jsonb_agg(jsonb_build_object('tenant_id', m.tenant_id, 'property_id', m.property_id, 'selection_reason', m.selection_reason,
                                        'twin_status', m.twin_status, 'history_status', m.history_status) order by m.property_id)
      from public.guest_ai_shadow_manifest m where m.manifest_version = v), '[]'::jsonb));
end;
$function$;

-- 3) Inclusão no manifesto (versão ainda não ativada; imóvel real, ativo, do tenant; gêmeo e histórico verificados).
create or replace function public.shadow_manifest_add(
  p_actor uuid, p_manifest_version integer, p_tenant_id uuid, p_property_id uuid,
  p_selection_reason text, p_twin_status text, p_history_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  v_owner uuid;
  v_archived timestamptz;
begin
  if p_actor is null or p_manifest_version is null or p_manifest_version <= 0 or p_tenant_id is null or p_property_id is null then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  if p_twin_status is distinct from 'verified' or p_history_status is distinct from 'verified' then
    return jsonb_build_object('result', 'not_verified');
  end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  -- versão ativa (ou anterior) é imutável
  if c.manifest_version is not null and p_manifest_version <= c.manifest_version then
    return jsonb_build_object('result', 'version_immutable');
  end if;
  select owner_id, archived_at into v_owner, v_archived from public.properties where id = p_property_id;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_owner is null or v_owner <> p_tenant_id then return jsonb_build_object('result', 'tenant_mismatch'); end if;
  if v_archived is not null then return jsonb_build_object('result', 'archived'); end if;
  begin
    insert into public.guest_ai_shadow_manifest (manifest_version, tenant_id, property_id, selection_reason, twin_status, history_status, authorized_by)
    values (p_manifest_version, p_tenant_id, p_property_id, p_selection_reason, p_twin_status, p_history_status, p_actor);
  exception
    when unique_violation then return jsonb_build_object('result', 'duplicate');
    when check_violation then return jsonb_build_object('result', 'invalid_argument');
  end;
  return jsonb_build_object('result', 'applied');
end;
$function$;

-- 4) Configuração (CAS; nunca em ready/running; valores validados pelas CHECK; fuso real).
create or replace function public.shadow_configure(
  p_expected_version integer, p_actor uuid,
  p_model_id text, p_reasoning_effort text, p_max_input_tokens integer, p_max_output_tokens integer, p_max_total_tokens integer,
  p_max_turn_cost_usd numeric, p_daily_cost_limit_usd numeric, p_max_daily_tokens bigint, p_max_daily_calls integer,
  p_error_window_minutes integer, p_error_min_sample integer, p_budget_day_timezone text, p_telemetry_retention_days integer,
  p_tick_interval_seconds integer, p_max_conversations_per_tick integer, p_manifest_version integer
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
  if p_manifest_version is not null and not exists (select 1 from public.guest_ai_shadow_manifest where manifest_version = p_manifest_version) then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  begin
    update public.guest_ai_shadow_control set
      model_id = p_model_id, reasoning_effort = p_reasoning_effort, max_input_tokens = p_max_input_tokens, max_output_tokens = p_max_output_tokens,
      max_total_tokens = p_max_total_tokens, max_turn_cost_usd = p_max_turn_cost_usd, daily_cost_limit_usd = p_daily_cost_limit_usd,
      max_daily_tokens = p_max_daily_tokens, max_daily_calls = p_max_daily_calls, error_window_minutes = p_error_window_minutes,
      error_min_sample = p_error_min_sample, budget_day_timezone = p_budget_day_timezone, telemetry_retention_days = p_telemetry_retention_days,
      tick_interval_seconds = p_tick_interval_seconds, max_conversations_per_tick = p_max_conversations_per_tick, manifest_version = p_manifest_version,
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
     or p_reason not in ('error_rate_exceeded', 'consecutive_failures', 'budget_limit_reached', 'token_limit_violation', 'integrity_divergence', 'measurement_unavailable', 'telemetry_failure', 'config_invalid') then
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
  v_day := (now() at time zone c.budget_day_timezone)::date;
  insert into public.guest_ai_shadow_budget_days (budget_day) values (v_day) on conflict (budget_day) do nothing;
  select * into d from public.guest_ai_shadow_budget_days where budget_day = v_day for update;
  v_limit := case
    when d.settled_cost + d.reserved_cost + p_cost > c.daily_cost_limit_usd then 'daily_cost'
    when d.settled_tokens + d.reserved_tokens + p_tokens > c.max_daily_tokens then 'daily_tokens'
    when d.settled_calls + d.reserved_calls + p_calls > c.max_daily_calls then 'daily_calls'
    else null end;
  if v_limit is not null then
    perform public.guest_ai_shadow_trip_locked(c, 'budget_exhausted', 'budget_limit_reached');
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

-- 11) Registro de execução SEM lote (desfechos anteriores à reivindicação: fora do manifesto, pausa,
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
--     execução inteira (15 s), só para imóvel do manifesto ativo. Abre a linha em andamento (cerca:
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
  if not exists (select 1 from public.guest_ai_shadow_manifest m
                  where m.manifest_version = c.manifest_version and m.tenant_id = p_tenant_id and m.property_id = p_property_id) then
    return jsonb_build_object('result', 'not_in_manifest');
  end if;
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
    perform public.guest_ai_shadow_trip_locked(c, 'budget_exhausted', 'token_limit_violation');
    select * into c from public.guest_ai_shadow_control where id = 1;
  elsif (v_set->>'day_exhausted')::boolean then
    perform public.guest_ai_shadow_trip_locked(c, 'budget_exhausted', 'budget_limit_reached');
    select * into c from public.guest_ai_shadow_control where id = 1;
  end if;
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
    if (v_set->>'day_exhausted')::boolean then
      perform public.guest_ai_shadow_trip_locked(c, 'budget_exhausted', 'budget_limit_reached');
      select * into c from public.guest_ai_shadow_control where id = 1;
    end if;
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
    'public.shadow_get_control()',
    'public.shadow_get_manifest()',
    'public.shadow_manifest_add(uuid, integer, uuid, uuid, text, text, text)',
    'public.shadow_configure(integer, uuid, text, text, integer, integer, integer, numeric, numeric, bigint, integer, integer, integer, text, integer, integer, integer, integer)',
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
  -- RPCs da lista fechada: EXECUTE só para service_role (as internas ficam sem EXECUTE para ninguém)
  foreach f in array array[
    'public.shadow_get_control()',
    'public.shadow_get_manifest()',
    'public.shadow_manifest_add(uuid, integer, uuid, uuid, text, text, text)',
    'public.shadow_configure(integer, uuid, text, text, integer, integer, integer, numeric, numeric, bigint, integer, integer, integer, text, integer, integer, integer, integer)',
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
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
