# Padrão único para janelas flutuantes (filtros, tooltips, menus, seletores)

## Objetivo
Toda janela que "flutua" sobre a tela passa a ter o mesmo visual do painel de Filtros da Limpeza/Operacional: quadrante escuro com fio dourado no topo, cantos arredondados, sombra profunda, linhas com divisória sutil, selo de ícone, chip rosa para valor ativo, caixa de seleção no estilo do painel e rolagem fina. Vale para o sistema inteiro de uma vez, porque a mudança é feita nas peças-base.

## O que muda para o usuário
- **Filtros (todas as páginas):** iguais ao da Limpeza — cabeçalho "FILTROS" + Limpar, linhas com ícone/rótulo/valor/seta, subtelas com voltar.
- **Menus de três pontinhos (Editar/Excluir etc.):** mesmo quadrante, linhas de 44px com ícone em selo, divisória sutil, ação de excluir em vermelho separada no fim.
- **Seletores (listas de escolha):** mesma casca, item marcado com check dourado, busca no topo quando houver muitas opções.
- **Dicas ao passar/tocar (tooltips):** versão compacta do quadrante — fundo do painel, borda sutil, texto 12px, sem fio dourado (para não pesar).
- **Cartões de pré-visualização e calendários suspensos:** mesma casca do painel.
- Nada corta na margem direita: 16px de folga das bordas, largura limitada à tela, conteúdo longo quebra linha ou rola.

## Etapas
1. **Tokens únicos** — extrair do painel de Filtros um conjunto de classes compartilhadas (casca, casca elevada, casca compacta para dica, linha, divisória, hover, selo de ícone, chip ativo, check).
2. **Peças-base globais** — aplicar esses tokens nas janelas padrão do sistema: janela suspensa, menu suspenso, menu de clique-direito, seletor, dica, cartão de pré-visualização, lista com busca e barra de menu. Todas as telas que já usam essas peças herdam o visual automaticamente.
3. **Filtro reutilizável** — mover as peças do painel de Filtros para um lugar comum (`ds`) e trocar o filtro simples de múltipla escolha (`multi-select-filter`) para usá-las.
4. **Varredura** — procurar as ~41 telas que sobrescrevem cor/borda/canto dessas janelas à mão e remover os estilos soltos que brigam com o padrão (mantendo apenas larguras específicas).
5. **Conferência** — prints em celular (393px) e computador, tema escuro e claro: filtro, menu de três pontinhos, seletor, dica e calendário suspenso.
6. **Registro** — atualizar a memória de padrão de layout com a seção "Janelas flutuantes".

## Detalhes técnicos
- Fonte da verdade: `src/components/dashboard/filter-panel.tsx` (`FILTER_PANEL_CLASS`, `_ELEVATED`, `FILTER_PANEL_COLLISION`, `FilterIconBadge`, `FilterCountBadge`, `CheckBox`, `ROW_DIVIDER`, `ROW_HOVER`).
- Novo `src/components/ds/overlay.ts` exporta `OVERLAY_SHELL`, `OVERLAY_SHELL_ELEVATED`, `OVERLAY_SHELL_COMPACT`, `OVERLAY_ROW`, `OVERLAY_DIVIDER`, `OVERLAY_ITEM_ACTIVE`; `filter-panel.tsx` passa a importar de lá (visual idêntico ao atual).
- Aplicar em `ui/popover.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `select.tsx`, `tooltip.tsx`, `hover-card.tsx`, `command.tsx`, `menubar.tsx`; manter `overlay-collision.ts` com folga lateral 16px e `max-w-[calc(100vw-32px)]`.
- Popovers/menus aninhados sobre diálogos usam a casca elevada (`--panel-2`).
- Sem degradê de fade em áreas roláveis; títulos dinâmicos sem `whitespace-nowrap`.
- Diálogos e gavetas (telas cheias) ficam fora desta etapa — próxima rodada, se aprovado.
