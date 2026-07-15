
# Plano: Central de Atendimento + Handoff IA↔Humano

## 1. Modelo de acesso

**Equipe por conta (multi-usuário com papéis)**

Nova tabela `account_members` vinculando usuários ao anfitrião (owner):
- `owner_id` (dono da assinatura Business/Enterprise)
- `member_user_id` (atendente convidado)
- `role`: `owner` | `agent` | `viewer`
- `status`: `pending` | `active` | `revoked`

Tabela `account_member_invites` para convites por e-mail (padrão do `admin_invites` já existente). Aceite ao logar cria linha em `account_members`.

**Permissões:**
- `owner`: tudo (convidar/remover, configurar IA, ver todas conversas, responder, faturamento)
- `agent`: ver conversas atribuídas + fila, atribuir a si, responder, devolver pra IA
- `viewer`: só leitura (auditoria/supervisão)

Limite por plano:
- Business: até 3 atendentes (owner + 2)
- Enterprise: ilimitado (ou parametrizável)

## 2. Central de Atendimento (nova rota `/atendimento`)

Só habilitada se o anfitrião estiver em Business ou Enterprise ativo (`has_active_subscription` já existe).

Layout:
- Sidebar esquerda: filas (**Aguardando IA** → **Precisa humano** → **Meus** → **Todas** → **Resolvidas**)
- Centro: lista de conversas (nome do hóspede, propriedade, última mensagem, tempo de espera, badge de urgência)
- Direita: painel da conversa com:
  - Histórico completo (IA + hóspede + humanos)
  - Toggle **"IA ativa / Assumir"** por conversa
  - Composer com respostas rápidas
  - Notas internas (não visíveis ao hóspede)
  - Metadados (propriedade, check-in, telefone se houver)

Tabelas novas/estendidas:
- `property_chat_conversations` (já existe): adicionar `status` (`ai` | `needs_human` | `assigned` | `resolved`), `assigned_to`, `handoff_reason`, `handoff_at`, `last_message_at`
- `property_chat_messages` (já existe): adicionar `sender_type` (`guest` | `ai` | `human`), `sender_user_id`, `is_internal_note`

## 3. Gatilho de handoff (pedido explícito + incerteza da IA)

No prompt do sistema da IA de conversa do hóspede, adicionar instrução:

> Quando (a) o hóspede pedir explicitamente falar com humano, OU (b) você não tiver confiança na resposta, OU (c) detectar frustração/emergência, chame a ferramenta `request_human_handoff({ reason, urgency })`.

Server function `requestHumanHandoff` (via tool call):
1. Atualiza conversa: `status = 'needs_human'`, salva `handoff_reason`, `handoff_at`
2. Envia mensagem ao hóspede: *"Estou chamando um atendente humano, aguarde um instante."*
3. Dispara notificação web push para todos os `owner` + `agent` da conta
4. Aparece na fila **Precisa humano** em tempo real (Supabase Realtime)

Anfitrião pode ainda configurar sensibilidade no painel (**Configurações → IA**): `apenas explícito` / `explícito + incerteza` (padrão) / `agressivo`.

## 4. Janela flutuante no desktop

Componente `<FloatingHandoffDock />` renderizado no layout `_authenticated`:

- Desktop (≥1024px): widget fixo `bottom-6 right-6`, ~380×560px, com header (contador de pendentes + minimizar/fechar), lista compacta e chat inline. Persiste ao navegar entre rotas do painel. Estado (aberto/minimizado) em localStorage.
- Mobile (<1024px): botão flutuante que abre em tela cheia (rota `/atendimento`).

Abre automaticamente (com som + destaque) quando chega um novo handoff se estiver minimizado. Botão "Abrir central completa" leva pra `/atendimento`.

## 5. Notificações (Push + som + badge)

**Web Push via VAPID** (padrão Web Push, sem depender do Firebase):

- Gerar par de chaves VAPID → salvar `VAPID_PUBLIC_KEY` (VITE) e `VAPID_PRIVATE_KEY` (secret)
- Service worker `public/sw-push.js` (isolado do PWA app-shell — segue skill/pwa: SW de messaging fora da regra de kill-switch)
- Tabela `push_subscriptions` (user_id, endpoint, p256dh, auth, user_agent, created_at)
- Server function `subscribePush` / `unsubscribePush`
- Server function `sendHandoffPush(conversationId)` chamada dentro de `requestHumanHandoff` — envia para todas as subscriptions do owner + agents ativos
- Payload: título "Hóspede precisa de você", corpo com nome/propriedade, `data.url` → `/atendimento?conv=<id>`
- SW toca som ao receber (arquivo `/sounds/handoff.mp3`) e mantém badge com `navigator.setAppBadge(n)` (suportado em Chrome/Edge desktop e iOS PWA instalado)
- Quando anfitrião abre a conversa: `navigator.clearAppBadge()`

Aviso claro no onboarding do PWA em iOS: "Adicione à Tela de Início e abra pelo menos uma vez para receber notificações."

Página **Configurações → Notificações** com toggle por atendente para: push on/off, som on/off, horário silencioso.

## 6. Planos e cobrança

- **Business (R$ 399)**: habilitar Central + até 3 atendentes + push
- **Enterprise**: novo tier no Paddle (pré-cadastrar via `create_product` quando você definir preço), atendentes ilimitados, SLA, mesma feature

Bloqueio: middleware do route `/atendimento` verifica `has_active_subscription(user, 'live')` E plano `IN ('business','enterprise')` — senão redireciona pra `/upgrade` com CTA específico.

## 7. Realtime e UX

- `ALTER PUBLICATION supabase_realtime ADD TABLE property_chat_conversations, property_chat_messages;`
- Front assina mudanças da conta (filtrado por `owner_id`) → fila atualiza sem refresh
- Indicador "digitando" (humano) enviado via canal presence
- Quando humano assume: IA para de responder naquela conversa até owner clicar "Devolver pra IA"

## 8. Auditoria

Logs em `audit_logs` (já existe) para: convite enviado/aceito/revogado, conversa assumida, devolvida à IA, resolvida, notas internas criadas.

## 9. Segurança (RLS)

Todas as tabelas novas com RLS:
- `account_members`: SELECT pelos próprios membros; INSERT/DELETE só pelo owner
- `push_subscriptions`: cada usuário só vê/gerencia as próprias
- `property_chat_conversations` / `messages`: SELECT pelos membros ativos da conta dona da propriedade (helper `user_is_account_member(auth.uid(), property.owner_id)`)

## 10. Escopo entregável (ordem)

1. Migração: tabelas + policies + realtime + colunas novas
2. Server fns: convites, aceite, listar conversas, atribuir, enviar mensagem humana, handoff, push
3. Rota `/atendimento` + `<FloatingHandoffDock />`
4. Configurações: Notificações, Equipe, IA (sensibilidade)
5. Tool `request_human_handoff` no chat IA da landing e do guia
6. Onboarding VAPID + PWA install prompt no painel
7. Gate por plano + banner de upgrade

## Detalhes técnicos

- Push nativo via `web-push` npm (compatível com Cloudflare Workers, evita Firebase)
- SW de push isolado do PWA app-shell (skill/pwa)
- IA usa tool calling — se modelo atual não suportar bem, faz fallback: parser que detecta marcadores `[HANDOFF: motivo]` na resposta
- Realtime com filtro por `property.owner_id` via helper SECURITY DEFINER pra RLS
- Auto-reabertura da janela flutuante: `BroadcastChannel` entre abas evita som duplicado
- Enterprise no Paddle criado depois via `payments--create_product` quando você definir preço

Prazo estimado: 2–3 semanas de implementação incremental.
