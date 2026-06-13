ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS etiqueta_options text[] NOT NULL
  DEFAULT ARRAY['Check-In & Check-Out','Recomendações Locais','Informações do Espaço']::text[];