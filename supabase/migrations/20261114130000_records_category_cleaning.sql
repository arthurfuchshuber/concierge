-- "Limpeza" passa a ser uma categoria própria de registro (serviço a executar), distinta de "Auditoria"
-- (cleaning_audit, só prova). 1) aceita 'cleaning' no CHECK; 2) move para ela os registros antigos de
-- Auditoria que já abriam tarefa (agendamentos/recorrências de limpeza), que eram "Limpeza" de fato.

ALTER TABLE public.reservation_records DROP CONSTRAINT IF EXISTS reservation_records_category_check;
DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.reservation_records'::regclass
             AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%category%' LOOP
    EXECUTE format('ALTER TABLE public.reservation_records DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.reservation_records ADD CONSTRAINT reservation_records_category_check
  CHECK (category = ANY (ARRAY['forgotten','cleaning','damage','incident','cleaning_audit','maintenance','other']));

UPDATE public.reservation_records
   SET category = 'cleaning'
 WHERE category = 'cleaning_audit'
   AND task_id IS NOT NULL;
