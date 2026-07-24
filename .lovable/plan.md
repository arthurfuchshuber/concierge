
## Objetivo
Nova página `/admin/dashboard` (adicionada como primeiro item do menu, "Painel operacional") focada no dia a dia do anfitrião: quem chega/sai, engajamento com o guia, e ações rápidas (marcar realizado, notas, ajuste de horário, alerta iCal).

O "Painel" atual (lista de guias) fica como está, renomeado para "Guias" no menu para não colidir semanticamente.

## Fontes de dados existentes
- `guide_access_logs` — hóspede preencheu o formulário (nome, telefone, hora prevista, checkin_date, checkout_date, reservation_code). É a fonte principal de "chegadas/saídas previstas".
- `property_reservations` — iCal Airbnb (checkin/checkout oficiais). Base para o alerta de divergência.
- `guide_section_events` — usado para contar aberturas da aba check-in.
- `properties` — `checkin_time`, `checkin_time_max`, `checkout_time`, `checkout_time_min`.

## Estado operacional (nova tabela)
`public.guest_arrival_status` — 1 linha por log + tipo:
- `id uuid pk`, `log_id uuid fk guide_access_logs on delete cascade`
- `property_id uuid` (para RLS via owner)
- `kind text check in ('checkin','checkout')`
- `status text default 'pending'` (`pending`|`done`)
- `note text`
- `arrival_time_override text` (HH:mm; null = usa o do hóspede)
- `done_at timestamptz`, `updated_at timestamptz default now()`
- unique(`log_id`,`kind`)
- RLS: owner ou membro ativo da conta pode select/insert/update; deny anon. GRANTs padrão.

## Server functions novas (`src/lib/dashboard.functions.ts`)
Todas com `requireSupabaseAuth` + escopo pela conta ativa (helper existente `getActiveOwnerId`, mesmo padrão do resto do admin).

- `getDashboardKpis()` → `{ checkinsToday, checkinsTomorrow, checkoutsToday, checkoutsTomorrow }` (contagem em `guide_access_logs`, deduplicado por `guest_name+checkin_date+property_id`, restrito às propriedades do owner ativo).
- `getGuideEngagement({ range: 'today'|'7d'|'30d' })` →
  - `guideOpens`: acessos distintos ao guia (logs criados no período) por hóspede/checkin
  - `checkinTabOpens`: `guide_section_events` com `section='checkin'` (distintos)
  - `checkinsInPeriod`: check-ins previstos no período
  - retorna 2 pares (`guideOpens/checkinsInPeriod`, `checkinTabOpens/checkinsInPeriod`).
- `listDashboardArrivals({ kind: 'checkin'|'checkout', range: 'today'|'tomorrow'|'7d'|'all' })` →
  join de `guide_access_logs` + reserva iCal casada (mesma propriedade + mesma data ±1 dia) + `guest_arrival_status` + horários padrão da propriedade. Ordenado por data/hora prevista ascendente.
- `upsertArrivalStatus({ logId, kind, status?, note?, arrivalTimeOverride? })`.
- `applyIcalTime({ logId, kind })` — copia data do iCal para override (aqui o iCal só traz data; se horário divergir, sobrescreve a data via nota interna). Faz sentido apenas quando há reserva casada.

## Rota nova
`src/routes/_authenticated/admin.dashboard.tsx` — componente `DashboardPage`.

Menu (`admin.tsx`): substituir `{ to: "/admin", label: "Painel" }` por
- `{ to: "/admin/dashboard", label: "Painel", icon: LayoutDashboard }`
- `{ to: "/admin", label: "Guias", icon: BookOpen }`

## Layout (mobile-first)

