# Pendências, Resolver pendência e auditoria do Dashboard

## 1. Lista de pendências (print 1)
- Novo cabeçalho no topo da janela, fixo enquanto a lista rola:
  - selo com o ícone do imóvel + **nome do imóvel** (quebra linha se for longo, nunca corta)
  - linha secundária: **proprietário** · cidade
  - chips à direita: total de pendências e a data da mais antiga ("desde 10/09")
  - fio dourado no topo e divisória sutil, no mesmo padrão do painel de Filtros
- Linhas da lista passam a usar as linhas padrão (altura, divisória, destaque ao passar o dedo/mouse, caixa de seleção do padrão).

## 2. Resolver pendência (prints 2 e 3)
- **Corrigir campos colados na lateral direita**: seletores e campos de valor ficam dentro da margem (16px dos dois lados). As duas colunas encolhem por igual e o texto do seletor é cortado com "…" dentro da própria caixa, nunca além da janela.
- **Cabeçalho com contexto**, no padrão da casca:
  - título "Resolver pendência"
  - nome do registro (quebra linha, sem corte)
  - chips: **situação** (categoria com a cor dela, ex. Danos / Manutenção), **imóvel**, **proprietário**, data do registro e quem registrou
- Casca, fundo, cantos, sombra e botões no padrão das janelas (mesma casca do painel de Filtros, versão janela).
- Corrigir de vez a frase de resumo que podia sair "a a empresa".

## 3. Clicar fora volta uma janela
Hoje, com a lista de pendências aberta por baixo, o clique fora da janela "Resolver pendência" é bloqueado e nada acontece. Novo comportamento, para qualquer combinação de janelas:
- clique fora fecha **só a janela do topo** e volta para a anterior (Resolver → lista de pendências → página).
- Implementado como uma pilha única de janelas abertas: cada janela/lista/menu sabe se é a do topo; só a do topo reage ao clique fora.

## 4. Padrão em todas as janelas que ainda não têm
- A base de janelas (Dialog) passa a usar a casca padrão; remover os estilos soltos (fundo/borda/canto/sombra feitos à mão) das janelas do Dashboard que brigam com o padrão, mantendo só larguras.
- Cabeçalho padrão reutilizável (título, subtítulo, chips de contexto) para janelas de detalhe.

## 5. Auditoria completa da página Dashboard
Percorrer tudo que é clicável em Operacional, Kanban, Limpeza, Calendário e Registros (botões, abas, filtros, cartões, menus, seletores, dicas, calendários suspensos, janelas e subjanelas) em celular (393px) e computador, temas claro e escuro. Para cada item, conferir: casca padrão, sem corte na margem direita, clique fora volta uma janela, campos obrigatórios marcados, rolagem com barra lilás. Corrigir o que estiver fora e entregar a lista do que foi ajustado.

## Detalhes técnicos
- `RecordsWorkspace.tsx`: `PopoverContent` da lista (≈l.1039) ganha `PendingListHeader` sticky; `ResolveDialog` (≈l.1873) remove `bg-card/95 rounded-lg border-border/60` e adota `OVERLAY_SHELL`; grids `grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`, triggers `w-full min-w-0 truncate`.
- `global-overlay-store.ts`: trocar o contador por pilha (`pushGlobalOverlay` devolve id); `guardNestedOutside` só bloqueia se a janela não for o topo; Dialog, Popover, DropdownMenu, Sheet e Drawer registram-se na pilha.
- `ui/dialog.tsx`, `ui/alert-dialog.tsx`, `ui/sheet.tsx`: casca padrão; novo `components/ds/OverlayHeader.tsx`.
- Auditoria via Playwright com prints por item; ajustes nas janelas de `OperationWorkspace.tsx` (ex. l.3821, 4856, 5732) e demais do dashboard.
