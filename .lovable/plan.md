## Objetivo
Permitir que **a equipe SaaS** feche contratos Enterprise com valor, dias de trial, vencimento e limite de guias totalmente customizados, mantendo a cobrança e o ciclo dentro do Paddle.

## Como vai funcionar (visão do operador SaaS)
1. Em **Admin SaaS → Clientes**, abrir um cliente e clicar **"Criar contrato Enterprise"**.
2. Preencher: valor mensal (BRL), dias de trial (default 7), data de vencimento da assinatura (opcional), limite de guias (default 100).
3. O sistema cria no Paddle um **price exclusivo daquele contrato** sob o produto `enterprise_plan` e abre o checkout pré-preenchido (ou copia o link pro cliente).
4. Quando o webhook do Paddle confirma a assinatura, o registro em `subscriptions` é marcado como Enterprise + `is_manual=true` + guarda `max_guides_override` e `trial_days_used`.
5. O cliente Enterprise nunca vê o plano no `/precos` (CTA continua "Falar com vendas").

## Produto no Paddle
Criar uma única vez no ambiente test (sincroniza pra live no publish):
- **Produto**: `enterprise_plan` — "Enterprise (sob consulta)"
- **Price placeholder**: `enterprise_custom` — R$ 99.999,00/mês, trial 7 dias, quantity 1-1.
  Esse placeholder serve só pra ancorar o produto; nenhum checkout público usa ele. Cada contrato gera um price próprio via API (`POST /prices` com `product_id = pro_<id_do_enterprise>`, valor e `trial_period` definidos pelo operador).

## Mudanças no banco
Migration adicionando à `subscriptions`:
- `max_guides_override int null` — quando preenchido, sobrepõe `PLANS[plan].maxGuides`.
- `is_manual boolean default false` — já existe? confirmar; se sim, manter.
- `notes text null` — campo livre pra equipe registrar termos do contrato.

`resolveUserPlan` / `resolveOwnerPlanAdmin` passam a usar `max_guides_override ?? PLANS[plan].maxGuides`.

## Mudanças no app
1. **`src/lib/payments.functions.ts`** — nova server fn `createEnterpriseContract` (admin-only via `has_role('admin')`) que recebe `{ userId, monthlyBrl, trialDays, maxGuides, billingDay? }`, chama `POST /prices` no Paddle criando um price único, e devolve o `priceId` interno + URL de checkout pré-montada.
2. **`src/routes/_authenticated/admin/admin.clientes.tsx`** (admin SaaS) — botão "Novo contrato Enterprise" abrindo modal com os 4 campos + ação que chama a fn acima e exibe o link gerado pra copiar.
3. **Webhook handler** — quando `customData.enterpriseContractId` está presente, gravar `max_guides_override` no row de subscription correspondente.
4. **`useSubscription` / FeatureRow** — mostrar `max_guides_override` quando existir ("Até X guias (contrato)").

## Segurança
- A fn `createEnterpriseContract` é gated por `has_role('admin')` no servidor.
- O price gerado no Paddle fica restrito ao contrato (não aparece no `/precos`).
- O limite de guias do hóspede continua sendo enforçado server-side em `assertCanCreateGuide`.

## Fora do escopo desta entrega
- Renovação automática com reajuste customizado (Paddle já cuida do recorrente do price criado).
- Cobrança one-time / setup fee (pode entrar numa próxima iteração).

## Confirmações antes de implementar
1. Posso adicionar as colunas `max_guides_override` e `notes` em `subscriptions` (migration)?
2. Posso criar **agora** no Paddle test o produto `enterprise_plan` + price placeholder `enterprise_custom` em R$ 99.999/mês (trial 7 dias)?
3. O fluxo de operador "gera link e envia pro cliente" tá ok, ou prefere que o sistema cobre cartão direto sem checkout (cobra automático após aprovação manual)?
