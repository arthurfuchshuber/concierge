-- 1) Normalize existing values to digits-only.
UPDATE public.profiles
   SET cpf = regexp_replace(cpf, '\D', '', 'g')
 WHERE cpf IS NOT NULL AND cpf <> regexp_replace(cpf, '\D', '', 'g');

UPDATE public.profiles
   SET phone = regexp_replace(phone, '\D', '', 'g')
 WHERE phone IS NOT NULL AND phone <> regexp_replace(phone, '\D', '', 'g');

-- 2) Resolve existing duplicates by clearing the CPF on the newest profile
--    that does NOT have an active subscription (keeps the paying account intact).
WITH ranked AS (
  SELECT
    p.id,
    regexp_replace(p.cpf, '\D', '', 'g') AS cpf_digits,
    EXISTS (
      SELECT 1 FROM public.subscriptions s
       WHERE s.user_id = p.id
         AND s.status IN ('active','trialing','past_due')
    ) AS has_sub,
    p.created_at,
    row_number() OVER (
      PARTITION BY regexp_replace(p.cpf, '\D', '', 'g')
      ORDER BY
        EXISTS (
          SELECT 1 FROM public.subscriptions s
           WHERE s.user_id = p.id
             AND s.status IN ('active','trialing','past_due')
        ) DESC,
        p.created_at ASC
    ) AS rn
  FROM public.profiles p
  WHERE p.cpf IS NOT NULL
    AND length(regexp_replace(p.cpf, '\D', '', 'g')) >= 11
)
UPDATE public.profiles p
   SET cpf = NULL
  FROM ranked r
 WHERE p.id = r.id
   AND r.rn > 1;

-- Same treatment for duplicate phones.
WITH ranked AS (
  SELECT
    p.id,
    row_number() OVER (
      PARTITION BY regexp_replace(p.phone, '\D', '', 'g')
      ORDER BY
        EXISTS (
          SELECT 1 FROM public.subscriptions s
           WHERE s.user_id = p.id
             AND s.status IN ('active','trialing','past_due')
        ) DESC,
        p.created_at ASC
    ) AS rn
  FROM public.profiles p
  WHERE p.phone IS NOT NULL
    AND length(regexp_replace(p.phone, '\D', '', 'g')) >= 8
)
UPDATE public.profiles p
   SET phone = NULL, phone_country = NULL
  FROM ranked r
 WHERE p.id = r.id
   AND r.rn > 1;

-- 3) Enforce uniqueness with partial indexes on the normalized digits.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_cpf_unique_digits
  ON public.profiles ((regexp_replace(cpf, '\D', '', 'g')))
  WHERE cpf IS NOT NULL AND length(regexp_replace(cpf, '\D', '', 'g')) >= 11;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_unique_digits
  ON public.profiles ((regexp_replace(phone, '\D', '', 'g')))
  WHERE phone IS NOT NULL AND length(regexp_replace(phone, '\D', '', 'g')) >= 8;
