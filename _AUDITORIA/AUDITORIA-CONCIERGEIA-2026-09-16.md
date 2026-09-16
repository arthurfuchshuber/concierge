# Auditoria forense — ConciergeIA (16/09/2026)

**Base auditada:** Lovable, projeto `c6a061b9…`, commit `f7beeaa8` ("Corrigiu a posição do ícone do olho", 16/09 01:14 UTC). Conferi o histórico de novo antes de empacotar e não havia commit mais novo.
**Banco:** Supabase `dpoixnumgawkcavilzwo`, lido direto pelo `query_database`.
**Entrega:** ZIP só com os arquivos alterados ou novos (20), mais este relatório e em `REMOVER-NO-LOVABLE.md`.

---

## 1. Resumo executivo

O painel autenticado está bem montado. Todas as 100 tabelas têm RLS, as funções `SECURITY DEFINER` não podem ser executadas pelo `anon` e todo `search_path` é fixo. As rotas de cron conferem o segredo em tempo constante. Os webhooks do ClickSign, do Sinch e do Paddle validam a assinatura. As funções do painel usam `requireSupabaseAuth` e leem pelo cliente com RLS antes de gravar com a chave de serviço.

**O risco real estava na parte pública (guia do hóspede e IA).** Encontrei um caminho direto para as **senhas físicas dos imóveis** (portão e fechadura):

1. O sitemap público lista o link de todos os 8 guias publicados.
2. A função `getPublicGuide` devolvia Wi-Fi, código do portão e código da fechadura para **qualquer chamada**. O código de reserva do formulário só era cobrado na tela.
3. A IA do guia entregava os mesmos códigos pela ferramenta `get_property_facts` a qualquer visitante, inclusive na vitrine da landing.
4. No formulário, um código de reserva `%%%%` passava como válido, porque o `ilike` aceitava curinga.

Esses quatro pontos estão **corrigidos no ZIP**. O segundo achado mais grave **não se corrige por código e depende de você**: o `CRON_SECRET` de produção está gravado em 13 migrations do repositório e é o mesmo que os 12 crons usam hoje (seção 14).

**Mudanças aplicadas:** 1 migration no banco (limites de tamanho dos buckets) e 20 arquivos no ZIP (17 alterados, 3 novos). Nada foi removido: o ZIP não apaga arquivos, e a lista para limpeza está em `REMOVER-NO-LOVABLE.md`.

---

## 2. Arquitetura encontrada

```
Hóspede (anônimo)                         Equipe (logada)
   │ /g/<slug>  (SSR + server fns públicas)   │ /admin/*  (_authenticated → requireSupabaseAuth)
   │ /api/public/guide-chat, uploads, push    │ server fns → cliente RLS  (+ supabaseAdmin após checagem)
   ▼                                          ▼
TanStack Start (Cloudflare/nitro) ── src/server.ts (wrapper) ── start.ts (middlewares: auth-attacher, audit)
   │                    │                          │
   │                    ├─ IA: orchestrator → intent/planner/supervisor → tools → validate/reflection
   │                    │       (Lovable AI Gateway, Firecrawl, Google Places via connector-gateway)
   │                    └─ Integrações: Paddle, ClickSign, Sinch/WhatsApp, Channex, iCal Airbnb, Google Calendar, web-push
   ▼
Supabase (Postgres + RLS + Storage privado + pg_cron → /api/public/cron/*  com x-cron-secret)
```

**Pontos únicos de falha:**
- **Lovable AI Gateway:** chat, landing, transcrição e geração de conteúdo dependem dele.
- **Rate limit em memória:** zera a cada deploy e não é compartilhado entre instâncias do Worker.
- **Um único `CRON_SECRET`:** o mesmo segredo protege todos os crons.

---

## 3. Inventário (resumo)

| Área | Quantidade |
|---|---|
| Arquivos no repositório (HEAD) | ≈ 855, sendo 250 migrations |
| Arquivos de rota `.tsx` (páginas e layouts) | 44 (6 prerenderizadas + guia + `/admin/*`) |
| Rotas `/api/public/*` | 29 (16 crons, 5 de integração/webhook, 8 do hóspede ou da landing, 1 de versão) |
| Server functions **sem** autenticação | 26, todas do guia, da landing ou da taxonomia pública (1 é o exemplo do template) |
| Tabelas `public` | 100, todas com RLS (3 com `FORCE`) |
| Funções `SECURITY DEFINER` | 40, nenhuma executável pelo `anon` |
| Buckets | 5, todos privados |
| Crons ativos | 12 |
| Testes | 16 arquivos, 116 casos |

