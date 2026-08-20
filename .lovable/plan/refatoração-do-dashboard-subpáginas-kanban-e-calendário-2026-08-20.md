# Refatoração do Dashboard + subpáginas Kanban e Calendário

Direção visual aprovada: **Operacional Compacto** (mobile-first, base areia `#fdf9f2`, cards brancos com raio 8px e borda `black/5`, gap 6px, Sora nos títulos / Manrope no texto, eyebrow roxo em caixa alta, segmented control no topo, item ativo da nav em gradiente `#7c1ad8 → #e82dae`, FAB preto de suporte).

Os mockups gerados para o Kanban e o Calendário saíram fora do domínio (viraram tela de pedidos de restaurante), então abaixo eu fixo a estrutura exata das duas telas em wireframe — é isso que vou construir, herdando 100% dos tokens da direção aprovada.

## Estrutura de rotas

```text
/admin/dashboard            -> Visão do dia (refatorada)
/admin/dashboard/kanban     -> Kanban de operação (nova)
/admin/dashboard/calendario -> Calendário de ocupação (nova)
```

Um layout compartilhado desenha header + eyebrow + título + segmented control (Dashboard | Kanban | Calendário); cada subpágina só renderiza seu conteúdo. Estado de filtros (período, imóvel) vive na URL, então o link é compartilhável e o "voltar" funciona.

## 1. Dashboard — visão do dia

```text
OPERAÇÃO DE RESERVAS
Dashboard
[ Dashboard | Kanban | Calendário ]

┌ Check-ins pend. ┐ ┌ Checkouts pend. ┐
│ 0               │ │ 0               │   <- KPI compacto (rótulo 10px, número Sora 20px)
└─────────────────┘ └─────────────────┘
┌ Chegam amanhã 6 ┐ ┌ Saem amanhã   5 ┐
┌ Em estadia    8 ┐ ┌ Imóveis livres 1┐

┌ ENGAJAMENTO ────────────────────────┐
│ Viram instruções de check-in  1 de 2│
│ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░  (tooltip: quem)│
│ Viram senha de acesso         0 de 2│
│ ░░░░░░░░░░░░░░░░░░░░               │
└─────────────────────────────────────┘

Hoje                     [ Hoje ▾ ]
┌ 14:00  Marcos Oliveira ──────── ⌄ ┐
│ Studio Jardins · #4920 ⧉  CHEGADA │  <- barra lateral roxa = chegada, rosa = saída
└───────────────────────────────────┘
┌ 11:00  Ana Paula ────── ATRASADO ─┐
└───────────────────────────────────┘

[ Ver Kanban → ]   [ Ver Calendário → ]
```

- KPIs em 2 colunas, altura reduzida, sem ícone grande; o número é a âncora visual.
- Card de engajamento sempre presente (hoje só aparece o texto vazio) com as duas barras e tooltip de quem viu / não viu.
- Lista do dia unificada: chegadas e saídas na mesma linha do tempo, ordenadas por horário, com código da reserva copiável e chip de atraso.
- Nada de receita/faturamento — só o que existe no produto.

## 2. Kanban

```text
Kanban
[ Dashboard | Kanban | Calendário ]
[ Hoje ▾ ]   Chegada 2 · Estadia 8 · Saída 5 · Limpeza 1 · OK 69

◀ colunas com scroll horizontal + snap ▶
┌ CHEGADA        02 ┐ ┌ EM ESTADIA   08 ┐
│ ┌───────────────┐ │ │ ┌─────────────┐ │
│ │15:00 M. Oliv. │ │ │ │ A. Paula    │ │
│ │Studio Jardins │ │ │ │ Loft Vila M.│ │
│ │#4920 ⧉  [→]   │ │ │ │ até 24/10   │ │
│ └───────────────┘ │ │ └─────────────┘ │
└───────────────────┘ └─────────────────┘
```

- Cabeçalho de coluna fixo (nome + contador), cards de altura uniforme.
- Card: hóspede, imóvel, horário previsto, código copiável, chip de status; chip vermelho de atraso quando aplicável.
- Ações no card: avançar etapa e voltar etapa, com diálogo de confirmação quando a transição antecipa um fluxo (mesmo comportamento já existente hoje).
- Realtime e silenciar notificações por reserva preservados.

## 3. Calendário

```text
Calendário
[ Dashboard | Kanban | Calendário ]
[ 5 dias ▾ ]   ◀ 20–24 ago ▶

           20  21  22  23  24
Studio J.  ██  ██  ◤◢  ░░  ░░
Loft V.M.  ░░  ▨   ██  ██  ██
Flat Itaim ██  ██  ██  ◤◢  ░░

█ Ocupado  ◤◢ Saída+Chegada  ▨ Limpeza  ░ Livre

Dia 22 — 3 movimentos
· 11:00 Saída  · Studio Jardins
· 15:00 Chegada · Studio Jardins
```

- Matriz imóvel × dias, coluna do nome do imóvel fixa, 5 dias no mobile e preenchendo até 21 no desktop.
- Célula dividida na diagonal quando há saída e chegada no mesmo dia.
- Toque em um dia abre a lista compacta de movimentos daquele dia.
- Legenda sempre visível; filtro de imóvel e período no topo.

## Detalhes técnicos

- `admin.dashboard.tsx` (2.853 linhas) vira um layout enxuto + `admin.dashboard.index.tsx`; o Kanban e o Calendário saem para `admin.dashboard.kanban.tsx` e `admin.dashboard.calendario.tsx`.
- A lógica de dados (KPIs, agrupamento de hóspedes, fuso do imóvel, realtime, iCal, otimismo de UI) é extraída para hooks reutilizáveis em `src/components/dashboard/` — sem reescrever regra de negócio.
- Componentes novos de apresentação: `DashboardShell` (header + segmented control), `KpiTile`, `EngagementCard`, `DayTimeline`, `KanbanBoard`/`KanbanCard`, `OccupancyMatrix`.
- Tokens da direção entram em `src/styles.css` (nada de cor solta nos componentes) e passam a ser o padrão para replicar nas demais páginas depois.
- `/admin/dashboard` continua respondendo (o Kanban e o Calendário passam a ser subrotas, sem quebrar links existentes).
- Rotina de verificação: screenshot do preview em 393px de cada uma das 3 telas, comparado com este wireframe, antes de reportar concluído.
