## Objetivo

Criar um novo tipo de recomendação **macro por cidade** (ex.: "Ponte Hercílio Luz" em Florianópolis) que:

- É **compartilhada** entre todas as propriedades da mesma `cidade + estado`.
- Vive em **aba/categoria própria** no guia público ("Referências em [Cidade]"), separada das recomendações "pertinho da residência".
- É gerada de forma **híbrida**: o sistema gera automaticamente via Gemini + Google Maps, e o admin pode editar, adicionar ou remover manualmente.
- É renovada por um **job automático periódico** (semanal).

As recomendações atuais (`property_recommendations`) continuam exclusivas de cada residência — nada muda no racional do "pertinho".

---

## 1. Modelo de dados

Nova tabela `public.city_references` no Supabase:

- Chave de cidade: `city` (texto normalizado, ex.: "florianopolis"), `state` (UF), `country` (default "BR"), `city_label` (label de exibição, ex.: "Florianópolis").
- Categoria: `category` (mesma enum/valores das categorias atuais — bares_restaurantes, pontos_turisticos, etc.).
- Dados do lugar (mesmo shape de `property_recommendations`): `place_id`, `name`, `description`, `address`, `rating`, `user_ratings_total`, `price_level`, `primary_type`, `lat`, `lng`, `photo_url`, `maps_url`, `website`, `phone`.
- Curadoria: `source` (`auto` | `manual`), `is_hidden` (admin pode esconder sem deletar), `display_order`.
- Índice único: `(city, state, place_id)` para evitar duplicatas por cidade.
- RLS: leitura pública (anon + authenticated), escrita só por `service_role` e admins (via `has_role`).

Também adicionar coluna `city_refs_last_refreshed_at` em uma nova tabela de controle `public.city_reference_jobs` para saber quando cada cidade foi atualizada pela última vez — evita re-rodar a mesma cidade quando várias residências da mesma cidade existem.

## 2. Geração híbrida

**Server function** `generateCityReferences({ city, state })`:

1. Reaproveita o pipeline atual de `maps.functions.ts` (Gemini sugere lista por categoria + valida no Google Places New).
2. Aplica os mesmos filtros de qualidade: 200+ avaliações, rating ≥ 4.0, foto landscape ≥ 1600px, `primaryType` válido para a categoria.
3. **Escopo macro**: o prompt do Gemini passa a pedir "pontos icônicos / referências da cidade inteira" (e não "perto deste endereço"). Sem `locationBias` por coordenada — busca por `textQuery` na cidade.
4. Faz `upsert` em `city_references` com `source='auto'`, preservando registros `source='manual'` e respeitando `is_hidden`.

**Admin UI** (nova página `/admin/cidades/[cidade-uf]`):

- Lista todas as referências da cidade agrupadas por categoria.
- Botões: "Gerar com IA", "Adicionar manualmente", editar, ocultar, remover.
- Mostra `last_refreshed_at` e botão "Atualizar agora".

## 3. Exibição no guia público

Nova aba/categoria **"Referências em [Cidade]"** em `src/routes/g.$slug.explorar.tsx`:

- Aparece ao lado das categorias atuais (Bares, Pontos Turísticos, etc.).
- Carrega de `city_references` filtrando por `(city, state)` da propriedade.
- Mesma UI de capa (foto do lugar com mais avaliações) e cards.
- Só renderiza se houver pelo menos 1 referência cadastrada para a cidade (regra do core: campo vazio = ocultar).

As recomendações de raio próximo continuam exatamente como estão, em `property_recommendations`.

## 4. Refresh automático periódico

Novo endpoint `src/routes/api/public/cron.refresh-city-references.ts`:

- Lista todas as cidades distintas com propriedades ativas.
- Para cada cidade não atualizada nos últimos 7 dias, dispara `generateCityReferences`.
- Job `pg_cron` semanal (domingos 3h) chamando o endpoint com `apikey` header.

## 5. Mudanças nos arquivos

- `supabase/migrations/...`: criar tabelas `city_references` e `city_reference_jobs` com GRANTs, RLS e policies.
- `src/lib/city-references.functions.ts`: server functions `getCityReferences`, `generateCityReferences`, `upsertCityReference`, `deleteCityReference`, `toggleHideCityReference`.
- `src/lib/maps.functions.ts`: extrair função genérica `searchPlacesForCategory({ textQuery, category, locationBias? })` para reaproveitar no escopo cidade (sem bias).
- `src/routes/admin.cidades.$cityKey.tsx`: nova página de admin para gerenciar referências da cidade.
- `src/routes/admin.properties.$id.tsx`: adicionar link "Gerenciar referências da cidade" ao lado de "Sincronizar com Google".
- `src/routes/g.$slug.explorar.tsx`: adicionar nova aba "Referências em [Cidade]".
- `src/routes/api/public/cron.refresh-city-references.ts`: endpoint de refresh.
- `supabase/insert` (via tool): agendar `pg_cron` semanal.

## 6. Critérios de aceite

- Cadastrar duas propriedades em Florianópolis → ambas mostram a mesma lista em "Referências em Florianópolis".
- Cadastrar uma propriedade em outra cidade → não vê as referências de Florianópolis.
- Admin esconde uma referência → some no guia público sem reaparecer no próximo refresh automático.
- Admin adiciona manualmente uma referência → persiste mesmo após refresh automático.
- Aba só aparece quando há pelo menos 1 referência ativa para a cidade.
- Filtros de qualidade do racional atual (200+ avaliações, fotos landscape de alta resolução, categoria correta) continuam valendo.

Posso seguir com a implementação?