---

## 4. Achados de segurança

| ID | Sev. | Onde | Descrição | Status |
|---|---|---|---|---|
| S-01 | **CRÍTICO** | `lib/guide.functions.ts` (`getPublicGuide`) + `sitemap.xml` | Senhas de portão, fechadura e Wi-Fi entregues a qualquer chamada direta. O código de reserva era validado só no navegador. Os slugs são públicos pelo sitemap. | **Corrigido.** Nos guias "Check-In & Check-Out" com iCal, os três campos não saem mais e só chegam por `revealGuideAccessCodes`, com código de reserva ativo. |
| S-02 | **CRÍTICO** | `lib/ai/tools.server.ts` (`get_property_facts`), `guide-chat.ts` | A IA devolvia os códigos sem máscara quando o imóvel não tinha PIN (todos hoje). A trava por regex (`guest-safety`) se contorna com outras palavras ("password", "número do portão"). Valia também na vitrine da landing. | **Corrigido.** O chat valida o `reservationCode`, que o widget já enviava e o servidor descartava. Sem prova, a conversa roda com `credentialsLocked`: ferramentas, RAG e evidências mascaradas. |
| S-03 | **ALTO** | `validateGuideReservationCode` / `recordGuideAccess` | O código de reserva ia para um `ilike` sem escape. `%%%%` casava com qualquer reserva e liberava o formulário. | **Corrigido.** Curingas são recusados em `guest-access.server.ts`. |
| S-04 | **ALTO** | Crons (`supabase/migrations/*`, `cron.job`) | O `CRON_SECRET` de produção está em 13 migrations. Com ele, qualquer pessoa com acesso ao código dispara check-out automático, mensagens proativas pelo WhatsApp, reindexação e avaliações (custo). | **Requer ação humana**: rotação (seção 14). |
| S-05 | **ALTO** | `submitPin` / `submitAccessPin` / `guide-chat` | Os cookies de PIN tinham valor fixo `"ok"` e podiam ser forjados. Não havia limite de tentativas contra força bruta. | **Corrigido.** Cookie assinado com HMAC (imóvel + validade + PIN vigente), comparação em tempo constante e limites por IP e por guia. Nenhum imóvel usa PIN hoje. |
| S-06 | **ALTO** | `lib/plan-guard.server.ts` | Assinatura de *sandbox* com `is_manual` valia em produção. O webhook grava `is_manual` a partir do `customData.admin_created`, que é montado no navegador: um checkout de teste com essa flag liberava plano pago. | **Corrigido.** Entre ambientes, só vale liberação manual com id `manual_…`, criada pelo painel admin. As duas liberações existentes seguem esse padrão. |
| S-07 | **MÉDIO** | `markGuideStayStep` | Público: marcava check-in ou check-out "concluído" de qualquer hóspede só com slug e data (o nome era opcional). Isso aciona a liberação de limpeza. | **Corrigido.** Nome obrigatório e, nos guias com código, código ativo com a mesma data de entrada. |
| S-08 | **MÉDIO** | `recordGuideAccess` → painel Hóspedes | `guest_documents.file_url` livre virava link no painel. Um `file_path` de outro imóvel seria assinado com a chave de serviço. | **Corrigido.** `file_url` é descartado e `file_path` precisa ser `<id do imóvel>/<uuid>.<ext>`. Hoje não há nenhum registro afetado. |
| S-09 | **MÉDIO** | `getCityNews` | Público: o `cityLabel` vinha do cliente e ia direto para o prompt e o cache do dia. Isso permitia envenenar o feed de uma cidade real e gerar custo com cidades inventadas. | **Corrigido.** A cidade precisa ter guia publicado, o nome usado é o do banco e há rate limit. |
| S-10 | **MÉDIO** | `guide-transcribe`, `guide-chat-upload`, `submitLandingLead`, `landing-chat` | Faltava rate limit (transcrição paga, upload de 20 MB, e-mail para a equipe). O `landing-chat` e o `guide-chat` usavam o 1º item do `x-forwarded-for`, que o cliente controla, e com isso o limite não valia. | **Corrigido.** |
| S-11 | **MÉDIO** | Storage | Nenhum bucket tinha limite de tamanho ou tipo. | **Corrigido no banco** (migration `20260916180000`). Os limites ficam acima do que o app já aceita. |
| S-12 | **MÉDIO** | `webhook-channex-reservas` | O segredo só é exigido "se configurado". Sem `CHANNEX_WEBHOOK_SECRET`, qualquer um enfileira eventos. A comparação não é em tempo constante (também em `channex-processar-fila`). | **Requer validação humana** (não consegui ver se a variável existe). |
| S-13 | **MÉDIO** | RLS com `is_account_member` | Membros da conta têm `ALL` em `ai_conversations`, `ai_messages`, `tasks`, `property_providers` etc. direto pela API REST, sem passar pelas permissões granulares do app. | **Requer decisão de produto.** |
| S-14 | BAIXO | `admin-subs` / `events.server` | A busca montava filtro `or()` do PostgREST com texto livre (só admin). | **Corrigido** (sanitização). |
| S-15 | BAIXO | Respostas HTTP | Faltavam `nosniff`, `Referrer-Policy` e HSTS. | **Corrigido** em `server.ts`. CSP, `frame-ancestors` e `Permissions-Policy` ficaram de fora de propósito (seção 13). |
| S-16 | BAIXO | Funções `has_role` / `is_account_member` | Um usuário logado pode consultar papéis de **outro** `user_id` (enumeração). | Mantido. Recomendação na seção 13. |
| S-17 | BAIXO | `default-faqs.ts` | Gerar as FAQs padrão num guia com código de reserva escreveria a senha em texto na FAQ pública. Hoje nenhuma FAQ contém senha (conferido no banco). | **Corrigido.** |
| S-18 | INFO | `.env*` | Só chaves públicas: anon, token cliente do Paddle, chave de navegador do Maps. Nenhum segredo de servidor no bundle (conferido no build). | A chave do Maps deve ter restrição por referer no Google Cloud (**não foi possível verificar**). |
| S-19 | INFO | `get_property` (MCP OAuth) | Devolve `airbnb_ical_url` (feed privado do calendário) a apps autorizados. | Recomendação. |

