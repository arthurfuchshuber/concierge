-- Objetos esquecidos sem custo não são serviço extra tarifado.
UPDATE public.tasks
SET situation = NULL
WHERE title ILIKE 'Objeto esquecido%'
  AND (amount_spent_cents IS NULL OR amount_spent_cents = 0);
