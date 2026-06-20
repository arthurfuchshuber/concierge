## 1. Dashboard de Engajamento (admin/engajamento)

Reformular a página com 3 sub-abas mantendo o filtro por hospedagem e período (7/30/90 dias, customizado):

**Visão geral (nova aba inicial)**
- BigNumbers: Acessos totais, Hóspedes únicos, Conversas, Mensagens trocadas, Taxa de uso da IA (conversas/acessos), Respostas marcadas como ineficazes
- Gráfico de linha: evolução diária de acessos e conversas no período
- Gráfico de barras: top 5 hospedagens por engajamento
- Card "Usabilidade do anfitrião": guias criados, % com IA ativa, % com FAQs preenchidas, última edição

**Conversas (existente, melhorada)**
- Lista de conversas com novo indicador visual quando há mensagens marcadas como ineficazes
- Dentro de cada conversa, **cada resposta da IA** ganha um botão "Marcar como ineficaz" e, se já marcada, um botão **"Ensinar a IA"** que abre um modal:
  - Mostra a pergunta do hóspede + resposta original
  - Campo "Título do aprendizado" + "Como a IA deveria responder/se comportar"
  - Ao salvar, cria entrada na **nova base de conhecimento de comportamento** (`host_behavior`)
- Filtro extra: "Somente com respostas ineficazes"

**Métricas (existente)**
- Tabela por hospedagem mantida, com colunas novas: % ineficácia, último acesso

## 2. Nova base de conhecimento: Comportamento/Atuação

Tabela nova `host_behavior` (separada de `host_knowledge`):
- Mesma estrutura, mas usada exclusivamente para regras de **tom, persona, postura, modo de responder**
- Nova aba na página `/admin/biblioteca` chamada **"Comportamento da IA"** — informa claramente que serve para personalidade/atuação, não para fatos
- O prompt do chat (`/api/public/guide-chat`) passa a injetar tanto `host_knowledge` (informações) quanto `host_behavior` (atuação) em seções separadas do system prompt
- Marcar uma resposta como ineficaz e "ensinar" cria uma entrada em `host_behavior` automaticamente, vinculada à hospedagem de origem (mas global para o anfitrião)

Tabela nova `chat_message_feedback`:
- `message_id`, `property_id`, `owner_id`, `marked_by` (admin user), `reason` (texto opcional), `resolved` (bool — vira true quando o anfitrião ensina), `behavior_id` (FK para `host_behavior` quando resolvido), timestamps

## 3. Gating por plano (Business/Enterprise)

**No guia público (`g/$slug`)**
- O botão flutuante de mensagem/chat só renderiza se o plano do dono for `business` ou `enterprise`
- Loader do guia já carrega o plano do dono; passar essa flag pro componente

**No painel admin (formulário da propriedade + biblioteca)**
- Todos os campos relacionados à IA continuam visíveis
- Quando o plano não cobre IA: campos ficam `disabled`, com um overlay `Lock` e **Tooltip** explicando: *"Disponível nos planos Business e Enterprise. Faça upgrade para ativar a assistente IA do seu guia."* + botão/Link "Ver planos →" para `/precos`
- Aplica em: toggle "IA ativa" na propriedade, base de conhecimento (informações), base de comportamento, marcar ineficaz/ensinar IA na página de engajamento

## 4. Arquivos a criar/editar

**Migrations**
- `host_behavior` (mirror de host_knowledge) com GRANTs e RLS por owner
- `chat_message_feedback` com GRANTs e RLS por owner
- Política/grant ajustada

**Backend (server fns)**
- `src/lib/host-behavior.functions.ts` — CRUD análogo a host-library
- `src/lib/chat-feedback.functions.ts` — markIneffective, teachAi (cria host_behavior + marca resolved), listForConversation
- `src/lib/engagement-admin.functions.ts` — adicionar séries temporais, contagens de feedback, métricas de usabilidade do anfitrião
- `src/routes/api/public/guide-chat.ts` — injetar `host_behavior` no system prompt
- `src/lib/guide.functions.ts` (público) — expor flag `ai_enabled_for_plan` no guia

**Frontend**
- `src/routes/_authenticated/admin.engajamento.tsx` — reescrever com 3 abas + recharts (já no projeto)
- `src/routes/_authenticated/admin.biblioteca.tsx` — adicionar aba "Comportamento da IA"
- `src/components/admin/AiPlanLock.tsx` — wrapper com tooltip + lock
- `src/components/admin/TeachAiDialog.tsx` — modal de ensino
- `src/routes/g.$slug.index.tsx` — esconder botão de chat se plano não cobre IA
- `src/routes/_authenticated/admin.properties.$id.tsx` — congelar campos de IA quando plano não cobre

## Observações
- Recharts já está no projeto (usado em outros lugares); se não estiver, instalo
- As entradas em `host_behavior` criadas via "Ensinar IA" recebem um `title` automático tipo *"Aprendizado: <primeiros 40 chars da pergunta>"* e o corpo informado pelo anfitrião
- O anfitrião sempre pode editar/desativar manualmente as entradas geradas
