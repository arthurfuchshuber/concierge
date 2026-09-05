-- 1) Liga cadastros de prestador ao login do membro da equipe com o mesmo nome
UPDATE public.service_providers sp
SET member_user_id = m.member_user_id
FROM public.account_members m
JOIN public.profiles p ON p.id = m.member_user_id
WHERE sp.member_user_id IS NULL
  AND m.owner_id = sp.account_owner_id
  AND m.status = 'active'
  AND lower(btrim(p.full_name)) = lower(btrim(sp.name))
  AND (
    SELECT count(*) FROM public.account_members m2
    JOIN public.profiles p2 ON p2.id = m2.member_user_id
    WHERE m2.owner_id = sp.account_owner_id AND m2.status = 'active'
      AND lower(btrim(p2.full_name)) = lower(btrim(sp.name))
  ) = 1;

-- 2) Garante "residência atendida" para todo vínculo imóvel x prestador com login
INSERT INTO public.property_assignments (tenant_id, property_id, user_id, status, created_by)
SELECT pp.account_owner_id, pp.property_id, sp.member_user_id, 'active', pp.created_by
FROM public.property_providers pp
JOIN public.service_providers sp ON sp.id = pp.provider_id
WHERE sp.member_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.property_assignments pa
    WHERE pa.tenant_id = pp.account_owner_id
      AND pa.property_id = pp.property_id
      AND pa.user_id = sp.member_user_id
  );