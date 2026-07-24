
UPDATE public.account_members
   SET role = 'agent', updated_at = now()
 WHERE role = 'owner' AND member_user_id <> owner_id;

UPDATE public.account_member_invites
   SET role = 'agent', updated_at = now()
 WHERE role = 'owner';

ALTER TABLE public.account_members
  DROP CONSTRAINT IF EXISTS account_members_owner_role_only_for_owner;
ALTER TABLE public.account_members
  ADD CONSTRAINT account_members_owner_role_only_for_owner
  CHECK (role <> 'owner' OR member_user_id = owner_id);

ALTER TABLE public.account_member_invites
  DROP CONSTRAINT IF EXISTS account_member_invites_role_not_owner;
ALTER TABLE public.account_member_invites
  ADD CONSTRAINT account_member_invites_role_not_owner
  CHECK (role <> 'owner');