```text
┌ Painel operacional ───────────────────────────────┐
│ ┌KPI┐ ┌KPI┐ ┌KPI┐ ┌KPI┐   (grid-cols-2 sm:4)      │
│ │ 3 │ │ 5 │ │ 1 │ │ 4 │   número grande roxo      │
│ │Chk│ │Chk│ │Out│ │Out│   ícone + label pequeno   │
│ │hoj│ │aman│ │hoj│ │aman│                          │
│ └───┘ └───┘ └───┘ └───┘                            │
│                                                    │
│ ┌ Engajamento do guia ─── [hoje|7d|30d] ─┐         │
│ │ Abriram o guia         12/15  ▓▓▓▓░ 80%│         │
│ │ Abriram aba check-in    8/15  ▓▓▓░░ 53%│         │
│ └────────────────────────────────────────┘         │
│                                                    │
│ [ Check-ins | Check-outs ]                         │
│ [ Hoje | Amanhã | 7 dias | Todos ]                 │
│                                                    │
│ ┌ Card ────────────────────────────────┐          │
│ │ Ana Silva          [Pendente]  ⚠ iCal│          │
│ │ Residência: Loft Vila Madalena         │          │
│ │ Padrão 15:00 · Chegada 17:30 ⚠         │          │
│ │  ↳ informado pelo hóspede: 16:00 (t.t) │          │
│ │ WhatsApp: +55 11 9…  (link)             │          │
│ │ Nota: [_______________________]        │          │
│ │ [Editar horário]  [Realizado ✓]        │          │
│ └────────────────────────────────────────┘          │
└────────────────────────────────────────────────────┘
```

### Componentes internos
- `KpiCard` — número em `text-primary text-4xl font-black`, ícone `ArrowDownToLine`/`ArrowUpFromLine`, link "ver lista" que muda a aba+período abaixo.
- `EngagementRow` — barra shadcn `Progress` + `X/Y (P%)`.
- `ArrivalCard` — visual "kanban": borda esquerda colorida (roxo pendente / verde `opacity-70` realizado), badge status, badge amarelo "⚠ diverge do iCal" com `Popover` mostrando os dois valores e botão "Usar valor do iCal".
- Ordenação: por data prevista asc, com sub-agrupamento por dia (`Hoje`, `Amanhã`, `Sáb 15 mar`, …).
- Filtro de ordenação extra (dropdown): `Data prevista` / `Recém preenchido` / `Pendentes primeiro`.

### Edição de horário
- Botão "Editar horário" abre `Popover` com `<input type="time">`. Salva em `arrival_time_override`.
- Renderização: valor efetivo em destaque; valor original riscado ou em `title=` tooltip: "informado pelo hóspede: HH:mm".

### Divergência iCal
- Casamento: mesma `property_id` + `checkin_date` (para aba check-in) ou `checkout_date` (para aba check-out). Divergência quando o iCal existe mas a data no log difere. Horário: o iCal do Airbnb só traz data — a divergência se aplica só a data; se datas batem, mostrar chip verde `iCal ✓` discreto.
- Botão "Usar valor do iCal" chama `applyIcalTime` (registra nota interna + marca como reconciliado — evita reescrever o input do hóspede).

### WhatsApp
- Se `guest_phone_country` presente: `https://wa.me/{country}{phoneOnlyDigits}`; caso contrário só dígitos do telefone.

## Detalhes de execução
- Tokens do design system existente (roxo Sigma via `bg-primary`, superfícies via `bg-card`, sombra `shadow-elegant`). Nenhum hex hardcoded.
- Cards com `rounded-2xl`, header com nome grande + badges à direita usando o pattern `grid-cols-[minmax(0,1fr)_auto]` + `min-w-0` + `truncate` para mobile.
- `useQuery` para KPIs (staleTime 60s), engajamento (chave inclui range), lista (chave inclui aba+range). `useMutation` para status + nota + override + apply ical, com `queryClient.invalidateQueries`.
- SEO: `head()` com título "Painel operacional — ConciergeIA".

## Arquivos a criar/editar
- migration: `guest_arrival_status` (+ GRANT + RLS + policies).
- `src/lib/dashboard.functions.ts` (novo).
- `src/routes/_authenticated/admin.dashboard.tsx` (novo) — inclui os subcomponentes locais.
- `src/routes/_authenticated/admin.tsx` — ajuste no `baseNav`.
