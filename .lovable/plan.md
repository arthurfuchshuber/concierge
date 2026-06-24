# Assinatura Enterprise com Valor Personalizado

## Premissas confirmadas

- **Moeda**: BRL
- **Disparo**: admin cria manualmente pelo painel após o cliente já ter cadastrado o cartão na Paddle
- **Trial**: 7 dias por padrão
- **Cobrança**: recorrente todo dia 1 do mês
- **Plano base**: `enterprise` (já criado), usado apenas como "casca" — o valor real vem do `custom_amount` por assinatura

## Lógica de cobrança (como a Paddle vai entender)

Cliente assina dia 22/jun:
1. Trial de 7 dias → termina dia 29/jun
2. Primeira cobrança imediata (29/jun): **pro-rata** de 29/jun a 30/jun (2 dias) = `valor_mensal × 2/30`
3. Próximo ciclo: ancorado em **01/jul**, cobra valor cheio
4. Daí em diante: todo dia 1, valor cheio

Tecnicamente:
- `billing_cycle: { interval: 'month', frequency: 1 }`
- `trial_period: { interval: 'day', frequency: 7 }`
- `custom_data.custom_amount_brl: <centavos>`
- Após criar: `PATCH /subscriptions/{id}` com `next_billed_at = próximo dia 1 após o trial` + `proration_billing_mode: 'prorated_immediately'` → Paddle cobra o pro-rata e ancora a recorrência no dia 1

## O que vai ser construído

### 1. Backend (Paddle)

**Produto/Preço base** (criar via tool):
- Produto: `enterprise_custom` (já pode existir como `enterprise` — reusar)
- Preço: `enterprise_custom_monthly`, BRL, mensal, valor placeholder R$1 (será sobrescrito por `custom_amount` em cada subscription)

### 2. Server function: `createEnterpriseSubscription`

`src/lib/admin-subscriptions.functions.ts` — com `requireSupabaseAuth` + check `has_role(admin)`.

Input:
```ts
{
  customerEmail: string,
  customerName: string,
  monthlyAmountBRL: number,  // em reais, ex: 23000
  trialDays?: number,         // default 7
  startDate?: string          // default hoje
}
```

Fluxo no handler:
1. `GET /customers?email=...` → pega ou cria customer
2. Confere se customer tem método de pagamento salvo (`GET /customers/{id}/payment-methods` se disponível, ou tenta criar mesmo assim e captura erro)
3. `POST /subscriptions` com:
   - `customer_id`
   - `items: [{ price_id: enterprise_custom_monthly, quantity: 1 }]`
   - `custom_data: { admin_created: true, monthly_amount_brl_cents: N }`
   - `collection_mode: 'automatic'`
   - `billing_details: null` (cobrança automática no cartão)
   - **truque do custom amount**: usar `items[].price.unit_price.amount` no payload do POST com o valor personalizado, ou criar um price ad-hoc. Conferir API; alternativa é `POST /transactions` recorrente. → vou usar `POST /prices` (ad-hoc por cliente) referenciando o mesmo produto, ID `enterprise_custom_<customerId>`, e usar esse price na subscription.
4. Após criação, calcular próximo dia 1 após o término do trial e fazer `PATCH /subscriptions/{id}` ancorando `next_billed_at`

### 3. Server function: `listEnterpriseSubscriptions`

Lista assinaturas com `custom_data.admin_created = true`, retorna status, próximo billing, valor, customer email.

### 4. Server function: `cancelEnterpriseSubscription`

`POST /subscriptions/{id}/cancel` (com `effective_from: 'next_billing_period'` ou `immediately`).

### 5. UI Admin

Nova rota: `src/routes/_authenticated/admin.assinaturas.tsx`

Componentes:
- Form "Nova assinatura": email, nome, valor mensal (BRL), data de início, trial em dias (default 7)
- Tabela: lista de assinaturas com status (badge), valor, próxima cobrança, ações (cancelar)
- Link de acesso no menu admin

### 6. Webhook (já existe)

O handler atual em `src/routes/api/public/payments/webhook.ts` já trata `subscription.created/updated/canceled`. Vai funcionar para essas assinaturas também — só precisa armazenar `custom_data.monthly_amount_brl_cents` na tabela `subscriptions` (adicionar coluna).

### 7. Migration

```sql
alter table public.subscriptions
  add column if not exists custom_amount_cents integer,
  add column if not exists currency text default 'BRL',
  add column if not exists admin_created boolean default false;
```

## Detalhes técnicos

- **Cartão pré-cadastrado**: Paddle exige o customer ter um payment method para cobrar automático. Como você quer "cliente cadastra cartão primeiro", o fluxo é:
  - Cliente recebe um link de checkout de R$0,00 (ou trial puro) → cartão fica salvo
  - Depois admin cria a assinatura real apontando para esse customer
  - **OU**: usar a página de pagamento gerenciada da Paddle (`customer_portal_session`) para o cliente atualizar o método antes
- **Pro-rata**: a flag `proration_billing_mode: 'prorated_immediately'` faz a Paddle cobrar o valor parcial automaticamente ao mover `next_billed_at`
- **Custom amount via ad-hoc price**: cada assinatura cria um price único `enterprise_custom_<customer_id>_<timestamp>` no produto `enterprise`. Mais limpo que tentar override no payload

## Não inclui (próximas etapas)

- Tela do cliente para cadastrar cartão (assumindo que ele faz isso por um link de checkout que você envia, ou via portal Paddle)
- Edição de valor da assinatura ativa (pode ser adicionado depois com `PATCH /subscriptions` + novo price ad-hoc)
- Notificações por email customizadas (a Paddle já envia recibo padrão)

Quer que eu siga com essa estrutura?