---

## 5. Achados de privacidade

| ID | Sev. | Descrição | Status |
|---|---|---|---|
| P-01 | MÉDIO | `context.server.ts`: sem nome de hóspede, a IA recebe **a reserva mais recente** do imóvel (nome e datas de outra pessoa) como contexto de um visitante anônimo. | Requer decisão. Com S-02 as senhas já não vazam, mas o nome ainda pode aparecer. |
| P-02 | BAIXO | `ai_system_events` (191 MB, desde 04/08) e `audit_logs` (125 MB) sem política de retenção. Guardam `user_agent`, trilha de cliques e erros. | Recomendação: retenção de 90 a 180 dias. |
| P-03 | BAIXO | Cache do painel no `localStorage` por 7 dias (dados operacionais e PII). É apagado no logout. | Aceitável, com a ressalva de aparelhos compartilhados sem logout. |
| P-04 | INFO | Documentos de hóspedes em bucket privado, entregues só por URL assinada. | OK |

---

## 6. Achados funcionais

- **F-01. Cron `refresh-airbnb-listings-daily` não existe no `cron.job`.** A migration de 03/09 o criou, mas ele sumiu. A sincronização diária dos anúncios não está rodando. SQL pronto na seção 14.
- **F-02.** O chat do guia enviava `checkinDate`, `checkoutDate` e `reservationCode`, e o servidor descartava os três. Por isso o "modo grupo" do roteiro nunca é ativado pelo guia. Passei a usar o código (S-02); as datas continuam ignoradas, porque ativar o modo grupo muda comportamento.
- **F-03.** `permission-center.test.tsx`: corrigi o mock (faltavam 3 funções). Restam 2 testes com texto antigo ("Você não tem permissão para gerenciar acessos." e "Nenhuma pessoa nesta conta ainda."), que a tela não usa mais. **Requer validação humana** de qual texto vale.
- **F-04.** `place-photo`: `w` não numérico vira `NaN` na URL (baixo impacto).

## 7. Performance

