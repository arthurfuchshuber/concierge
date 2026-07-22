# Plano de implementação — Planos, gating e comunicação

Layout aprovado: **v2 (Cards + Tabela agrupada)**. Adaptado às cores do projeto (foreground / background / accent) — não uso indigo do protótipo.

---

## 1. Fonte da verdade dos planos (`src/lib/payments.shared.ts`)

Novo shape de `features` (flags por plano, todas em linguagem simples):

| Feature key           | Rótulo público (não técnico)          | Starter | Pro | Business | Enterprise |
| --------------------- | ------------------------------------- | :-----: | :-: | :------: | :--------: |
| `guestChat`           | Chat com IA para hóspedes             |         |  ✓  |    ✓     |     ✓      |
| `autoImport`          | Importação automática (Airbnb + Maps) |         |  ✓  |    ✓     |     ✓      |
| `advancedIntake`      | Formulário de captação + docs por IA  |         |  ✓  |    ✓     |     ✓      |
| `ai` (treinável)      | Ensinar a IA com sua base própria     |         |     |    ✓     |     ✓      |
| `humanHandoff`        | Atendimento humano ao vivo            |         |     |    ✓     |     ✓      |
| `team`                | Gestão de equipe + edição em massa    |         |     |    ✓     |     ✓      |
| `customBrand`         | Marca própria (white label)           |         |     |          |     ✓      |
| `externalIntegration` | Integração com sistemas externos      |         |     |          |     ✓      |

Limites: Starter 3 · Pro 20 · Business 50 · Enterprise ∞.

## 2. Landing `src/routes/index.tsx` + `src/routes/precos.tsx`

Aplicar layout v2 aprovado:
- 4 cards (Pro destacado como "Mais popular").
- Cada card lista 4-5 bullets — recursos-âncora do plano + 1 linha riscada mostrando "o que só existe no plano acima" (motor de upgrade).
- Tabela comparativa agrupada abaixo dos cards, com colunas: Recurso · Starter · Pro (destacada) · Business · Enterprise.
- Copy 100% em português simples: "Integração com sistemas externos" (não API), "Atendimento humano ao vivo" (não handoff), "Ensinar a IA" (não fine-tune / KB).

## 3. Gating no servidor

- `src/lib/plan-guard.server.ts`: expandir `features` para as 8 chaves acima; `assertFeature` já cobre.
- `src/routes/api/public/guide-chat.ts`:
  - Se plano do dono não tem `guestChat` → rota devolve 403 ("Chat não disponível neste plano").
  - Se não tem `humanHandoff` → IA **nunca** oferece transferência para humano; system prompt recebe flag `humanHandoffAllowed=false` e a ferramenta `request_human_handoff` é removida (já é hoje na exploração; estender para todos os contextos).
- `src/lib/handoff.functions.ts`: `requestHandoff` server fn valida `humanHandoff` do dono antes de criar ticket.
- Endpoints de importação Airbnb, upload de docs com validação IA, teach-ai, team invites, bulk edit — todos passam por `assertFeature` correspondente.

## 4. Gating no cliente (guias de hóspede)

- `src/routes/g.$slug.tsx` loader: já resolve `resolveOwnerPlanAdmin` — expor `ownerFeatures` no contexto do guia.
- `GuideAiChat.tsx`: só renderiza o botão flutuante se `ownerFeatures.guestChat === true`. Sem plano → botão some.
- Dentro do chat, sumiço do CTA "Falar com atendente" se `ownerFeatures.humanHandoff === false`.

## 5. Gating no cliente (admin — bloqueios visuais)

Recursos indisponíveis ficam **visíveis mas travados** com ícone de cadeado + tooltip "Disponível no plano X" e popup CTA para /precos (reaproveitar `AiPlanLock` renomeando para `PlanLock` genérico com prop `requiredPlan`). Aplicar em:
- Aba "Importar Airbnb" (< Pro)
- Aba "Captação avançada" + validação de docs (< Pro)
- Painel "Atendimento" na sidebar (< Business)
- Aba "Base de conhecimento IA" (< Business)
- Aba "Equipe" + botão "Edição em massa" (< Business)
- Aba "Marca personalizada" (< Enterprise)

Comportamento ao clicar em item travado: `Dialog` com título "Recurso do plano X", descrição curta, e CTA "Ver planos" → `/precos`.

## 6. Downgrade — aviso completo

`src/components/DowngradeExcessDialog.tsx` já pede escolher guias a excluir. Adicionar bloco novo:

> **Ao migrar para o plano [X], seus guias deixarão de oferecer:**
> - Chat com IA para hóspedes
> - Atendimento humano ao vivo
> - Validação de documentos por IA
> …

Lista é derivada de `PLANS[current].features` menos `PLANS[target].features`, com rótulos legíveis.

## 7. Ordem de entrega (para não empilhar risco)

1. **Turno 1 (agora):** itens 1 + 2 + 6 — planos, landing/precos, aviso de downgrade. Zero regressão funcional.
2. **Turno 2:** item 3 — gating server (chat/handoff/importação/team).
3. **Turno 3:** itens 4 + 5 — gating client e bloqueios visuais em admin.

Cada turno é auto-contido e testável isoladamente. Se quiser tudo num turno só, aviso que a chance de bug sobe.

---

## Detalhes técnicos (para desenvolvedor)

- Novas keys de `features` são **union type discriminado**; TypeScript vai apontar todo lugar que precisa atualizar após mudança em `payments.shared.ts`.
- `resolveOwnerPlanAdmin` já existe e é usado no guia — só preciso expor `features` no retorno do loader (já faz).
- Gate visual (`PlanLock`) usa `useSubscription().info.features` — hook já retorna features do plano ativo.
- Copy da tabela comparativa fica em constante `PLAN_COMPARISON_ROWS` no shared, para landing e /precos consumirem sem duplicar.
