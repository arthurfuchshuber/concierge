
## Escopo

Três frentes em Administrativo:

1. **Aba "Meu Perfil"** — cada membro edita os próprios dados.
2. **Popup de aceite de convite** — bloqueia o painel no primeiro acesso até o convidado aceitar (vale para usuário novo E existente).
3. **Botão "Criar Novo"** no dropdown de empresas — mesmo login pode ter várias empresas com passo a passo de nova assinatura.

---

## 1) Aba "Meu Perfil"

Adiciona terceira aba em `admin.administrativo.tsx` (`?tab=perfil`) com o novo componente `MeuPerfilPage`.

Campos:

| Campo | Origem | Editável | Regra |
|---|---|---|---|
| Foto de perfil | `profiles.avatar_url` | Sim | Opcional · upload em bucket privado `avatars` |
| Nome completo | `profiles.full_name` | Sim | Obrigatório |
| Nome fantasia | `profiles.trade_name` (novo) | Sim | Opcional · usado no lugar de `full_name` no cabeçalho/AccountSwitcher quando preenchido |
| Data de nascimento | `profiles.birth_date` (novo) | Sim | Obrigatório · não permite data futura |
| CPF | `profiles.cpf` | Somente leitura | Alteração só via suporte (mesma trava anti-duplicidade) |
| E-mail | `auth.users.email` | Sim (com re-verificação) | Obrigatório · dispara e-mail de confirmação Supabase |
| Cargo | `profiles.job_title` (novo) | Sim | Opcional (ex.: "Gerente de reservas") |

Server fn nova: `updateMyProfile` (validação Zod, retorna profile atualizado). Upload de avatar via server fn que devolve URL assinada e persiste `avatar_url`.

---

## 2) Popup de aceite de convite

**Mudança no fluxo atual (`inviteTeamMember` / `resendTeamInvite` / trigger `accept_account_invite_on_signup`)**: sempre criar `account_members` com `status = 'pending_acceptance'` (novo valor no enum `account_member_status`) — nunca `active` até o clique.

**No login**, `AdminLayout` chama nova server fn `listPendingInvites` → se houver 1+ convite pendente, abre `PendingInviteDialog` (modal bloqueante, não fechável no X):

```
┌───────────────────────────────────────────────┐
│  Você foi convidado por Ricardo (Sigma Turismo)│
│  Cargo proposto: Atendente                    │
│  [ Recusar ]              [ Aceitar convite ] │
└───────────────────────────────────────────────┘
```

- **Aceitar** → server fn `acceptInvite(memberId)` marca `status='active'` + `accepted_at=now()`, invalida caches, seta impersonation para essa empresa, fecha popup.
- **Recusar** → `status='declined'`, remove da lista, mostra próximo convite (se houver) ou libera painel próprio.
- Se o usuário tiver múltiplos convites pendentes, o popup itera um a um.

---

## 3) Multi-empresa no mesmo login (reestrutura)

### Arquitetura

Hoje: 1 login = 1 empresa (via `properties.owner_id = auth.uid()` e `subscriptions.user_id = auth.uid()`).
Novo: 1 login pode possuir N empresas. Introduzimos uma "empresa ficha" acopllada ao `owner_id` existente para não quebrar RLS e dados legados.

**Migração de dados**:
- Cria `public.accounts (id, owner_user_id, name, trade_name, tax_id, tax_id_kind, created_by_user_id)`. Cada usuário existente ganha uma linha `accounts` cujo `id = owner_user_id` (mesmo UUID) — mantém compatibilidade 1:1 com o schema atual sem migrar `properties.owner_id`.
- CPF/CNPJ passa a ficar em `accounts.tax_id` (mantém `profiles.cpf` como CPF **pessoal** do usuário-login — usado na aba Meu Perfil).
- `subscriptions.user_id` continua sendo o `owner_id` da empresa (que é o UUID compartilhado com `accounts.id`).

**"Criar Novo" — fluxo (a partir de qual etapa)**

O botão "Criar Novo" (abaixo do dropdown de empresas) abre um wizard modal em **3 etapas**:

```
[1] Documento da nova empresa  → CPF ou CNPJ (validação Receita/BrasilAPI, anti-duplicidade)
[2] Nome fantasia + tipo de negócio (opcional)
[3] Plano + cartão (checkout Paddle, 7 dias grátis)
```

Recomendação: **começar pela Etapa 1 (Documento)** — é o mesmo passo do `OnboardingCheckout` atual, reaproveita `validateTaxId` e trava duplicidade cedo. A Etapa 2 é nova (nome que aparecerá no dropdown). A Etapa 3 reusa `usePaddleCheckout`.

