CREATE OR REPLACE FUNCTION public.accept_admin_invite_on_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inv_id uuid;
BEGIN
  -- Só promove contas com e-mail já confirmado: impede que alguém se cadastre
  -- com o e-mail de um convite pendente sem ser o dono desse e-mail.
  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO inv_id FROM public.admin_invites
    WHERE lower(email) = lower(NEW.email) AND status = 'pending'
    LIMIT 1;
  IF inv_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT DO NOTHING;
    UPDATE public.admin_invites
      SET status = 'accepted', accepted_user_id = NEW.id, accepted_at = now(), updated_at = now()
      WHERE id = inv_id;
    INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, metadata)
    VALUES (NEW.id, NEW.email, 'admin_invite.accepted', 'admin_invites', inv_id::text, '{}'::jsonb);
  END IF;
  RETURN NEW;
END;
$function$;