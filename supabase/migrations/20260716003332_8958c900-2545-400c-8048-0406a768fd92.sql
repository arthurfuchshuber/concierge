
INSERT INTO public.account_members (owner_id, member_user_id, role, status, invited_by)
VALUES ('25239e5b-1a66-46f1-b9a2-829c499cc366', 'ad2c848e-7395-4cba-ab9e-db697ccd94d3', 'owner', 'active', '25239e5b-1a66-46f1-b9a2-829c499cc366')
ON CONFLICT (owner_id, member_user_id) DO UPDATE SET role=EXCLUDED.role, status='active', updated_at=now();

UPDATE public.account_member_invites
SET status='accepted', accepted_user_id='ad2c848e-7395-4cba-ab9e-db697ccd94d3', accepted_at=now()
WHERE id='89d710f6-c21f-480a-a853-aba69d30f7fc';