Ao concluir a Etapa 3 (webhook Paddle confirma pagamento), o backend:
1. Cria nova linha em `accounts` com `owner_user_id = auth.uid()` do criador **mas `id = novo UUID`** (empresa distinta).
2. Cria uma linha "shadow" em `auth.users` via `supabaseAdmin.auth.admin.createUser` **apenas se necessário** para que `properties.owner_id` referencie um id válido — **OU** simplesmente usa o `accounts.id` como owner_id sem passar por auth.users (requer relaxar a FK).

Como isso é sensível, optamos pela **shadow user** (mais seguro): cada empresa tem um `auth.users` sombra sem senha (e-mail formato `empresa+{uuid}@internal.sigma`), e o login humano ganha `account_members(owner_id=shadow, member_user_id=login, role='owner', status='active')`. O `AccountSwitcher` já sabe alternar entre owner_ids — só precisamos garantir que ele liste também empresas onde o login é dono (role=owner). Zero mudança em RLS.

**Assinatura**: cada empresa nova tem sua própria `subscriptions.user_id = shadow_owner_id`. O login titular paga o cartão, mas cada empresa tem seu ciclo separado (evita "3 empresas no mesmo plano").

**AccountSwitcher**: renderiza:
```
Minha conta ✓
Sigma Turismo (owner)
Pousada do Ricardo (owner)
Empresa do João (agent)   ← convite aceito
─────────────────────
+ Criar Novo
```

---

## Detalhes técnicos

- **Migration Supabase**:
  - `ALTER TABLE profiles ADD COLUMN trade_name text, birth_date date, job_title text`.
  - `CREATE TABLE public.accounts (...)` + GRANT + RLS (`auth.uid() = owner_user_id OR is_account_member(auth.uid(), owner_user_id)`).
  - `ALTER TYPE account_member_status ADD VALUE 'pending_acceptance'`.
  - Atualizar `handle_new_user()` para criar `accounts` shadow para o novo cadastro.
  - Atualizar `accept_account_invite_on_signup()` para criar como `pending_acceptance`, não `active`.
  - Backfill: uma linha `accounts` para cada usuário existente.
  - Storage bucket privado `avatars` com RLS (owner-only).

- **Server functions novas** (`src/lib/`):
  - `profile.functions.ts`: `getMyProfile`, `updateMyProfile`, `uploadAvatar`, `requestEmailChange`.
  - `accounts.functions.ts`: `createNewCompany` (as 3 etapas), `listMyOwnedAccounts`.
  - `invites.functions.ts`: `listPendingInvites`, `acceptInvite`, `declineInvite`.
  - Ajustes em `team.functions.ts` para criar convites como `pending_acceptance`.

- **UI nova**:
  - `MeuPerfilPage.tsx`, `PendingInviteDialog.tsx`, `CreateCompanyWizard.tsx`.
  - `AccountSwitcher.tsx` — adiciona "+ Criar Novo" no rodapé do popover; passa a listar empresas onde `role='owner'` também.
  - `admin.administrativo.tsx` — 3ª aba `perfil` (default), reordena para `Perfil / Assinatura / Equipe`.

- **Assinatura por empresa**: `useSubscription` passa a considerar o `owner_id` ativo (via impersonation) ao invés do `auth.uid()`. Todas as verificações de plano já usam `resolveUserPlan(supabase, ownerId)` — só precisamos garantir que `ownerId` = empresa ativa.

---

## Riscos

- Alterar `handle_new_user` e criar shadow accounts pode gerar inconsistência em contas antigas. Mitigado com backfill idempotente.
- `AccountSwitcher` auto-seleção pode quebrar se um login vira dono de várias empresas (hoje auto-seleciona se `accounts.length === 1 && !hasOwn`). Ajustar para não auto-selecionar quando total > 1.
- Meta Pixel `Purchase` já dispara — precisa continuar disparando também para novas empresas (o webhook Paddle já é agnóstico).

---

## Entrega proposta (uma etapa por vez para reduzir risco)

Sugiro fatiar em **3 PRs sequenciais**:

1. **Meu Perfil** (migration `profiles` + aba + upload avatar). Baixo risco, valor imediato.
2. **Popup de aceite** (novo status + trigger + dialog). Risco médio (mexe em fluxo de convite).
3. **Multi-empresa** (shadow accounts + wizard + AccountSwitcher). Alto risco — precisa de teste manual de RLS e billing.

Confirma essa ordem antes de eu começar pela #1?
