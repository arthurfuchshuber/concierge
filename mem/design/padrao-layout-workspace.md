---
name: Padrão de layout Workspace (referência: página Operação)
description: Cabeçalho + segmented control + botões padrão a serem replicados página a página (Guias já aplicado)
type: design
---

Referência oficial: página "Operação" (`OperationWorkspace`). Componente reutilizável:
`src/components/ds/WorkspaceHeader.tsx`.

## Cabeçalho
- Título `ds-page-title` (Sora 700, 22px), truncado em 1 linha.
- Subtítulo `ds-page-subtitle` (Manrope 13px, muted) com `mt-1.5`.
- Sem eyebrow, sem botões soltos ao lado do título.

## Barra de menu (segmented control)
- `flex w-full overflow-hidden rounded-[0.3rem] bg-foreground/5`, `mb-5`.
- Cada aba: `flex-1`, `min-h-[46px]`, `text-sm font-semibold`, centralizada.
- Aba ativa: `bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white`.

## Filtros/ações
- Uma única linha abaixo do menu, alinhada à direita, altura 36px,
  cantos 0.3rem, ícone 14px (referência: botão "Hoje" do Kanban).
- Nunca quebrar em 2 linhas: rolagem horizontal.

## Cards
- Cantos 0.3rem, bordas sutis, informações empilhadas uma por linha,
  mesma fonte 12px; ações agrupadas em kebab + botão destrutivo isolado.

## Replicação
Ordem acordada: Operação (base) → Guias (feito) → demais páginas, uma a uma.
Na entrada de cada página, remover blocos de "plano e uso" até serem
reimplementados no padrão novo.
