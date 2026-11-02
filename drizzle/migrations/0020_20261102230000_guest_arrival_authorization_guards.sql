alter table public.guest_arrival_status
  add column if not exists late_checkout_time text,
  add column if not exists late_checkout_approved_at timestamptz,
  add column if not exists late_checkout_by uuid references auth.users(id) on delete set null;
comment on column public.guest_arrival_status.late_checkout_time is
  'R6: horário (HH:MM, fuso do imóvel) do late checkout FORMALMENTE aprovado, na data de checkout da reserva. NULL = sem autorização. Gravado só pelo gatilho guard_stay_authorizations.';
comment on column public.guest_arrival_status.late_checkout_approved_at is 'R6: momento da aprovação (now() do banco).';
comment on column public.guest_arrival_status.late_checkout_by is 'R6: quem aprovou (identidade autenticada e autorizada).';
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
create or replace function public.can_manage_stay_authorizations(_user_id uuid, _property_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select _user_id is not null
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
