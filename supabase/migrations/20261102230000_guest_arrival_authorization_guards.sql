-- GATE 0 — correções finais (02/11/2026). Aplicada em produção em 02/11/2026 (autorização formal de homologação F0+F1).
--
-- D13: integridade da LIBERAÇÃO MANUAL das credenciais (credentials_released_at/_by).
-- R6:  AUTORIZAÇÃO FORMAL de late checkout (late_checkout_time/_approved_at/_by), independente de
--      arrival_time_source (que continua sendo só a ORIGEM de uma previsão).
--
-- Regras garantidas NO BANCO (gatilho BEFORE, padrão de guard_cleaning_approval):
--  * INSERT nunca cria liberação nem autorização (campos forçados a NULL).
--  * Só identidade confiável age: usuário autenticado (auth.uid()) com papel `authenticated`, ou o
--    caminho INTERNO explícito (funções internal_* SECURITY DEFINER, executáveis só por service_role,
--    que exigem um ator humano autorizado). service_role/postgres direto, anon ou sem identidade: recusado.
--  * Autorizado = dono do imóvel, admin da plataforma (has_role admin) ou membro que enxerga o imóvel
--    E tem a permissão operacional existente `operation_edit` (mesma autoridade de manual-blocks e
--    cleaning-price). Nenhum papel novo foi criado.
--  * Autor e momento vêm do banco (auth.uid()/ator interno e now()), nunca do cliente.
--  * Mudar só o autor/momento sem liberar/revogar/aprovar = erro (adulteração).
--  * Liberação só em kind='checkin'; late checkout só em kind='checkout' e depois do checkout oficial.
--  * Histórico em public.audit_logs (trilha somente-anexo já existente; clientes não inserem).
--
-- REVERSÃO (se necessário, numa janela própria):
--   drop trigger if exists guest_arrival_status_guard_stay_authorizations on public.guest_arrival_status;
--   drop trigger if exists guest_arrival_status_log_stay_authorizations on public.guest_arrival_status;
--   drop function if exists public.guard_stay_authorizations();
--   drop function if exists public.log_stay_authorization_change();
--   drop function if exists public.internal_set_checkin_credentials_release(uuid, uuid, boolean);
--   drop function if exists public.internal_set_late_checkout(uuid, uuid, text);
--   drop function if exists public.can_manage_stay_authorizations(uuid, uuid);
--   alter table public.guest_arrival_status
--     drop constraint if exists gas_credentials_release_checkin_only,
--     drop constraint if exists gas_late_checkout_checkout_only,
--     drop constraint if exists gas_late_checkout_time_format,
--     drop constraint if exists gas_late_checkout_consistency,
--     drop column if exists late_checkout_time, drop column if exists late_checkout_approved_at,
--     drop column if exists late_checkout_by;
-- Impacto nos dados existentes: nenhum (colunas novas anuláveis; 0 linhas com liberação hoje).

-- 1) R6 — colunas da autorização formal (horário HH:MM no fuso do imóvel, na data de checkout da reserva)
alter table public.guest_arrival_status
  add column if not exists late_checkout_time text,
  add column if not exists late_checkout_approved_at timestamptz,
  add column if not exists late_checkout_by uuid references auth.users(id) on delete set null;

comment on column public.guest_arrival_status.late_checkout_time is
  'R6: horário (HH:MM, fuso do imóvel) do late checkout FORMALMENTE aprovado, na data de checkout da reserva. NULL = sem autorização. Gravado só pelo gatilho guard_stay_authorizations.';
comment on column public.guest_arrival_status.late_checkout_approved_at is 'R6: momento da aprovação (now() do banco).';
comment on column public.guest_arrival_status.late_checkout_by is 'R6: quem aprovou (identidade autenticada e autorizada).';