- **Custo por mensagem da IA:** 4 a 7 chamadas de modelo (intenção, supervisor, planner, agente, validação, reflexão, respostas rápidas). O paralelismo já aplicado ajuda. O próximo ganho seria pular o supervisor em intents simples.
- **`lookupReservationByCode` roda em toda mensagem do chat nos guias com código.** O iCal só é buscado a cada 10 min (`ensurePropertyIcalFresh`), então o custo extra é uma consulta indexada.
- **102 índices em `public` com `idx_scan = 0`.** São candidatos a revisão; não apaguei nenhum, porque o contador zera em restart ou reset de estatísticas.
- **`g.$slug.index.tsx` tem 5,5 mil linhas e `OperationWorkspace.tsx` 9,6 mil.** O custo de manutenção é alto, e dividir os dois é recomendado.
- **Rate limit em memória:** não protege entre instâncias do Worker. Para abuso real, o caminho é Cloudflare Rate Limiting ou uma tabela.

## 8. Código morto / não utilizado

Verificação: nenhum `import` estático ou dinâmico, nenhuma menção em `scripts/` e nenhuma rota. `audit-fn-labels.server.ts` cita alguns nomes, mas só como rótulos de texto.

| Item | Tipo | Confiança | Risco | Ação |
|---|---|---|---|---|
| `lib/city-pulse.functions.ts` | server fn pública | CERTAIN | baixo | remover |
| `lib/api/example.functions.ts` + `lib/config.server.ts` | exemplo do template | CERTAIN | baixo | remover |
| `lib/chat.functions.ts` (`askConcierge`) | server fn | HIGH | baixo | remover |
| `lib/ai-ops.functions.ts`, `lib/ai/reindex-all.functions.ts`, `lib/engagement-admin.functions.ts`, `lib/etiquetas.functions.ts`, `lib/host-behavior.functions.ts`, `lib/recommendations-move.functions.ts` | server fns sem tela | HIGH | médio (podem ter sido pensadas para uso futuro) | validar e remover |
| `lib/ai/governance/scopes.ts` | módulo | HIGH | baixo | remover |
| `lib/permissions/permission.selftest.server.ts`, `permission.enforce.selftest.server.ts`, `permission.migration.selftest.server.ts`, `permission.migration.report.server.ts` | autotestes / relatório | HIGH | médio (uso manual?) | validar |
| `components/ds/TypingIndicator.tsx`, `engagement/ConversationsTable.tsx`, `guide/FirstVisitTour.tsx`, `landing/ChatMockup.tsx`, `landing/GuideMockup.tsx`, `permissions/UserAccessManager.tsx`, `permissions/UserPermissionSummary.tsx` | componentes | HIGH | baixo | remover |
| 23 componentes `ui/` sem uso (alert, aspect-ratio, avatar, breadcrumb, carousel, chart, collapsible, context-menu, form, hover-card, input-otp, menubar, navigation-menu, pagination, progress, radio-group, resizable, separator, sidebar, slider, table, toggle, toggle-group) | shadcn do template | HIGH | baixo | remover |
| Dependências que só esses `ui/` usam: `embla-carousel-react`, `input-otp`, `react-hook-form`, `@hookform/resolvers`, `react-resizable-panels`, 13 pacotes `@radix-ui/*` | npm | MEDIUM | médio (lockfiles) | remover **depois** dos arquivos, no Lovable |
| `ai`, `@ai-sdk/openai-compatible`, `@mendable/firecrawl-js`, `qrcode` | npm sem import em `src/` | MEDIUM | médio | validar |

## 9. Removido

**Nada.** Um ZIP não apaga arquivos, e a regra desta auditoria é não remover sem validação. A lista acima está em `REMOVER-NO-LOVABLE.md`.

## 10. Alterado

