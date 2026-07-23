# Multi-empresa por login (shadow accounts)

Permitir que o mesmo login gerencie N empresas distintas, cada uma com CPF/CNPJ, plano, cobrança, propriedades, biblioteca, atendimento e time próprios. Alternância via dropdown; criação via "Criar Novo".

## Regras confirmadas
- Cada nova empresa **reinicia o onboarding do zero**: CPF/CNPJ (validação Receita/BrasilAPI + antiduplicidade global) → plano → cartão (nova assinatura Paddle).
- Ao alternar empresa, **todo o contexto muda**: propriedades, biblioteca, hóspedes, atendimento, cobrança, permissões, membros.
- Convites já recebidos (memberships em contas de terceiros) continuam listados no mesmo dropdown, junto das empresas próprias.

## Modelo de dados

Nova tabela `public.accounts` — uma linha por empresa (shadow account).

| coluna | descrição |
|---|---|
| `id` uuid PK | id da empresa |
| `owner_login_id` uuid → auth.users | login humano dono |
| `display_name` text | nome fantasia da empresa |
| `cpf` / `cnpj` / `phone` text (nullable, únicos globais) | migrados de `profiles` |
| `created_at` / `updated_at` | timestamps |

Migração de dados: para cada `profiles` existente, criar 1 `accounts` correspondente (id = profiles.id inicialmente, para preservar `owner_id` em todas as tabelas atuais). Depois, `owner_id` em `properties`, `subscriptions`, `host_faqs`, `host_knowledge`, `host_behavior`, `account_members`, `account_member_invites`, `account_member_permissions`, `audit_logs` etc. passa a significar **account_id** (mesmo valor, semântica nova). Nenhum backfill destrutivo.

Contrato preservado: `is_account_member`, `has_member_permission`, `user_can_access_property` continuam funcionando pois já operam sobre `owner_id`. RLS não muda.

Índices únicos globais em `accounts.cpf`, `accounts.cnpj`, `accounts.phone` (parciais, normalizados) — a antiduplicidade que hoje vive em `profiles` migra para `accounts`.

## Servidor

Novos server fns em `src/lib/accounts.functions.ts`:
- `listMyAccounts()` → todas as `accounts` onde o login é `owner_login_id` **ou** é membro ativo (`account_members`) **ou** é admin SaaS. Retorna `{ id, displayName, role: 'owner'|'member'|'saas_admin', hasActiveSubscription }`.
- `createNewAccount({ displayName, cpf|cnpj, phone })` → valida documento (reusa `validateTaxId`), cria `accounts` (unique global), cria membership auto-owner, retorna `accountId`. **Não** cria assinatura — próximo passo é o checkout.
- `setActiveAccount(accountId)` → valida acesso, grava em cookie httpOnly `active_account_id`.

Todos os fns de dados existentes (properties, biblioteca, atendimento, clients, subscription) passam a resolver o `owner_id` alvo via helper `getActiveAccountId(context)`:
1. Lê cookie `active_account_id`.
2. Valida acesso (owner ou membership).
3. Fallback: primeira `accounts` do login (retrocompat com contas single-tenant existentes).

`requireSupabaseAuth` middleware não muda; o helper é chamado dentro dos handlers.

## Onboarding reaproveitado

`OnboardingCheckout` já cobre CPF/CNPJ → plano → Paddle. Refator mínimo:
- Aceita prop `mode: 'initial' | 'new-account'`.
- Em `new-account`, chama `createNewAccount` no passo 1 (em vez de gravar em `profiles`) e passa `accountId` ao Paddle como `customData.accountId` (além de `userId`).
- Webhook Paddle (`src/routes/api/public/paddle-webhook.ts`) grava `subscriptions.owner_id = accountId` quando `customData.accountId` existe; caso ausente, mantém fluxo atual.

## UI

**Sidebar / Header do painel** (`AdminLayout`):
- Novo `AccountSwitcher` (dropdown) mostra:
  - Contas próprias com badge "Dono"
  - Memberships com badge "Membro" + nome do dono
  - Divisor + botão "**+ Criar nova empresa**"
- Selecionar troca o cookie via `setActiveAccount` e faz `queryClient.invalidateQueries()` + `router.invalidate()`.
- "Criar nova" abre `OnboardingCheckout` em `mode="new-account"`.

**Gate de acesso** (`admin.tsx`): passa a checar assinatura da **conta ativa**, não do login. Se conta ativa não tem plano, exibe `OnboardingCheckout` daquela conta específica (permite completar cadastro pausado).

**Perfil** (`MeuPerfilPage`): campos pessoais (nome, avatar, nascimento, CPF pessoal, email, cargo) permanecem em `profiles` — são do login humano, não da empresa. "Nome fantasia" da empresa vai para `accounts.display_name` (editável em Administrativo → Empresa).

## Ordem de execução

1. Migração: `accounts`, backfill 1:1 de `profiles`, mover unique indexes de documento/telefone.
2. `accounts.functions.ts` + cookie de conta ativa + helper `getActiveAccountId`.
3. `AccountSwitcher` no `AdminLayout` (só listagem + troca, sem "Criar novo" ainda).
4. Refator `OnboardingCheckout` para `mode="new-account"` + webhook Paddle lendo `customData.accountId`.
5. Botão "+ Criar nova empresa" ligado ao `OnboardingCheckout`.
6. Ajuste do gate em `admin.tsx` para checar assinatura da conta ativa.
7. Nova aba "Empresa" em Administrativo com edição de `display_name`, CNPJ/CPF, telefone.

## Fora de escopo desta rodada
- Transferência de propriedade entre contas.
- Consolidar cobrança multi-empresa em uma única fatura Paddle (cada empresa = assinatura Paddle independente).
- Excluir empresa (soft-delete fica para depois).
