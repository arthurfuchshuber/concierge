UPDATE public.permission_nodes c
SET parent_id = p.id
FROM public.permission_nodes p
WHERE position('.' in c.slug) > 0
  AND p.slug = regexp_replace(c.slug, '\.[^.]+$', '')
  AND c.parent_id IS DISTINCT FROM p.id;