
-- 1) Trigger para auto-aceitar convite de admin no signup
DROP TRIGGER IF EXISTS on_auth_user_created_admin_invite ON auth.users;
CREATE TRIGGER on_auth_user_created_admin_invite
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.accept_admin_invite_on_signup();

-- 2) Backfill: para todo usuário existente que tem convite pendente, promover a admin
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT u.id AS uid, u.email, i.id AS inv_id
    FROM auth.users u
    JOIN public.admin_invites i ON lower(i.email) = lower(u.email)
    WHERE i.status = 'pending'
  LOOP
    INSERT INTO public.user_roles (user_id, role) VALUES (r.uid, 'admin')
      ON CONFLICT DO NOTHING;
    UPDATE public.admin_invites
      SET status = 'accepted', accepted_user_id = r.uid, accepted_at = now(), updated_at = now()
      WHERE id = r.inv_id;
    INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, metadata)
      VALUES (r.uid, r.email, 'admin_invite.accepted_backfill', 'admin_invites', r.inv_id::text, '{}'::jsonb);
  END LOOP;
END $$;