-- 2) Restrições de consistência (existentes: 0 linhas violam)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gas_credentials_release_checkin_only') then
    alter table public.guest_arrival_status
      add constraint gas_credentials_release_checkin_only check (credentials_released_at is null or kind = 'checkin');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gas_late_checkout_checkout_only') then
    alter table public.guest_arrival_status
      add constraint gas_late_checkout_checkout_only check (late_checkout_time is null or kind = 'checkout');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gas_late_checkout_time_format') then
    alter table public.guest_arrival_status
      add constraint gas_late_checkout_time_format check (late_checkout_time is null or late_checkout_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gas_late_checkout_consistency') then
    alter table public.guest_arrival_status
      add constraint gas_late_checkout_consistency check ((late_checkout_time is null) = (late_checkout_approved_at is null));
  end if;
end $$;

-- 3) Quem pode liberar credenciais / aprovar late checkout naquele imóvel (primitivas EXISTENTES)
create or replace function public.can_manage_stay_authorizations(_user_id uuid, _property_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select _user_id is not null
    -- Um cliente comum só pode perguntar sobre SI MESMO (impede sondar a autoridade de terceiros).
    and (coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon') or _user_id = auth.uid())
    and exists (
      select 1 from public.properties p
      where p.id = _property_id
        and (
          p.owner_id = _user_id
          or public.has_role(_user_id, 'admin'::public.app_role)
          or (
            public.member_can_see_property(_user_id, p.owner_id, p.id)
            and public.has_member_permission(_user_id, p.owner_id, 'operation_edit'::public.member_permission)
          )
        )
    );
$function$;
revoke all on function public.can_manage_stay_authorizations(uuid, uuid) from public, anon;
grant execute on function public.can_manage_stay_authorizations(uuid, uuid) to authenticated, service_role;

-- 4) Gatilho de guarda (executa com o papel de quem chamou, como guard_cleaning_approval)
create or replace function public.guard_stay_authorizations()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
DECLARE
  v_internal boolean := current_user IN ('postgres', 'supabase_admin')
                        AND coalesce(current_setting('conciergeia.internal_actor', true), '') <> '';
  v_actor uuid;
  v_official text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Criar um cartão NUNCA concede liberação nem autorização.
    NEW.credentials_released_at := NULL;
    NEW.credentials_released_by := NULL;
    NEW.late_checkout_time := NULL;
    NEW.late_checkout_approved_at := NULL;
    NEW.late_checkout_by := NULL;
    RETURN NEW;
  END IF;

  IF current_user = 'authenticated' THEN
    v_actor := auth.uid();
  ELSIF v_internal THEN
    v_actor := nullif(current_setting('conciergeia.internal_actor', true), '')::uuid;
  ELSE
    v_actor := NULL; -- service_role/postgres direto, anon, sem identidade confiável
  END IF;

  -- ── D13: liberação manual das credenciais
  IF NEW.credentials_released_at IS DISTINCT FROM OLD.credentials_released_at
     OR NEW.credentials_released_by IS DISTINCT FROM OLD.credentials_released_by THEN
    IF OLD.credentials_released_at IS NULL AND NEW.credentials_released_at IS NOT NULL THEN
      IF v_actor IS NULL THEN RAISE EXCEPTION 'credentials_release_requires_identity' USING ERRCODE = '42501'; END IF;
      IF NEW.kind IS DISTINCT FROM 'checkin' THEN RAISE EXCEPTION 'credentials_release_checkin_only' USING ERRCODE = '23514'; END IF;
      IF NOT public.can_manage_stay_authorizations(v_actor, NEW.property_id) THEN
        RAISE EXCEPTION 'credentials_release_forbidden' USING ERRCODE = '42501';
      END IF;
      NEW.credentials_released_at := now();
      NEW.credentials_released_by := v_actor;
    ELSIF OLD.credentials_released_at IS NOT NULL AND NEW.credentials_released_at IS NULL THEN
      IF v_actor IS NULL THEN RAISE EXCEPTION 'credentials_release_requires_identity' USING ERRCODE = '42501'; END IF;
      IF NOT public.can_manage_stay_authorizations(v_actor, OLD.property_id) THEN
        RAISE EXCEPTION 'credentials_release_forbidden' USING ERRCODE = '42501';
      END IF;
      NEW.credentials_released_by := NULL;
    ELSE
      RAISE EXCEPTION 'credentials_release_tamper' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.credentials_released_at IS NOT NULL AND NEW.property_id IS DISTINCT FROM OLD.property_id THEN
    RAISE EXCEPTION 'credentials_release_property_change' USING ERRCODE = '42501';
  END IF;

  -- ── R6: autorização formal de late checkout
  IF NEW.late_checkout_time IS DISTINCT FROM OLD.late_checkout_time
     OR NEW.late_checkout_approved_at IS DISTINCT FROM OLD.late_checkout_approved_at
     OR NEW.late_checkout_by IS DISTINCT FROM OLD.late_checkout_by THEN
    IF NEW.late_checkout_time IS NOT DISTINCT FROM OLD.late_checkout_time THEN
      RAISE EXCEPTION 'late_checkout_tamper' USING ERRCODE = '42501';
    END IF;
    IF v_actor IS NULL THEN RAISE EXCEPTION 'late_checkout_requires_identity' USING ERRCODE = '42501'; END IF;
    IF NOT public.can_manage_stay_authorizations(v_actor, coalesce(NEW.property_id, OLD.property_id)) THEN
      RAISE EXCEPTION 'late_checkout_forbidden' USING ERRCODE = '42501';
    END IF;
    IF NEW.late_checkout_time IS NULL THEN
      -- Revogação: invalida a autorização vigente (o histórico fica em audit_logs).
      NEW.late_checkout_approved_at := NULL;
      NEW.late_checkout_by := NULL;
    ELSE
      IF NEW.kind IS DISTINCT FROM 'checkout' THEN RAISE EXCEPTION 'late_checkout_checkout_only' USING ERRCODE = '23514'; END IF;
      IF NEW.late_checkout_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'late_checkout_invalid_time' USING ERRCODE = '22007';
      END IF;
      SELECT left(p.checkout_time, 5) INTO v_official FROM public.properties p WHERE p.id = NEW.property_id;
      IF v_official IS NULL OR v_official !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'late_checkout_requires_official_checkout' USING ERRCODE = '23514';
      END IF;
      IF NEW.late_checkout_time <= v_official THEN
        RAISE EXCEPTION 'late_checkout_must_be_after_official' USING ERRCODE = '23514';
      END IF;
      -- Aprovação nova OU alteração: sempre nova aprovação, carimbada pelo banco.
      NEW.late_checkout_approved_at := now();
      NEW.late_checkout_by := v_actor;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

drop trigger if exists guest_arrival_status_guard_stay_authorizations on public.guest_arrival_status;
create trigger guest_arrival_status_guard_stay_authorizations
  before insert or update on public.guest_arrival_status
  for each row execute function public.guard_stay_authorizations();

-- 5) Histórico (somente-anexo) em audit_logs — sem segredo nos metadados
create or replace function public.log_stay_authorization_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_internal_actor uuid := nullif(current_setting('conciergeia.internal_actor', true), '')::uuid;
  v_actor uuid := coalesce(auth.uid(), v_internal_actor);
  v_base jsonb := jsonb_build_object(
    'property_id', NEW.property_id, 'reservation_id', NEW.reservation_id, 'log_id', NEW.log_id,
    'kind', NEW.kind, 'internal', (auth.uid() IS NULL AND v_internal_actor IS NOT NULL));
