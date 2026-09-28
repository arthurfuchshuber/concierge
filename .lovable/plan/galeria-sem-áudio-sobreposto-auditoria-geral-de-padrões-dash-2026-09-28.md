# Galeria sem áudio sobreposto + auditoria geral de padrões (Dashboard e Guias)

## 1. Correção imediata — vídeos na galeria
- Ao dar play em um vídeo, qualquer outro vídeo/áudio da galeria pausa sozinho.
- Ao arrastar para o próximo anexo ou tocar numa miniatura, o vídeo que saiu da tela pausa.
- Ao fechar a galeria ou a tela maximizada, tudo para.
- Mesma regra no visualizador de mídia usado em outras telas (um som por vez no sistema inteiro).

## 2. Levantamento (antes de mexer no visual)
Varredura de todas as páginas e subpáginas de Dashboard (Operacional, Kanban, Limpeza, Registros, Calendário) e Guias, incluindo janelas, gavetas, menus e dicas que abrem a partir delas. Para cada item, comparar com os padrões já definidos:

| Padrão | Referência |
| --- | --- |
| Nome do proprietário | "Proprietário: " + primeiro nome, mesma cor/peso/tamanho, ícone de contato ao lado — uma peça única usada em todos os cards |
| Clique fora | Fecha só a janela de cima e volta à anterior, com fundo desfocado |
| Janelas flutuantes | Casca do painel de Filtros (fio dourado, cantos, sombra); dicas na versão compacta |
| Cards | Casca do painel, cantos 8px, título do card, apoio em cinza, ações em "..." com Excluir em vermelho |
| Botões | Altura 36px, cantos iguais aos de Filtros; ícone sozinho no celular quando óbvio |
| Busca + ações | Busca com os mesmos cantos, botões à direita em uma linha |
| Títulos/espaçamentos | Escala tipográfica e espaçamentos oficiais |
| Anti-corte | Nada cortado à direita em 393px; barras roláveis sem degradê |

Entrega do levantamento: uma lista por página com o que está fora do padrão e prints (celular 393px e computador, tema claro e escuro), para você validar antes das correções.

## 3. Correções
Aplicar as correções página por página na ordem: Operacional → Kanban → Limpeza → Registros → Calendário → Guias, sempre corrigindo na peça compartilhada (para que todas as telas herdem) em vez de tela por tela. Conferir com prints ao final de cada página.

## 4. Registro dos padrões
Consolidar todos os padrões numa única referência de projeto, para que novas telas já nasçam corretas.

## Detalhes técnicos
- Galeria (`RecordGallery` em `ReservationRecords.tsx`): listener `onPlay` que pausa os demais elementos de mídia (via ref-set ou `document.querySelectorAll('video,audio')`); pausar no `onScroll` quando `viewIndex` muda e no unmount/fechamento. Replicar em `MediaLightbox.tsx`.
- Proprietário: hoje há variações em `GuideCard.tsx` (texto neutro próprio), `OwnerLine.tsx` (variantes brand/neutral), `OperationWorkspace`, `RecordsWorkspace`, `CleaningApprovalPanel`, `ReservationJourneyDialog`, `OverlayHeader`. Unificar tudo em `OwnerLine` com um só estilo.
- Clique fora: 15 arquivos registram no `global-overlay-store`; auditar overlays próprios com `fixed inset-0` (ex.: `MediaLightbox`, galeria, `PendingInviteDialog`) e registrá-los.
- Janelas: remover sobrescritas locais de cor/borda/canto em popovers/menus (`ds-overlay`).
- Levantamento feito com Playwright em 393px e 1280px, temas claro/escuro.
