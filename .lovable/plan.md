## Objetivo

Habilitar contato proativo do anfitrião com o hóspede via WhatsApp, com espelhamento bidirecional na central de atendimento e IA respondendo pelo WhatsApp quando não pausada. Cada anfitrião conecta o próprio número WhatsApp Business via Sinch (BYO).

## Fluxo end-to-end

```text
┌ Anfitrião clica "Enviar WhatsApp" ──────────────────────────┐
│  Dashboard/Operação  |  Atendimento  |  /admin/hospedes     │
└───────────────┬─────────────────────────────────────────────┘
                │  server fn sendWhatsappMessage()
                ▼
        ┌──────────────────────┐        ┌────────────────────┐
        │ Grava mensagem em    │───────▶│ Sinch Conversations│───▶ WhatsApp do hóspede
        │ property_chat_msgs   │        │ API (número BYO)   │
        │ (channel='whatsapp') │        └────────────────────┘
        └──────────────────────┘
                                          Hóspede responde
                                                ▼
        ┌──────────────────────┐        ┌────────────────────┐
        │ Realtime → central   │◀───────│ /api/public/sinch/ │◀──── Sinch webhook
        │ + push ao anfitrião  │        │ whatsapp-webhook   │
        └──────────────────────┘        └────────────────────┘
                                                │
                              ai_paused? não ──▶ IA responde via mesma pipeline
```

## Cadastro por anfitrião (BYO)

Nova aba **WhatsApp Business** em `/admin/administrativo`:
- Passo-a-passo para criar conta na Sinch, verificar número na Meta, aprovar templates HSM.
- Formulário com: `service_plan_id`, `api_token` (mascarado), `sender_number` (E.164), `app_id` da Sinch Conversations.
- Botão "Testar conexão" → server fn faz um `GET /v1/projects/{id}/apps` para validar.
- Status visual: `pending` (sem credenciais) → `testing` → `active` → `error`.

Sem credenciais válidas, o botão "Enviar WhatsApp" fica desabilitado com tooltip "Configure WhatsApp em Administrativo".

## Modelo de dados

### Nova tabela `host_whatsapp_config`
- `owner_id uuid pk` (FK profiles/auth.users)
- `provider text default 'sinch'`
- `service_plan_id text`
- `api_token_encrypted text` (pgsodium)
- `sender_number text` (E.164)
- `app_id text` (Sinch Conversations app id)
- `webhook_secret text` (gerado — para assinar callbacks)
- `status text` (`pending`|`active`|`error`)
- `last_verified_at timestamptz`
- `last_error text`
- RLS: apenas o próprio `owner_id` e admins.

### Alterações em `property_chat_messages`
- `channel text default 'web'` (`web`|`whatsapp`)
- `external_id text` (message id retornado pela Sinch, para dedup)
- `delivery_status text` (`queued`|`sent`|`delivered`|`read`|`failed`)
- `sent_via_number text` (número emissor, para auditoria)
- Índice em `(external_id)` para dedup do webhook.

### Nova tabela `whatsapp_templates`
Templates HSM aprovados pelo anfitrião (necessários fora da janela 24h):
- `id uuid pk`, `owner_id uuid`, `name text`, `language text`, `body text`, `variables jsonb`, `sinch_template_id text`, `status text`

Todas com GRANT + RLS + policies scoped por `auth.uid()`.

## Server functions (`src/lib/whatsapp.functions.ts`)

Todas com `requireSupabaseAuth`:
- `saveWhatsappConfig({...})` — persiste credenciais criptografadas.
- `testWhatsappConfig()` — hit à API Sinch, atualiza `status`.
- `sendWhatsappMessage({ logId, body, templateId?, variables? })` — resolve telefone do hóspede via `guide_access_logs.guest_phone`, valida janela de 24h, envia via Sinch, grava em `property_chat_messages`. Retorna dedup key.
- `listWhatsappTemplates()` / `syncWhatsappTemplates()` — puxa templates aprovados da Sinch.

Helpers server-only em `src/lib/whatsapp.server.ts` (não importar de rotas):
- `sinchClient(config)` — wrapper fetch com auth.
- `encryptToken` / `decryptToken` — via pgsodium.
- `matchConversation(fromNumber, ownerId)` — casa telefone → `property_chat_conversations` ativa (checkin ≤ hoje ≤ checkout+1d).

## Server route pública (webhook)

`src/routes/api/public/whatsapp/sinch-webhook.ts`:
- POST; valida assinatura HMAC com `webhook_secret` do config do owner (deriva pelo `app_id` do payload).
- Dedup por `external_id`.
- Grava mensagem entrante como `role='guest'`, `channel='whatsapp'`.
- Se conversa tem `ai_paused=false` e mensagem é do hóspede: enfileira chamada à IA (reusa `src/routes/api/public/guide-chat.ts`).
- Callbacks de status (`delivered`/`read`) atualizam `delivery_status`.
- Sempre retorna 200 rápido (idempotente).

## UI

### Botão "Enviar WhatsApp"
Componente compartilhado `<WhatsappComposerButton logId propertyId />` usado em:
1. `ArrivalCard` do dashboard (ícone WhatsApp verde ao lado do "Realizado ✓").
2. `ConversationView` da central (barra superior, junto ao "Assumir").
3. Cards de `/admin/hospedes`.

