-- "Descrição curta" em texto livre, separada de `tagline` — `tagline` é o
-- seletor fixo "Tipo do guia" (Check-in & Check-out / Recomendações Locais /
-- Informações do Espaço) e não um campo de texto. A importação do Airbnb
-- estava gravando a descrição do anúncio direto em `tagline`, o que deixava
-- o seletor "sem seleção" na tela (bug encontrado em 03/09/2026 — corrigido
-- passando a gravar aqui, em `short_description`, em vez de `tagline`).
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS short_description TEXT;
