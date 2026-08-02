ALTER TABLE public.stakeholder_link_aliases
  DROP CONSTRAINT stakeholder_link_aliases_alias_kind_check;

ALTER TABLE public.stakeholder_link_aliases
  ADD CONSTRAINT stakeholder_link_aliases_alias_kind_check
  CHECK (alias_kind = ANY (ARRAY['email'::text, 'domain'::text, 'doc'::text, 'name'::text, 'event'::text, 'title'::text]));