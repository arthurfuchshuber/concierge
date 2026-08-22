# Project Memory

## Core
Guia público: qualquer campo/título/seção só renderiza se o campo correspondente do painel admin estiver preenchido. Vazio = ocultar por completo (sem rótulos "—", sem placeholders).
Pontuação (`,` `.` `;` `:` `!` `?`) nunca pode iniciar uma linha em nenhuma tela — usar `text-wrap: pretty` + `hanging-punctuation` (já globais) e, se preciso, mover a pontuação para dentro do span colorido/negrito da palavra anterior ou usar `whitespace-nowrap`.
Sistema de Design obrigatório: escala tipográfica fixa, espaçamento base 4px, botões de 36px em tamanho único, ícone substitui texto no mobile quando inequívoco, barras de ação rolam na horizontal (nunca 2 linhas) e filtros consolidados em um só acionador com badge.

## Memories
- [Regras de tipografia](mem://design/typography-rules) — Detalhe da regra de pontuação órfã e como aplicar em títulos com spans coloridos
- [Sistema de Design — visão do cliente](mem://design/design-system-cliente) — Escala tipográfica, espaçamento 4px, botões 36px, mobile ícone-vs-texto, card padrão, barra rolável e consolidação de filtros
- [Ligações in-app Sinch Voice](mem://features/sinch-voice-plan) — Plano aprovado (WebRTC + click-to-call registrado na timeline), aguardando validação para implementar
- [Padrão de layout Workspace](mem://design/padrao-layout-workspace) — Cabeçalho, segmented control e botões da página Operação, replicados página a página (Guias já feito)
