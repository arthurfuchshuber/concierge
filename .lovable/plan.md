## 1. Botão "Editar" unificado nos quadrantes

Substituir os botões "+ Categoria" e "+ Tag" no cabeçalho de cada quadrante por um único botão **Editar** que abre um modal completo de gestão de taxonomia:

- Aba **Categorias**: criar, renomear inline, excluir, reordenar (drag-and-drop) e ver contagem de pontos por categoria.
- Aba **Tags**: criar, renomear, excluir, mover tag entre categorias.
- Persistência via as funções já existentes (`upsertPoiCategory`, `upsertPoiTag`, `deletePoiCategory`, `reorderPoiCategories`, `mergePoiCategories`).
- Mantém UX consistente entre admin do imóvel e o painel SaaS de recomendações.

## 2. Recomendações SigmaGuide por cidade (Admin SaaS)

### Nova entrada no menu lateral (abaixo de "Clientes")
**Recomendações SigmaGuide** → `/admin/recomendacoes-sigma` (visível apenas para admins SaaS via `has_role`).

### Modelo de dados (migration)
- `sigma_city_recommendations` — pontos/estabelecimentos curados por cidade.
- `sigma_city_marketplace` — links de reservas & marketplace por cidade.
- `sigma_city_faqs` — perguntas frequentes por cidade.
- `sigma_city_packs` — uma linha por cidade (`city_key`, `city_label`, `country`, `cover_url`, `is_published`, contagens agregadas, `updated_at`) que serve de "card" da listagem.
- `properties.sigma_pack_city_key` (nullable) — quando preenchido, o guia está usando o pack SigmaGuide daquela cidade (toggle ligado).

Todas com RLS: leitura pública somente do que está `is_published`; escrita restrita a `has_role(admin)`. GRANTs explícitos.

### Painel SaaS (visual)
Layout em duas camadas:

- **Dashboard topo** — cards com métricas (cidades publicadas, total de pontos curados, guias usando pack, top 5 cidades por adoção). Gráfico de barras simples (Recharts já está no projeto) por cidade.
- **Tabela de cidades** — uma linha por cidade com: nome, país, #pontos, #marketplace, #FAQs, #guias adotando, status (rascunho/publicado), ações (Editar / Publicar / Despublicar).
- **Editor da cidade** (`/admin/recomendacoes-sigma/$cityKey`) — três abas:
  1. Pontos/estabelecimentos (mesmo componente `RecGroup` já existente, reaproveitado).
  2. Reservas & Marketplace.
  3. FAQs.
- Botão **"Salvar como recomendação SigmaGuide"** dentro da edição de um guia normal (visível só para admins SaaS) — promove o conteúdo atual do guia para o pack daquela cidade.

### Importação no guia do usuário
No quadrante **"Referências na Cidade"** adicionar botão **"Usar Recomendação do SigmaGuide"**:

- Se existir pack publicado para a cidade do imóvel: dialog mostra preview (contagens + amostra) e botão "Ativar".
- Ao ativar: grava `properties.sigma_pack_city_key`, dispara import (cópia das referências da cidade + marketplace + FAQs marcadas como `source: 'sigma'`).
- Enquanto ativo: badge no topo da página de edição "Usando Recomendação SigmaGuide · [Desativar]" e **todos os campos de**: referências da cidade, reservas & marketplace e FAQs marcadas como sigma ficam visualmente bloqueados (opacity + cursor not-allowed). Tentativas de editar/excluir disparam toast: *"Enquanto seu guia usar a Recomendação do SigmaGuide, este conteúdo não pode ser alterado. Desative a recomendação para personalizar."*
- "Aqui pertinho" continua editável (é hiperlocal).
- Ao desativar: snapshot do conteúdo anterior é restaurado (guardamos `properties.sigma_pack_snapshot` em jsonb antes de importar).

## 3. Onboarding (primeiro guia do usuário)

Sistema de tooltips elegantes usando o `Popover` do shadcn já presente, com posicionamento contextual:

- Detecção: se `count(properties where owner_id = uid) == 0` ao abrir o wizard, ativa o tour.
- Persistência: campo `profiles.onboarding_completed_at`.
- Tooltips: 1–2 por etapa do wizard (Cliente, Imóvel, Acesso, Manual, Recomendações, FAQs, Revisão), foco no objetivo da etapa (não em cada campo).
- **Etapa Recomendações** recebe tooltip especial persuasivo destacando o botão "Usar Recomendação do SigmaGuide" com copy do tipo: *"Nossa equipe curou os melhores pontos desta cidade. Importe com 1 clique e personalize depois se quiser."*
- Cada tooltip tem: título curto, descrição (1–2 linhas), botões **Entendi** / **Pular tour** / contador (1 de 8).

## 4. Detalhes técnicos

- Migrations Supabase (com GRANTs e RLS) para as 4 tabelas + 2 colunas em `properties` + 1 coluna em `profiles`.
- Server functions: `src/lib/sigma-recommendations.functions.ts` (CRUD admin + listagem pública + ativar/desativar pack no guia).
- Componentes novos:
  - `src/components/admin/TaxonomyEditDialog.tsx` (modal Editar do item 1).
  - `src/components/admin/SigmaPackCard.tsx`, `SigmaPackImportDialog.tsx`.
  - `src/components/onboarding/OnboardingTour.tsx` + `useOnboarding` hook.
- Rotas novas:
  - `src/routes/_authenticated/admin.recomendacoes-sigma.index.tsx`
  - `src/routes/_authenticated/admin.recomendacoes-sigma.$cityKey.tsx`
- Edição de `admin.properties.$id.tsx` para: trocar 2 botões por "Editar", adicionar bloqueio visual quando `sigma_pack_city_key` está ativo, adicionar dialog de importação, integrar onboarding.
- Acesso restrito por `has_role(admin)` em todas as rotas/funções de escrita do pack.

## 5. Ordem de implementação

1. Migration (tabelas + colunas + RLS + GRANTs).
2. Server functions de recomendações SigmaGuide.
3. Painel admin SaaS (rotas + dashboard + editor).
4. Botão "Editar" unificado (modal de taxonomia).
5. Import/lock no guia do usuário.
6. Sistema de onboarding com tooltips.

Posso seguir?