| Arquivo | O quê |
|---|---|
| `src/lib/guest-access.server.ts` (**novo**) | Regra única de "prova de acesso": `isReservationGated`, `lookupReservationByCode` (movida, com a trava de curinga), cookies HMAC, `safeEqual`, máscara. |
| `src/lib/guide.functions.ts` | S-01, S-05; nova `revealGuideAccessCodes`; `airbnb_ical_url` nunca vai ao navegador. |
| `src/routes/g.$slug.index.tsx` | Pede as senhas com o código salvo (efeito novo + pós-PIN); manda o código ao marcar check-in/out. |
| `src/lib/guide-access.functions.ts` | S-03 (delegação), S-07, S-08. |
| `src/routes/api/public/guide-chat.ts` | S-02 (prova da reserva), S-05 (cookie), S-10 (IP). |
| `src/lib/ai/orchestrator.server.ts` | Parâmetro `credentialsLocked`; RAG mascarado quando travado. |
| `src/lib/ai/tools.server.ts` | `search_knowledge_base` respeita a trava (resposta e evidência). |
| `src/lib/plan-guard.server.ts` | S-06. |
| `src/lib/city-news.functions.ts` | S-09. |
| `src/lib/default-faqs.ts` | S-17. |
| `src/lib/landing-leads.functions.ts`, `routes/api/public/guide-transcribe.ts`, `guide-chat-upload.ts`, `landing-chat.ts` | S-10. |
| `src/lib/admin-subs.functions.ts`, `src/lib/ai/audit/events.server.ts` | S-14. |
| `src/server.ts` | S-15. |
| `src/lib/__tests__/guest-access.test.ts` (**novo**) | 8 testes das travas. |
| `src/lib/permissions/__tests__/permission-center.test.tsx` | Mock completo (F-03). |
| `supabase/migrations/20260916180000_storage_bucket_limits.sql` (**novo**, **já aplicado no banco**) | S-11. O rollback está no próprio arquivo. |

Todos os comentários novos explicam o porquê, com a data, para o extrator de conhecimento do Assistente.

## 11. Mantido de propósito

- **`src/routes/README.md`, `mem/*`, `.lovable/plan/*`:** documentação do processo.
- **`public/llms.txt`, `sw-*.js`:** usados por service workers e crawlers.
- **Migrations antigas com o segredo:** apagar do repositório não resolve, porque o segredo já está no histórico. A correção é rotacionar (seção 14).
- **Os 102 índices sem uso aparente:** motivo na seção 7.
- **`guest-safety.server.ts`:** continua valendo como primeira barreira.
- **Guias sem código de reserva:** continuam liberando as senhas pelo link (regra antiga), porque não há contra o que validar. Hoje todos os 8 guias publicados têm código.

## 12. Testes executados

Ambiente: árvore reconstruída byte a byte a partir do Lovable (diff completo do repositório mais leitura dos arquivos grandes), `npm install`, e as versões fixadas no processo (`react-router 1.170.16`, `react-start 1.168.26`, `zod 4.4.3`).

| Comando | Antes | Depois |
|---|---|---|
| `npx tsc --noEmit` | EXIT 0 | **EXIT 0** |
| `npx vitest run` | 105 ok / 3 falhas (permission-center) | **114 ok / 2 falhas** (mesmo arquivo, texto antigo — F-03) |
| `npx vite build` | — | **EXIT 0** (prerender das 7 páginas ok) |
| `eslint` nos arquivos tocados | — | Nenhum erro novo nas linhas alteradas, exceto 3 strings `select(...)` que já passavam de 100 colunas antes |
| `prettier --check` nos arquivos novos ou pouco tocados | — | ok |
| Bundle do cliente | — | Sem `SUPABASE_SERVICE_ROLE_KEY`, sem o segredo de cookie |
| `npm audit --omit=dev` | — | 1 baixo (esbuild em dev/Windows) |

**Limitações (não foi possível verificar):**
- **Stubs no build:** 23 componentes `ui/`, `__root.tsx`, `index.tsx` e `styles.css` entraram no build local como **stubs** (não estão no ZIP). O `tsc` e o build validam a lógica, não o visual.
- **Sem navegador:** não abri o guia num navegador real nem executei a exploração contra produção. S-01 e S-02 foram provados **pela leitura do código e do banco**, não por ataque.
- **Auditoria de dependências:** o `npm audit` usou uma instalação nova, não o `bun.lock`/`package-lock.json` do projeto.
- **Variáveis não visíveis:** não consigo ver `CHANNEX_WEBHOOK_SECRET` nem as restrições da chave do Maps.
- **Varredura parcial de IDOR:** a busca de IDOR nas 44 funções do painel que usam a chave de serviço foi heurística. Nas 12 que li inteiras, a leitura passa pela RLS antes de gravar. As outras 32 **não foram lidas uma a uma**.

## 13. Riscos remanescentes

