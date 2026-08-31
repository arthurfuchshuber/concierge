# Stakeholders no padrão "Operação / Guias" — mockups primeiro, código depois

Entrega em duas etapas. **Etapa 1 é só mockup** (nenhum arquivo do app é tocado).
Só depois da sua aprovação visual eu mexo no código.

## Por que o mockup não veio nesta mensagem

No modo de planejamento eu só posso escrever este arquivo de plano — não consigo
gerar o arquivo de mockup. Assim que você aprovar, a **primeira coisa** que faço é
publicar os mockups (nenhuma mudança no app junto) e esperar seu OK.

## Etapa 1 — Mockups (entregáveis)

Um arquivo HTML navegável, tema claro, com todas as telas da aba Stakeholders:

1. Página principal — cabeçalho + segmented control (Proprietários / Hóspedes / Prestadores)
2. Aba Proprietários — visão Lista (cards) e visão Kanban
3. Aba Prestadores — lista com categorias, valor/diária e Pix
4. Aba Hóspedes — linha expansível do formulário de primeiro acesso
5. Barra única de filtros consolidada (popover "Filtros" com contador) — desktop e mobile
6. Ficha do stakeholder (sheet lateral no desktop / bottom-sheet no mobile) com as abas
   Visão geral · Imóveis · Financeiro · Documentos · Linha do tempo · Log
7. Formulário de cadastro/edição (PF/PJ, Dados cadastrais, Contato, Acesso ao sistema,
   Endereço, Extras)
8. Popups: proprietário criado, mudança de situação, cancelamento com motivo,
   exclusão com confirmação, pré-visualização de documento, vincular evento
9. Estados vazios e de carregamento
10. Tooltips (pendências, situação, "imóvel precisa de proprietário", abrir editor do guia)
11. Versão mobile (360px) de cada tela acima

## Etapa 2 — Implementação (após aprovação dos mockups)

Regras replicadas exatamente do padrão já usado em Operação e Guias:

- Cabeçalho: `WorkspaceHeader` (título Sora 700 22px + subtítulo 13px), sem botões
  soltos ao lado do título; substitui o `PageHeader` + `Tabs` atuais.
- Menu de abas: segmented control full-width, 46px, cantos 0.3rem, aba ativa em
  gradiente roxo→rosa (mantendo a navegação por `?tab=`).
- Filtros/ações: uma única linha à direita, altura 36px, cantos 0.3rem, ícones 14px,
  rolagem horizontal (`ds-scroll-x`) — nunca duas linhas, nunca corte na margem direita.
  Busca + Select de status + toggle Lista/Kanban + "Novo" viram: busca, um acionador
  "Filtros" com badge de contagem, toggle de visão e botão primário.
- Cards: cantos 8px, gap 6px entre irmãos, tipografia da escala
  (título 13.5px Sora, corpo/meta 12–13px Manrope), informações uma por linha,
  ações agrupadas em kebab + destrutivo isolado.
- Ficha e formulários: mesma escala tipográfica, campos e botões de 36px,
  rodapé de ações alinhado à direita, acordeão único onde já existe.

## Detalhes técnicos

- Arquivos afetados na Etapa 2: `src/routes/_authenticated/admin.stakeholders.tsx`,
  `src/components/stakeholders/StakeholderDirectory.tsx`,
  `StakeholderDetailSheet.tsx`, `StakeholderFormDialog.tsx`,
  `CancellationReviewDialog.tsx`, `LinkEventDialog.tsx`,
  `src/components/admin-pages/HospedesPage.tsx`.
- Apenas camada de apresentação: nenhuma mudança em server functions, RLS,
  consultas ou regras de negócio.
- Reuso de `WorkspaceHeader`, `EmptyState`, `LoadingState`, utilitários `ds-*`.