BEGIN
  IF NEW.credentials_released_at IS DISTINCT FROM OLD.credentials_released_at THEN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor,
            CASE WHEN NEW.credentials_released_at IS NULL THEN 'guest_arrival_status.credentials.revoke'
                 ELSE 'guest_arrival_status.credentials.release' END,
            'guest_arrival_status', NEW.id::text,
            v_base || jsonb_build_object('released_at', NEW.credentials_released_at,
                                         'previous_released_at', OLD.credentials_released_at,
                                         'previous_released_by', OLD.credentials_released_by));
  END IF;
  IF NEW.late_checkout_time IS DISTINCT FROM OLD.late_checkout_time THEN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor,
            CASE WHEN NEW.late_checkout_time IS NULL THEN 'guest_arrival_status.late_checkout.revoke'
                 WHEN OLD.late_checkout_time IS NULL THEN 'guest_arrival_status.late_checkout.approve'
                 ELSE 'guest_arrival_status.late_checkout.change' END,
            'guest_arrival_status', NEW.id::text,
            v_base || jsonb_build_object('new_time', NEW.late_checkout_time,
                                         'previous_time', OLD.late_checkout_time,
                                         'approved_at', NEW.late_checkout_approved_at,
                                         'previous_approved_at', OLD.late_checkout_approved_at,
                                         'previous_approved_by', OLD.late_checkout_by));
  END IF;
  RETURN NULL;
END;
$function$;
revoke all on function public.log_stay_authorization_change() from public, anon, authenticated;

drop trigger if exists guest_arrival_status_log_stay_authorizations on public.guest_arrival_status;
create trigger guest_arrival_status_log_stay_authorizations
  after update on public.guest_arrival_status
  for each row execute function public.log_stay_authorization_change();

-- 6) Caminhos INTERNOS explícitos (backend com service_role, em nome de um humano autorizado)
create or replace function public.internal_set_checkin_credentials_release(_arrival_status_id uuid, _actor uuid, _release boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF _actor IS NULL OR _release IS NULL THEN RAISE EXCEPTION 'internal_actor_required' USING ERRCODE = '22004'; END IF;
  PERFORM set_config('conciergeia.internal_actor', _actor::text, true);
  UPDATE public.guest_arrival_status
     SET credentials_released_at = CASE WHEN _release THEN now() ELSE NULL END,
         credentials_released_by = CASE WHEN _release THEN _actor ELSE NULL END
   WHERE id = _arrival_status_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'arrival_status_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM set_config('conciergeia.internal_actor', '', true);
END;
$function$;
revoke all on function public.internal_set_checkin_credentials_release(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.internal_set_checkin_credentials_release(uuid, uuid, boolean) to service_role;

create or replace function public.internal_set_late_checkout(_arrival_status_id uuid, _actor uuid, _time text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'internal_actor_required' USING ERRCODE = '22004'; END IF;
  PERFORM set_config('conciergeia.internal_actor', _actor::text, true);
  UPDATE public.guest_arrival_status SET late_checkout_time = _time WHERE id = _arrival_status_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'arrival_status_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM set_config('conciergeia.internal_actor', '', true);
END;
$function$;
revoke all on function public.internal_set_late_checkout(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.internal_set_late_checkout(uuid, uuid, text) to service_role;
