# Plano: Unificação de Recomendações, Vínculos entre Guias e Filtros Mobile

Mudanças amplas com dependências entre si. Implementação dividida em 4 frentes — backend (DB + lógica), painel admin, guia público e UX de filtros.

---

## 1. Painel admin: busca única + decisão automática + movimentação

**Arquivo:** `src/routes/_authenticated/admin.properties.$id.tsx`

- Remover os dois campos `PlacesSearch` separados dos quadrantes "Aqui Pertinho" e "Pela cidade".
- Criar um **único campo de busca acima dos dois quadrantes**, fora deles.
- Após seleção, o backend decide o destino usando as regras já existentes:
  - **Aqui Pertinho** (`scope: 'nearby'`): ≤ 1,5 km do imóvel **ou** ≤ 20 min a pé.
  - **Referências na Cidade** (`city_references`): demais casos, desde que rating ≥ 4.5 e ≥ 500 avaliações (regra atual).
  - Se não atender nenhum critério → cair em Referências mesmo assim (decisão automática, sem prompt).
- **Movimentação manual** (sobrepõe a decisão automática):
  - Cada card ganha um botão de menu (⋯) com "Mover para [outro quadrante]".
  - **Seleção múltipla**: checkbox em cada card + barra de ação flutuante ("Mover N itens para…", "Excluir").
  - Mover entre quadrantes = mudar de tabela (`property_recommendations` ↔ `city_references`) preservando metadata.

**Novas server functions** em `src/lib/recommendations-move.functions.ts`:
- `addPlaceAuto({ propertyId, placeId })` — busca dados no Google, calcula distância, decide destino, insere.
- `moveRecommendations({ ids[], from, to })` — move itens em massa entre `property_recommendations` e `city_references`.

---

## 2. Vínculos entre guias (Referências na Cidade compartilhadas)

**Novo modelo de dados** (migração):

```sql
-- Grupo de guias que compartilham city_references
CREATE TABLE public.city_reference_groups (
  id uuid PK,
  name text,           -- "Foz do Iguaçu — Grupo principal" (editável)
  city_key text,       -- denormalizado p/ filtros
  owner_id uuid,       -- criador
  created_at, updated_at
);

-- N:N entre properties e groups (uma property pertence a 0..1 grupo por enquanto)
CREATE TABLE public.city_reference_group_members (
  group_id uuid FK,
  property_id uuid FK UNIQUE,  -- impede pertencer a 2 grupos
  joined_at
);

-- city_references ganha group_id (nullable). Quando preenchido, a lista é do grupo.
ALTER TABLE public.city_references ADD COLUMN group_id uuid REFERENCES city_reference_groups(id);
```

**Resolução de lista:**
- Se a property pertence a um grupo → lê/escreve em `city_references WHERE group_id = X` (a coluna `city_key` deixa de ser usada para essa property).
- Se não pertence → comportamento atual (lê por `city_key`).
- Não há mais "lista local + compartilhada" misturada. Pertencer ao grupo = lista única do grupo.

**UI no quadrante "Referências na Cidade":**
- Botão no topo: **"Linkar demais guias"**.
- Modal com 3 abas:
  1. **Guias vinculados** (atuais, com botão remover).
  2. **Adicionar guias** (busca por nome/cidade, multi-select, "Adicionar todos da cidade X").
  3. **Sair do grupo** (a property fica sem grupo, lista volta a ser por city_key).
- Qualquer membro pode editar, adicionar, remover, reordenar — sem conceito de "dono".
- Realtime: `useCityReferencesRealtime` passa a escutar por `group_id` quando aplicável.

**Migração de dados:** properties existentes ficam sem grupo (comportamento atual preservado por `city_key`).

---

## 3. Unificação de categorias

**Nova server fn** `mergePoiCategories({ categoryIds[] })` em `src/lib/poi-taxonomy.functions.ts`:
- Cria uma nova categoria com nome `"Restaurantes, Bares"` (join dos nomes por `, `).
- Move todas as tags das categorias originais para a nova.
- Re-aponta `property_recommendations.type` e `city_references.type` para a nova categoria.
- Deleta as categorias originais (não-protegidas).
- Nome continua editável inline (`updatePoiCategory`).

**UI em `/admin/taxonomia`:**
- Checkboxes nas categorias + botão "Unificar selecionadas" (≥ 2).
- Confirmação com preview do nome resultante.

---

## 4. Cron: atualizar TUDO, exceto nome

**Arquivo:** `src/lib/maps.functions.ts` (`refreshStaleRecommendations`, `refreshStaleCityReferencesByPlaceId`).

- Remover a janela de `last_synced_at` (passa a atualizar **todos** os registros com `place_id`).
- O cron agenda em lotes (chunks de N por execução, paginação por `last_synced_at` asc) para caber no orçamento de 50 s.
- **Nunca sobrescrever `name`** — remover esse campo do `UPDATE` payload em ambos os refreshers.
- Demais campos (rating, reviews count, hours, image, address, coords) seguem atualizando.

---

## 5. Filtros mobile — redesign completo

**Problema atual:** 3 linhas de chips empilhados (ordenação, proximidade, avaliações + toggle de view) ocupam ~200 px verticais no mobile.

**Nova proposta:**
- **Barra única sticky** no topo da listagem com:
  - Campo de busca (já existe) à esquerda.
  - Botão **"Filtros"** à direita com badge de contagem ativa (ex: "Filtros · 2").
  - Toggle grid/lista compacto ao lado.
- Clicar em "Filtros" abre um **bottom sheet** (mobile) / **popover** (desktop) contendo:
  - Ordenação (Distância / Avaliação / A-Z) — segmented control.
  - Mínimo de avaliações (Todas, 50+, 200+, 1k+, 5k+) — chips em grid.
  - Proximidade (Pertinho / Referências na Cidade) — toggles.
  - Botão "Limpar filtros" + "Aplicar".
- **Chip de filtros ativos** abaixo da barra (removível individualmente) quando há filtros aplicados — feedback rápido sem precisar reabrir o sheet.
- Aplicado de forma idêntica em `/g/$slug/explorar` (categoria) e na home `Explore a Região`.

**Componente novo:** `src/components/guide/FilterSheet.tsx` — reutilizado nas duas telas.

---

## Ordem de execução

1. Migração DB (grupos + `group_id` em city_references).
2. Server functions: `addPlaceAuto`, `moveRecommendations`, `mergePoiCategories`, grupos CRUD.
3. Refactor cron (remover `name` do update, remover filtro de stale).
4. Refactor admin properties: busca única + checkbox/mover + UI de grupos.
5. Refactor public guide: leitura via grupo + componente `FilterSheet`.
6. Refactor `/admin/taxonomia`: unificação.

## Notas técnicas

- `city_references` mantém `city_key` para fallback (guias sem grupo).
- Realtime channel name muda quando há grupo: `city-references:group:{id}` vs `city-references:{cityKey}`.
- Autosave (3 s debounce) continua aplicável às edições de itens — não interfere nos movimentos (que são ações explícitas e imediatas).
- Seleção múltipla persiste no estado do componente; barra de ação aparece quando `selected.size > 0`.
- Bottom sheet usa shadcn `Drawer` no mobile e `Popover` no desktop (detecção via `useIsMobile`).
