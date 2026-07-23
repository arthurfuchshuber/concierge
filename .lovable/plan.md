## Permissões granulares por membro da equipe

Adicionar sistema de permissões finas que o **dono da conta** define para cada membro convidado.

### Permissões disponíveis

Divididas em dois grupos:

**Operacionais (respeitam limites do plano)**
- `chat_respond` — responder no chat de atendimento
- `ai_train` — ensinar a IA (Base de Conhecimento / FAQs / Comportamento)
- `library_edit` — alterar abas da Biblioteca (manual, recomendações, etc.)

**Administrativas (somente admin master por padrão)**
- `clients_manage` — alterar planos e informações de clientes
- `trial_manage` — alterar período de trial free
- `pricing_override` — personalizar valor da recorrência

### Modelo de dados

Nova tabela `account_member_permissions`:
```
owner_id uuid, member_user_id uuid,
permission text,  -- enum acima
granted boolean default true,
PRIMARY KEY (owner_id, member_user_id, permission)
```

Regra base: se não houver linha, membro **não tem** permissão administrativa; para operacionais o padrão é **concedido** ao aceitar o convite (configurável no envio).

Função `has_member_permission(_user_id, _owner_id, _perm)` — SECURITY DEFINER, usada em RLS/guards.

### Backend

- `src/lib/member-permissions.functions.ts`:
  - `listMemberPermissions({ ownerId })` — dono lista membros + matriz
  - `updateMemberPermission({ memberId, permission, granted })` — dono altera
  - `getMyPermissions()` — membro atual consulta as próprias
- Guards em server functions sensíveis (chat, IA, biblioteca, clientes, trial, pricing) chamam `has_member_permission` antes de executar. Dono da conta (`owner_id = auth.uid()`) bypassa.

### UI

Nova aba **"Permissões da equipe"** em `admin.administrativo.tsx` (visível só para owner):
- Lista de membros ativos
- Grid de checkboxes por permissão, com badge "Requer plano X" quando a permissão depende de tier
- Salvamento otimista com toast

No frontend, esconder/desabilitar ações via `useMyPermissions()` hook — sempre com re-check no servidor.

### Ordem de implementação

1. Migração: tabela + função + RLS + grants
2. Server functions + guards nos endpoints sensíveis
3. UI da aba Permissões + hook `useMyPermissions`
4. Aplicar guards visuais em: chat de atendimento, editor de IA/KB, editor de biblioteca, `admin.clientes`, tela de trial, tela de pricing

Depois disto, retomamos a **Etapa 2 (popup de aceite de convite)** que ficou pendente.

Posso seguir?