1. **S-04:** rotação do `CRON_SECRET` (a mais urgente).
2. **S-12:** exigir o segredo do Channex sempre.
3. **S-13:** RLS de membro com `ALL` em tabelas sensíveis.
4. **P-01:** contexto da IA com reserva de terceiro.
5. **CSP e `frame-ancestors`:** exigem teste com Meta Pixel, Google Fonts, Maps, Paddle e o iframe da landing.
6. **`Permissions-Policy`:** pode quebrar pagamento no iframe do Paddle.
7. **Janela de 24h:** as senhas liberadas com código de reserva não respeitam a janela "24h antes do check-in". Hoje saem desde o preenchimento do formulário, que já era o comportamento da tela. É decisão de produto.
8. **Enumeração de papéis:** `has_role`, `is_account_member` e `user_can_access_property` aceitam `_user_id` arbitrário. Dá para trocar por wrappers sem parâmetro.
9. **Rate limit em memória** (seção 7).

## 14. Revisão humana necessária

### 14.1 Rotação do segredo dos crons (S-04), nesta ordem
1. Gere um segredo novo (48+ caracteres) e troque `CRON_SECRET` nas variáveis do projeto no Lovable. Publique.
2. No banco, rode o script abaixo (já testado em modo simulação: troca o segredo nos 12 jobs e nenhum fica com o antigo):
```sql
select vault.create_secret('<NOVO_CRON_SECRET>', 'cron_secret', 'x-cron-secret dos crons');
do $$ declare j record; begin
  for j in select jobid, command from cron.job where command like '%''x-cron-secret''%' loop
    perform cron.alter_job(j.jobid, command := regexp_replace(j.command,
      '''x-cron-secret''(\s*),(\s*)''[A-Za-z0-9_-]+''',
      '''x-cron-secret''\1,\2(select decrypted_secret from vault.decrypted_secrets where name = ''cron_secret'')', 'g'));
  end loop; end $$;
```
3. Confira em `net._http_response` que as próximas execuções voltaram com status 200.
4. Daqui em diante, migration de cron **nunca** leva o segredo literal: usa a leitura do Vault acima.

### 14.2 Recriar o cron de anúncios (F-01), depois do 14.1
```sql
select cron.schedule('refresh-airbnb-listings-daily', '0 2 * * *',
  replace((select command from cron.job where jobname = 'sync-airbnb-ical-30min'),
          '/cron/sync-airbnb-ical', '/cron/refresh-airbnb-listings'));
```

### 14.3 Outros itens
- **S-12:** confirmar que `CHANNEX_WEBHOOK_SECRET` existe. Depois dá para tornar o segredo obrigatório no código.
- **F-03:** decidir o texto certo dos 2 testes.
- **Seção 8:** validar e apagar no Lovable (lista em `REMOVER-NO-LOVABLE.md`).
- **Chave do Maps:** conferir a restrição por referer no Google Cloud.

---

## 15. Revisão do próprio trabalho: o que conferir antes de publicar

1. **Senhas nos guias com código (S-01).** Abra um guia "Check-In & Check-Out" num aparelho que **já tinha preenchido** o formulário. As senhas devem aparecer sozinhas, uma fração de segundo depois da tela, porque agora vêm de uma segunda chamada. Se alguém tiver preenchido **sem** código (não deveria ser possível nesses guias), verá os campos vazios até preencher de novo.
2. **Pré-visualização e vitrine.** Na pré-visualização do painel, as senhas continuam aparecendo. **No chat** da pré-visualização e da vitrine da landing, a IA agora responde com as senhas travadas. É intencional, mas pode surpreender quem testa o chat pelo painel.
3. **Chat sem prova de reserva.** Em conversa travada, sequências de 3+ dígitos saem como "[BLOQUEADO — liberar no guia]", o que inclui números de endereço e telefones. Hóspede com código não é afetado.
4. **Marcar check-in/out pelo guia.** Agora exige o nome e, nos guias com código, o código salvo. Aparelhos antigos já têm os dois. Vale testar uma vez.
5. **Crons e `server.ts`.** Os cabeçalhos novos não mudam nenhum comportamento, mas confira que a landing ainda abre o guia no iframe (nenhum cabeçalho de enquadramento foi adicionado).
6. **Formatação.** O `g.$slug.index.tsx` e o `guide.functions.ts` não estavam no padrão do Prettier antes. Não reformatei os arquivos inteiros (regra do processo), só as linhas novas.
7. **`src/server.ts`.** É o único arquivo do ZIP que eu digitei a partir da leitura, em vez de copiar byte a byte. O conteúdo original foi mantido e só entrou o bloco de cabeçalhos. Vale olhar o diff no Lovable.
