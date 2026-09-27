# Três ajustes no Kanban

## 1. Botão de status do Kanban mostra o nome e o número
Hoje, no computador, o botão mostra só o ícone. O nome do status (ex.: "Em estadia") e o selo dourado com a contagem vão aparecer sempre, no celular e no computador. O resto do botão fica igual: cor, ícone, menu e tamanho do selo.

## 2. Pendências do cartão de limpeza recolhidas no título
Hoje o bloco "Checklist desta limpeza" aparece aberto no cartão, com até 3 itens visíveis. Ele passa a mostrar só uma linha de título, no mesmo formato da linha "Pendências" dos cartões de Registros: o nome, um fio fino e a contagem feitas/total à direita. Ao tocar no título, abre uma janela flutuante em cima do cartão, no padrão das outras janelas, com a lista inteira. Dentro dela continua dando para marcar como feito e para tocar no texto e abrir os registros.

## 3. Studio 105 não voltou para "Em estadia"
O que o banco mostra:
- A reserva já está com a saída nova, 28/09. O calendário do Airbnb atualizou às 16:30 UTC de hoje.
- Mas às 14:00 UTC de hoje (11h de Brasília), a saída automática já tinha encerrado a estadia, porque ainda valia a data antiga, 27/09.
- Quando a data mudou, esse encerramento não foi desfeito. Por isso o cartão continua como se a estadia tivesse acabado.

A correção:
- **Quando o calendário empurra a saída para depois:** se a estadia foi encerrada sozinha pela saída automática, e não por alguém da equipe, o encerramento é desfeito. O cartão volta para "Em estadia". Uma saída confirmada à mão nunca é desfeita.
- **Proteção no painel:** um encerramento automático feito antes da data de saída atual da reserva passa a ser ignorado. Assim o cartão fica certo mesmo antes da próxima atualização do calendário.
- **Studio 105 agora:** o encerramento de hoje dessa reserva é desfeito, e o cartão volta para "Em estadia" até a saída de 28/09.

## Detalhes técnicos
- `OperationWorkspace.tsx`, botão do status (≈l.3108–3117): tirar `lg:hidden` do rótulo e do selo.
- `CleaningChecklist` (≈l.4137): trocar o bloco por um gatilho de linha (`Popover` + `OverlayHeader` em cima, `side="top"`), que abre uma lista com rolagem e usa `ds-overlay`, com largura `min(360px, 100vw-32px)`. Reaproveitar as linhas atuais. Tirar o "+N pendências".
- `auto-checkout.server.ts`: marcar o encerramento automático para dar para diferenciar. Primeiro vou confirmar como ele grava hoje: `concluded_at` sem `done_at` de checkout, ou `cleaning_done_by` nulo.
- `airbnb-ical.server.ts`: depois do upsert, para reservas cujo `checkout_date` aumentou e ficou depois de hoje (fuso de SP), zerar `concluded_at` na linha de checkin, só se o encerramento foi automático e não existe linha de checkout feita à mão.
- `arrival-board.server.ts` (l.908/1030): ignorar `concluded_at` quando ele é anterior ao dia do `checkout_date` atual e o encerramento foi automático.
- Migração pontual: zerar `concluded_at` da linha de checkin `01df08dc-…` (reserva `bd7b8fcf-…`).
