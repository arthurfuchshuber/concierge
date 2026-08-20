---
name: Sistema de Design — ConciergeIA (visão do cliente)
description: Regra obrigatória de tipografia, espaçamento (base 4px), botões (36px, tamanho único), comportamento mobile de ícone-vs-texto, card padrão e consolidação de barras de ação/filtros em todo o produto
type: design
---

Documento oficial de layout do produto (visão do cliente). Vale para TODAS as telas
(painel admin e guia). Não muda cores nem fontes existentes (Manrope + Sora): padroniza
tamanho, peso, espaçamento e aplicação.

## Escala tipográfica (usar exatamente estes papéis)
| Papel | Fonte / peso | Tamanho | Observação |
| --- | --- | --- | --- |
| Page Title | Sora 700 | 22px | letter-spacing -0.01em |
| Page Subtitle | Manrope 400 | 13px | cor muted |
| Section Title | Sora 700 | 15px | |
| Card Title | Sora 700 | 13.5px | |
| Body | Manrope 500 | 13px | corpo padrão, listas e descrições |
| Meta / Support | Manrope 500 | 12px | cor muted (datas, códigos) |
| Eyebrow / Label | Manrope 700 | 10.5px | UPPERCASE, cor de destaque |

Nada de tamanhos fora dessa escala. Título de página nunca compete com título de card.

## Escala de espaçamento (base 4px)
- 4px — gap ícone ↔ texto
- 8px — gap interno compacto (badges, chips)
- 12px — gap padrão entre itens relacionados
- 16px — padding interno de card · gap entre cards (denso)
- 20px — padding interno de card (confortável)
- 24px — gap entre título de seção e conteúdo
- 32px — gap entre seções da página
- 40px — Page Header → primeiro conteúdo

## Botões — um tamanho só
- Altura fixa **36px** em toda a interface, sem variação por contexto (inclusive o botão
  de ícone/kebab: 36×36px). Menos decisão, mais consistência.
- Variantes: "Ação padrão" (neutro/outline) e "Ação primária" (destaque). Ícone-only para
  ações secundárias/kebab.

## Mobile — ícone substitui a palavra
- Desktop (com espaço): ícone + texto ("📍 Ver no mapa", "⋮ Mais opções").
- Mobile (compacto): se o ícone é universalmente reconhecível (mapa, mais opções, fechar,
  copiar, editar), o texto cai — o botão vira só o ícone, mesmo alvo de toque (36×36px).
- Se o ícone sozinho for ambíguo (ex.: "Assumir conversa", "Reabrir"), o texto permanece
  mesmo no mobile.

## Card padrão
- Título do card (Sora 700 13.5px) → descrição de apoio de no máximo 2 linhas, tom neutro
  → linha de ações (ação padrão + kebab) na base.
- Padding interno 16px (denso) ou 20px (confortável).

## Nunca 2 linhas de botões/opções
- Barra de ações/filtros/abas **nunca quebra em segunda linha** e nunca esconde itens atrás
  de "mais" prematuramente: **rola horizontalmente**, com esmaecimento sutil na borda
  indicando que há mais conteúdo. O usuário sempre sabe que pode arrastar/deslizar; nunca
  achar que "acabou ali".

## Botões espalhados vs. consolidados
- ANTES (errado): vários botões soltos lado a lado (Data, Status, ícone, Ordenar, Exportar).
- DEPOIS (certo): consolidar em **um único acionador** ("Filtros" com badge de contagem dos
  filtros ativos) + kebab para o resto. Menos ruído, decisão única.

## Refinamento executivo — bordas e densidade
- Raio de borda de contêineres estruturais (card, item de acordeão, painel, linha de
  lista) reduzido para 8px (era ~12–20px / efeito "pílula" em alguns lugares). Botões,
  badges de status e chips de filtro NÃO mudam — não fazem parte desta regra.
- Gap entre cards/itens irmãos de uma mesma lista reduzido para 6px (era 12–16px) —
  visual mais denso e executivo.
- Isso não altera os espaçamentos "título → conteúdo": os 24px (seção) e 32/40px
  (página) da escala de espaçamento acima permanecem exatamente como estão.
