# Redesenho integral das 3 telas de Operação

O que existe hoje é a estrutura antiga (KPI cards, kanban e agenda herdados) apenas distribuída em 3 rotas. Este plano refaz o layout de cada tela do zero, na direção "Operacional Compacto" já aprovada, com a paleta da marca (#7c1ad8, #e82dae, preto, #fdf9f2), mobile-first, Sora/Manrope, raio 8px e gap 6px.

## Linguagem visual comum (nova)

- **Topbar de operação**: linha única com data por extenso ("qui, 20 ago"), seletor de período discreto e ações à direita. Substitui o bloco eyebrow + título + subtítulo atual (ocupa 3 linhas hoje).
- **Segmented control** vira pill compacta, sticky no topo ao rolar, com contador vivo em cada aba (Dashboard · Kanban 12 · Calendário).
- **Card base novo**: superfície creme sobre fundo, borda 1px hairline, sombra suave em cor (esmeralda para chegada, âmbar para saída, violeta para estadia), cabeçalho de 1 linha com ícone 14px + label em caixa alta 10px, número em Sora 28px.
- **Densidade**: altura de linha de lista fixa (44px), tipografia secundária 11–12px, sem molduras aninhadas.

## Tela 1 — Dashboard (visão do dia)

Nova composição, de cima para baixo:

1. **Faixa "Agora"** — barra horizontal com 3 números críticos (atrasados, chegando em breve, aguardando limpeza). Vermelho só quando há atraso.
2. **Par de cards principais** — Check-ins e Checkouts de hoje, lado a lado, cada um com progresso (concluídos/total) em barra fina e lista expansível inline de até 3 reservas, com horário, imóvel e ação rápida.
3. **Tira "Amanhã"** — faixa fina de 2 números (chegadas/saídas de amanhã) que leva ao Kanban filtrado.
4. **Engajamento** — card dedicado com as duas barras (viram instruções / viram senha), percentual grande, tooltip de quem viu.
5. **Imóveis livres** — lista compacta em chips.
6. **Atalhos** — 2 botões largos para Kanban e Calendário.

## Tela 2 — Kanban

- **Colunas verdadeiras**: Chegadas · Em estadia · Saídas · Limpeza · Concluídos. Desktop em grade de 5; mobile em carrossel com snap e cabeçalho de coluna fixo com contador.
- **Filtro único** em pill no topo (período + busca), sem a barra de botões atual.
- **Card de reserva redesenhado**: altura uniforme, nome do hóspede + chip "+N", código da reserva com copiar, imóvel, horário previsto editável inline, faixa vermelha fina quando há divergência de iCal, e um único botão de avanço primário (voltar em menu discreto).
- Estado vazio ilustrado por coluna, em vez do "Nada por aqui" solto.

## Tela 3 — Calendário

- **Grade sempre aberta** (hoje abre recolhida): eixo Y de imóveis, eixo X de dias — 5 dias no mobile, até 21 no desktop, com navegação por setas e "Hoje".
- **Célula**: barra contínua da estadia com bordas arredondadas nas pontas, célula dividida na diagonal quando há saída e entrada no mesmo dia, coluna de hoje destacada.
- **Cabeçalho fixo** de dias ao rolar horizontalmente; nome do imóvel fixo à esquerda ao rolar.
- **Legenda + filtros** em uma linha só, e resumo de taxa de ocupação do período no canto.

## Notas técnicas

- Todo o layout novo vive em `src/components/dashboard/` (novos componentes de apresentação); a lógica de queries, realtime, mutações e atualização otimista já centralizada em `OperationWorkspace.tsx` é preservada e apenas reconectada aos novos componentes.
- As 3 rotas criadas permanecem; muda o que elas renderizam.
- Verificação: screenshot real de cada tela em 393px e 1440px antes de considerar pronto.