Ao clicar → `<WhatsappComposerDialog>`:
- Header: nome do hóspede, número (E.164), residência, código da reserva.
- Chips com templates aprovados (categoria: Boas-vindas, Check-in, Check-out, Alerta). Chip preenche o textarea substituindo variáveis (`{{guest_name}}`, `{{property}}`, `{{time}}`).
- Textarea livre (só habilitado se estiver dentro da janela 24h; fora, força seleção de template).
- Preview do "cabeçalho" (de quem vai, para quem).
- Botão "Enviar" → `sendWhatsappMessage`.
- Toast de sucesso + push ao próprio anfitrião de confirmação de entrega quando o callback chegar.

### Central de atendimento (`ConversationView`)
- Bolhas WhatsApp ganham badge verde `WhatsApp` no rodapé com ícone.
- Ícones de status (✓ enviado, ✓✓ entregue, ✓✓ azul lido) como no WhatsApp real.
- Mensagens do WhatsApp e do chat web ficam na mesma timeline unificada.

### Realtime
`property_chat_messages` já tem canal Supabase Realtime; garantimos que o `channel` novo é replicado.

## Regras de negócio importantes

- **Janela de 24h**: fora dela só template HSM. Backend rejeita texto livre e retorna erro amigável.
- **`ai_paused`**: se o atendente humano assumiu (mesma regra atual do handoff), a IA **não** responde webhooks entrantes. Já implementado; validamos com teste.
- **Consentimento**: novo checkbox no `GuideAccessGate` — "Aceito receber mensagens do anfitrião no WhatsApp". Sem opt-in, botão desabilitado com aviso.
- **Rate limit**: máx. 60 envios/hora por anfitrião, para conter erro operacional.
- **Auditoria**: cada envio grava em `audit_logs` com `action='whatsapp.sent'`.

## Segurança

- API token da Sinch criptografado em repouso via pgsodium (nova extensão).
- Webhook valida HMAC + timing-safe compare.
- Nunca retornar `api_token` ao cliente (apenas máscara `sp_***abc`).
- URL do webhook usa `project--{id}.lovable.app/api/public/whatsapp/sinch-webhook` (estável).

## Escopo do MVP

Incluso:
- Cadastro BYO + teste de conexão + status.
- Envio proativo com templates + texto livre.
- Recebimento com espelhamento na central.
- IA responde pelo WhatsApp respeitando `ai_paused`.
- Delivery/read receipts.
- Consentimento do hóspede.

Fica para depois (não implementar agora):
- Templates com mídia/botões interativos.
- Envio em massa/broadcast.
- Analytics de engajamento por template.
- Fallback SMS.

## Ordem de execução

1. Migração: `host_whatsapp_config`, colunas em `property_chat_messages`, `whatsapp_templates`, extensão `pgsodium`, publicação Realtime.
2. Helpers server-only + server functions + testes via `supabase--read_query`.
3. Server route pública do webhook (com verificação de assinatura).
4. UI: aba **WhatsApp Business** em Administrativo (setup + templates).
5. UI: `<WhatsappComposerDialog>` + botão nos 3 pontos de entrada.
6. UI: badges de canal + status no `ConversationView`.
7. Consentimento no `GuideAccessGate`.
8. Teste end-to-end com número real do usuário via Playwright (envio + recebimento + IA respondendo).

## Arquivos a criar/editar

**Novos:**
- Migration `host_whatsapp_config` + alterações `property_chat_messages` + `whatsapp_templates`.
- `src/lib/whatsapp.functions.ts`, `src/lib/whatsapp.server.ts`, `src/lib/whatsapp-templates.ts`.
- `src/routes/api/public/whatsapp/sinch-webhook.ts`.
- `src/components/whatsapp/WhatsappComposerDialog.tsx`, `WhatsappComposerButton.tsx`, `WhatsappStatusIcon.tsx`.
- `src/components/admin-pages/WhatsappBusinessPage.tsx`.

**Editar:**
- `src/routes/_authenticated/admin.administrativo.tsx` — adicionar aba.
- `src/routes/_authenticated/admin.dashboard.tsx` — botão no `ArrivalCard`.
- `src/components/handoff/ConversationView.tsx` — botão + badges de canal + ícones de status.
- `src/routes/_authenticated/admin.hospedes.tsx` — botão na linha.
- `src/components/GuideAccessGate.tsx` — checkbox de opt-in WhatsApp.
- `src/routes/api/public/guide-chat.ts` — permitir origem `whatsapp` para acionar IA.

## O que vou precisar de você

1. Após aprovar o plano, criarei a estrutura toda. Ao chegar na parte de teste real, você precisará:
   - Criar conta na Sinch (grátis, aprovação Meta leva 1–7 dias).
   - Cadastrar 1 template HSM de boas-vindas para o primeiro teste (posso te ajudar com o texto).
   - Colar as credenciais na aba nova (fica seguro, criptografado).
2. Você concorda com o rate limit de 60/hora por anfitrião como padrão inicial? (podemos ajustar depois).