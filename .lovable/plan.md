# Categorias e Tags editáveis (globais)

## Conceito

Hoje existem dois níveis fixos hard-coded em `src/lib/maps.functions.ts` (`TYPE_MAP`):

- **Categoria-agrupadora** (rótulo do bloco no guia): `Atrações`, `Bares`, `Compras`, `Outros`, etc.
- **Tag** (`type` do ponto): `attraction`, `bar`, `restaurant`, `park`, `shopping`, `other`...

Cada tag conhece os `placesTypes` (busca) e `acceptedPrimaryTypes` (classificação) do Google — é o que faz a IA classificar corretamente.

O plano transforma esses dois níveis em dados editáveis no banco, **preservando** as tags-base do Google como protegidas (não excluíveis), e permitindo:

- Renomear categoria de qualquer tag (inclusive das tags-base).
- Criar tags novas vinculadas a uma categoria + mapeamento Google (para a IA continuar classificando).
- Criar/renomear/excluir categorias customizadas.
- Excluir tags customizadas (tags-base ficam protegidas).

## Estrutura de dados (2 tabelas novas globais)

`public.poi_categories`
- `id`, `slug` (único), `label` (pt-BR), `display_order`, `is_protected` (boolean — categorias-base não podem ser excluídas), `created_at`, `updated_at`

`public.poi_tags`
- `id`, `slug` (único — é o que vai em `recommendations.type`), `label` (pt-BR), `category_id` (FK obrigatória), `accepted_primary_types` (text[]), `places_types` (text[]), `query_variants` (text[]), `min_reviews` (int, default 150), `is_protected` (boolean), `display_order`, `created_at`, `updated_at`

Seed inicial replica o `TYPE_MAP` atual com `is_protected=true` para as 11 tags-base + categorias-base.

RLS: leitura `TO anon, authenticated`; escrita só admin (`has_role(uid, 'admin')`).

## Mudanças no código

### Backend — `src/lib/maps.functions.ts` e `city-references.functions.ts`
- Substituir `TYPE_MAP` constante por `loadTypeMap()` que lê de `poi_tags` + `poi_categories` (com cache em memória de 60s por execução, já que é serverless).
- Funções `inferCategoryFromPrimaryType`, `classifyByPrimaryType`, geração via Gemini e ranking continuam idênticas — só passam a iterar sobre o array carregado do banco. Tags-base mantêm seu mapping → IA não muda comportamento.
- Tags customizadas com `accepted_primary_types` preenchidos entram automaticamente na classificação. Sem mapping, ficam disponíveis só para classificação manual no dropdown.

### Frontend — guia público (`g.$slug.explorar.tsx`)
- `TYPE_LABEL` e cores deixam de ser objeto literal: server fn `getPoiTaxonomy()` (público, anon) devolve `{ tags: [{slug,label,categoryLabel,color}], categories: [...] }`.
- Render usa `tag.label` (já capitalizado).

### Frontend — painel admin (card "Pela cidade" em `admin.properties.$id.tsx` + `admin.cidades.$cityKey.tsx`)
- Dropdown de tag passa a listar tags do banco, agrupadas por categoria.
- Cabeçalho de cada categoria-agrupadora (`Atrações (10/30)`) ganha um pequeno ícone de lápis ao lado do nome → abre popover inline para renomear (categorias-base só permitem renomear, não excluir).
- Dentro do dropdown de tags, cada item ganha mini-ícone de lápis ao lado (hover); abre popover para renomear. Tags customizadas têm também ícone de lixeira.
- Botão `+ Nova tag` no rodapé do dropdown → modal com: nome, categoria (select), mapping Google avançado (collapsible: primary types + places types + query variants + min reviews). Defaults sensatos para usuário leigo.
- Botão `+ Nova categoria` no topo da lista do dropdown → input inline.

### Página dedicada de gestão (acessível, mas não obrigatória no fluxo)
- Nova rota `_authenticated/admin.taxonomia.tsx` (item no sidebar "Admin SaaS" → "Categorias & Tags") com visão tabular completa: lista de categorias, expandindo para tags-filhas, com edição inline + drag-to-reorder. Para quem prefere editar fora do fluxo de ponto.

## Decisão visual (anti-poluição)

- Ícone de edição: lápis 12px, `opacity-0 group-hover:opacity-60`, só aparece ao hover do item. Zero ruído no estado padrão.
- Edição é sempre **inline** (popover ou input que substitui o label), nunca abre página/modal pesado para renomear.
- Modal só para "criar tag nova" (precisa do mapping Google) e "criar categoria nova".
- Categorias-base e tags-base têm um cadeado discreto no popover de edição explicando "Esta é uma tag padrão — você pode renomear ou mudar a categoria, mas não excluir, porque a IA usa para classificar pontos do Google."

## Migração e compatibilidade

- Dados existentes em `city_references.type` e `property_recommendations.type` continuam funcionando: os slugs são os mesmos do `TYPE_MAP` atual.
- Renomear o `label` de uma tag-base afeta apenas exibição; o `slug` (`attraction`, `bar`...) é imutável para tags protegidas.

## Arquivos afetados

- **Novo**: `supabase/migrations/<ts>_poi_taxonomy.sql` (2 tabelas + seed + RLS + grants)
- **Novo**: `src/lib/poi-taxonomy.functions.ts` (CRUD + `getPoiTaxonomy` público)
- **Novo**: `src/components/admin/TaxonomyManager.tsx` (página dedicada)
- **Novo**: `src/components/admin/TagPicker.tsx` (dropdown com edição inline, substitui o `<select>` atual)
- **Novo rota**: `src/routes/_authenticated/admin.taxonomia.tsx`
- **Editado**: `src/lib/maps.functions.ts` (TYPE_MAP → loadTypeMap)
- **Editado**: `src/lib/city-references.functions.ts`
- **Editado**: `src/routes/g.$slug.explorar.tsx` (taxonomy via server fn)
- **Editado**: `src/routes/_authenticated/admin.properties.$id.tsx` e `admin.cidades.$cityKey.tsx` (usar TagPicker)
- **Editado**: `src/routes/_authenticated/admin.tsx` (item de menu)

## O que NÃO muda

- Lógica de geração por IA (prompts, dedupe, ranking) — só a fonte do `TYPE_MAP` muda.
- Estrutura de `city_references` e `property_recommendations`.
- Real-time de sincronização entre guias.

Aprovado? Sigo com a migration primeiro, depois código.
