# ConciergeIA Guest — invariantes do módulo (F0 + F1)

Leia antes de mudar qualquer arquivo desta pasta. Vale para pessoas e agentes.

## Limites de responsabilidade
- `slot.server.ts` é o ÚNICO ponto que os canais chamam. Contrato: só identificadores (`surface`, `conversationId`, `messageId`, `expectedOwnerId?`). Nunca cliente de banco, imóvel, dono, nome ou texto vindos do canal. Hoje devolve `null` (fallback humano); o Context Engine ainda não é chamado daqui.
- `data/` RECUPERA dados. `context/` ORGANIZA o `GuestContext`. `policy/` DECIDE o que é permitido. Nenhuma camada faz o trabalho da outra.
- `policy/` é pura: não importa `data/`, não consulta banco, rede nem relógio (`Date.now()`/`new Date()` proibidos; o instante chega por parâmetro). As políticas não geram frases nem roteiros de conversa.

## Fronteira de dados e isolamento
- Só `data/client.server.ts` importa o cliente administrativo. O teste `data-boundary.test.ts` quebra o build se outro arquivo de `guest-ai/` fizer isso.
- Toda função de `data/` exige um `ValidatedTurn` emitido por `validateTurnScope` (registro em `trust.ts`; objeto forjado ou copiado é recusado). O escopo confirma no BANCO: mensagem existe, é desta conversa, é do hóspede (`role='user'` E `sender_type='guest'`, não nota interna); canal confere com a sessão (`wa:`, `airbnb:`, demais = guia) E com `property_chat_messages.channel` (`web`/`whatsapp`/`airbnb`); imóvel existe e tem dono; `expectedOwnerId`, se vier, é o dono real.
- `imóvel`, `conta` e `reserva` são sempre derivados do turno validado, nunca de parâmetro do cliente.
- `property_chat_conversations.reservation_id` não tem chave estrangeira: a reserva só vale se existir E for do mesmo imóvel; senão é conflito, nunca a reserva alheia.
- Não enfraquecer RLS nem criar atalho administrativo fora deste módulo.

## Projeções (proibido `select *` em dados sensíveis)
- Colunas por finalidade em `data/projections.ts`: escopo, público (P), operacional (G), Dossiê sem credenciais, credenciais.
- Segredos (`lock_code`, `gate_code`, `wifi_password`, `pin_code`, `access_codes_pin`, `lock_instructions`, `gate_instructions`) só em `PROPERTY_CREDENTIAL_COLUMNS`, usada só por `data/credentials.server.ts`.
- Nunca carregar uma senha para depois apagá-la. O Dossiê é montado por `buildPlaybook` com uma projeção SEM credenciais; `projectDossier` ainda retém linhas secretas e chaves de credencial (defesa em profundidade).
- Cobertura integral do anúncio (`data/listing-normalized.ts`, aprovada em 02/11/2026): todos os fatos de `normalized.facts` entram, sem descarte nem truncamento; `public_listing` e os reviews públicos também. Três recortes, só esses: (1) em `identificacao`, o prefixo interno do título ("<conta> <apelido> · …", com nome/telefone do anfitrião) é isolado com `splitListingTitle`; sem separação comprovada, a linha do título sai inteira; (2) dos reviews entra só o "Public review" (+ nota, data, resposta do anfitrião), nunca o "Private feedback"; (3) `cohosts` fica fora (é repasse de pagamento interno).
- Audiências do Dossiê: P (Público) sempre; G (Reserva Ativa) só com reserva confirmada, sem no-show, em `pre_stay`/`in_stay`; I (Equipe Interna) nunca para hóspede. A nota do anfitrião herda a audiência da linha.

## D9 — liberação de credenciais (`policy/credential-policy.ts`)
Ordem obrigatória, a primeira que bate encerra:
1. VETO 1: reserva inexistente/inválida/cancelada → deny.
2. VETO 2: no-show (reserva OU cartão de check-in) → deny. Absoluto: nada o supera.
3. VETO 3: checkout confirmado (`guest_arrival_status` kind=checkout com done/no_show, `done_at` ou `concluded_at`) → deny imediato. `concluded_at` de cartão de CHECK-IN não conta.
4. Dados de tempo não comprovados (fuso, check-in, checkout, `now`) → deny.
5. VETO 4: agora > corte de checkout → deny. Corte = `late checkout autorizado ?? checkout oficial` (R6). Late checkout só vale com autorização FORMAL no cartão de checkout (`late_checkout_time` + `late_checkout_approved_at` + `late_checkout_by`, os três preenchidos, gravados pelo trigger `guard_stay_authorizations`); `arrival_time_source='staff'` NUNCA é prova de autorização. O banco só aceita late posterior ao checkout oficial.
6. REGRA: agora ≥ check-in oficial − 24 h → allow (exatamente 24 h = allow; 1 s antes = deny).
7. EXCEÇÃO: cartão liberado manualmente pela equipe → allow. Registro confiável (D13): `guest_arrival_status.credentials_released_at` E `credentials_released_by` preenchidos no cartão de CHECK-IN da estadia (sem autor = não liberado). Quem grava autor e momento é o trigger `guard_stay_authorizations` (autor = `auth.uid()`, momento = `now()`), só para dono/admin/membro com `operation_edit` (`can_manage_stay_authorizations`); INSERT nunca concede; revogar limpa os dois. Caminho interno: `internal_set_checkin_credentials_release` / `internal_set_late_checkout` (só service_role). Histórico em `audit_logs` (`guest_arrival_status.credentials.*` / `.late_checkout.*`). Ainda não há botão no painel.
8. Senão → deny.

Ordem de execução no builder: validar escopo → estado → D9 → se negado, NENHUMA consulta de credenciais → se permitido, REAVALIAR com estado atualizado → emitir `CredentialGrant` (30 s, mesma reserva/imóvel/conversa) → `fetchSensitiveCredentials(grant)` → montar contexto. Qualquer falha = `credentials: null`.

## Fuso horário
- Fonte: `propertyTimeZoneOrNull(city, country)` (`lib/property-timezone.ts`), sem padrão presumido. Sem fuso comprovado → deny (`missing_timezone`).
- Só identificadores IANA; offsets fixos são recusados. Comparações entre instantes absolutos (`policy/wall-clock.ts`).
- Horário de verão: horário local ambíguo ou inexistente resolve sempre para o lado conservador ("later" no início da janela, "earlier" no corte de checkout).
- Horários oficiais: `properties.checkin_time` / `checkout_time` (mesma fonte dos cartões e de `access-pin-window`). Divergência com o anúncio vira `conflicts`, sem troca silenciosa.

## Conversas sem reserva
- Legítimas (162 de 205 no histórico). `stay = null`, fase `inquiry`, audiência só P, sem credenciais.
- Proibido vincular por data, nome ou coincidência parcial: só vale o `reservation_id` gravado na conversa pelo código da reserva.

## Chamados humanos
- Não existe tabela de chamados. A conversa em `needs_human`/`assigned` aparece como `openCases[0]` com `topic: null`.
- `evaluateCaseGate` devolve sempre `aiMayAnswer: true`; a equipe é dona só do assunto `related`. Nunca implementar bloqueio global por chamado aberto.

## Logs e telemetria
- Nenhuma credencial em log, trace, métrica, mensagem de erro ou `uncertainties`. Os erros deste módulo são códigos fixos.
- `AccessPolicyResult` só carrega decisão, motivo e instantes de diagnóstico; nunca valores.

## F2-A — LLM Gateway (`llm/`, commit local `b48205b`)
- `llm/gateway.server.ts` → `generateGuestLlm(request)` é o ÚNICO caminho do Guest AI até um modelo. Nunca lança: falha = `{ ok: false, error: { code } }` e o chamador segue o fallback humano.
- Transporte: Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1`, cabeçalho `Lovable-API-Key` com `LOVABLE_API_KEY`), só em `llm/providers/lovable-gateway.server.ts`. Google → `/chat/completions` (`reasoning_effort`); OpenAI → `/responses` em streaming (`reasoning.effort`), resultado do evento terminal.
- Só modelos de `llm/models.ts` (registro próprio, com preço por 1M tokens). Nunca importar `src/lib/llm/` (gateway convencional do SaaS) nem ser importado por ele.
- Prazo total máximo de 15 s (AbortSignal + corrida contra provedor que ignore o sinal). Nova tentativa só para 5xx/rede, uma vez, e só com ≥ 3 s de prazo restante. 429/402/4xx/timeout nunca repetem.
- Truncada (`length`/fluxo sem evento terminal), filtrada, vazia, término desconhecido ou JSON inválido = falha. Nada parcial sai do gateway.
- `forbiddenValues`: se algum aparecer em qualquer mensagem, recusa antes da rede (`sensitive_content_blocked`). O gateway não conhece credenciais nem importa `data/`, `context/`, `policy/`.
- Log: um evento `guest_ai.llm.call` por chamada, por lista branca (números, códigos, ids opacos). Nunca conteúdo, chave, corpo de erro do provedor nem valores proibidos. O corpo de respostas de erro HTTP não é lido.
- Único consumidor: o Orchestrator (F2-B). O `slot.server.ts` continua devolvendo `null` (fallback humano), não importa `llm/` e é verificado byte a byte contra a main. Sem tool calling, sem envio a canais.
- `contextWindowTokens` no registro é um piso CONSERVADOR provisório (128 mil) até a sonda D14 confirmar os limites reais.
- Sonda D14 (`llm/probe.server.ts`, rota `/api/public/guest-ai/llm-probe`): DESLIGADA por padrão. Só roda com `GUEST_AI_LLM_PROBE=on` E segredo de cron; com a chave desligada responde 404 sem chamar nada. Prompts sintéticos; devolve só telemetria (nunca o texto). Executar só com autorização expressa.

## F2-B · B1 — Conversational Orchestrator (`orchestrator/`, `validation/`, `shadow/contracts.ts`)
- `runGuestTurn(TurnRequest)` coordena: contexto autorizado → compositor de prompt (B2) → Gateway → decisão JSON (parse estrito, `decision.ts`) → validação → resultado. Nunca lança; prazo total ≤ 15 s (corrida contra etapas lentas; o Gateway recebe o prazo restante). `mode` é literal `"shadow"`.
- Fallbacks tipados (`FALLBACK_KINDS`); os 17 códigos do Gateway mapeados em `LLM_FALLBACK` (exaustivo, verificado pelo compilador).
- Contexto: `context/conversation-context.server.ts` usa `buildGuestContext` com `credentials: "skip"` (a D9 é avaliada, credenciais NUNCA são buscadas). O Orchestrator recusa contexto com credenciais (`credentials_present`). Histórico, orientações e precedentes: `unavailable` (`not_loaded` / `no_governed_store`). Proibido ler as 29 tabelas legadas.
- Credenciais: o modelo nunca as vê. Ele só declara `credentialIntent` e usa o marcador `[[CREDENCIAIS]]`, que na F2-B nunca é substituído. O Validator bloqueia intenção contra a D9 e código de acesso fabricado (padrão estrutural, não filtro de estilo).
- Validator (`validation/output-validator.ts`): só segurança e integridade (estrutura, credenciais, fundamento, posse humana). Sem censura de estilo, desculpas, emojis, humor ou idioma (a IA segue o idioma do hóspede em todos os canais).
- Posse humana por assunto (`case-ownership.ts` + `evaluateCaseGate` F1): `related` impede compromissos sobre o assunto; `ambiguous` exige esclarecer; nunca bloqueio global.
- Capacidades F2-C (`capabilities.ts`): só contratos, todas `enabled: false`; o modelo apenas declara `capabilityNeeds`.
- Sem compositor de prompt instalado (B2), todo turno cai em `prompt_unavailable`.
- Shadow (`shadow/contracts.ts`): só tipos. Registro com metadados técnicos apenas — nenhum campo de texto (sem rascunho, resposta, prompt, mensagem). Gatilho operacional (coletor + worker por cron) é da B3; nunca o job legado de 15 s.
- Log `guest_ai.turn` por lista branca (sem texto).
- Cancelamento: o sinal do turno vai de `runGuestTurn` → `loadConversationContext` → `buildGuestContext` (`deps.signal`) → `abortableDb` (`data/client.server.ts`), que anexa `.abortSignal(signal)` a TODA consulta PostgREST (o `fetch` é abortado no cliente) e recusa abrir consulta nova depois do cancelamento (`GuestAiAbortedError`). O builder confere o sinal entre as etapas. Limite: a consulta já enviada pode terminar no Postgres; é só leitura e o resultado é descartado.
- Vários chamados abertos: o contexto expõe todos (`humanOwnership.cases`). Com a decisão atual (uma relação por turno): `related` + 2+ chamados ⇒ regra da equipe vale (sem compromissos), mas `attribution: "unattributed"` e `caseId: null` (não há palpite do 1º chamado). Associação por chamado exige o contrato mínimo da B2:
  `caseAssessments: Array<{ caseId: string; relation: "related" | "independent" | "ambiguous" }>` (um item por chamado do contexto; id desconhecido, repetido ou faltante ⇒ decisão inválida) e `commitments: Array<{ text: string; caseId: string | null }>` (bloqueia compromisso ligado a chamado `related`; com algum `ambiguous`, estratégia `clarify`). Nunca bloqueio global.
- Sonda D14: trava de uma execução por processo (429 `probe_busy`), falha isolada por modelo (`internal_error` só no caso que quebrou), limites explícitos (`PROBE_MAX_OUTPUT_TOKENS` 256, `PROBE_TIMEOUT_MS` 15 s, `PROBE_MAX_CONCURRENCY` 4, ≤ 12 chamadas), corpo da requisição nunca lido, sem log próprio.

## F2-B · B2.1 — Persona, System Prompt, Composer, Render, Budget, History
- COMPORTAMENTO NÃO É ROTEIRO: persona (`persona.ts`) e System Prompt (`system-prompt.ts`) descrevem princípios e limites, sem frase obrigatória, catálogo de respostas ou lista de palavras proibidas. Exemplos de diretrizes só existem como cenários de TESTE (`__tests__/helpers/b21-scenarios.ts`: entrada + resultado ESTRUTURADO, nunca texto de resposta), e nenhum código de produção os importa.
- System Prompt sem nenhum dado variável (mesmo canal ⇒ mesmo texto). Hierarquia: segurança → persona → regras operacionais → silêncio/intenções → interlocutor × titular → marcos da estadia → contexto validado → histórico → conteúdo não confiável.
- Composer (`composer.ts`): sempre 2 mensagens (system + UMA user). Dados em blocos `<dados_validados>` e `<historico>` em JSON com `< > & U+2028 U+2029` escapados (dado nunca vira instrução). Nunca lança, nunca corta: `prompt` | `over_budget` | `unavailable`.
- Texto livre exige `FreeTextGuard` (secret-scrub, B2.2). Sem guard ⇒ `unavailable/free_text_guard_missing`: até a B2.2 nenhuma composição real é possível (21 mensagens do histórico de produção casam com padrão de código de acesso). Fatos do anúncio/Dossiê ficam declarados como indisponíveis.
- Histórico (`history.ts` + `data/history.server.ts`): integral até a mensagem atual, cronológico em µs, sem notas internas, projeção mínima própria; acima de 500 linhas ⇒ `over_limit` (nunca lista cortada). Falantes: guest, team, system, `legacy_ai` (toda IA existente no banco é a antiga), `unknown`. Id citável `hist:<falante>:hN`.
- Orçamento (`budget.ts`): mede o prompt real; tokens ≈ ceil(chars/3) contra janela − saída − margem 8 mil; tetos do Gateway (60 mensagens, 200 mil caracteres) espelhados e conferidos por teste. `capacityValidated`/`latencyValidated` são `false` literais.
- Decisão v2 (`orchestrator/decision.ts`): v1 (B1) intacta; v2 = v1 + `shouldReply`, `intents`, `formalChangeRequests`, `hospitalityMilestone`, `speakerName` (todos ou nenhum). Ausentes ⇒ responder, sem ritual, sem alteração. Estratégia `silence` só coerente com `shouldReply: false`.
- Validator, regras estruturais B2.1: silêncio só com intenções de afirmação/confirmação e sem encaminhamento, compromisso, credencial, alteração ou marco; alteração formal nunca com compromisso; marco coerente com a intenção e provado pela mensagem ATUAL do hóspede (`hist:guest:hN` de maior posição). Nada lexical bloqueia; a validação estrutural não garante pegar promessa escrita só em texto livre.
- Render (`render.ts`): `fallback` | `silence` (resultado legítimo, sem texto nem cortesia) | `draft`. Tudo `delivery: "not_sent"`, `effectsExecuted: false`; compromissos e alterações `not_granted`; nome declarado `verified: false`; titular `not_in_context`; marco sem efeito operacional.
- D13 NÃO é autorização de entrada antecipada (é liberação manual de credenciais, sem botão no painel e sem uso em produção); o contexto declara entrada antecipada e saída tardia como `nao_informado`.
- Nada é instalado: `NO_COMPOSER` segue o padrão do Orchestrator; o composer não é importado por nenhum código de produção.

## Restrições vigentes (F0/F1 + F2-A + F2-B/B1)
- Proibido: resposta automática ou envio real, ativar o slot, persistir texto de resposta, ler colunas de senha para mascarar texto (sanitização só por padrões estruturais), executar/registrar ferramentas, entregar credenciais ao LLM, embeddings, RAG vetorial, envio de mensagens, ativação de canal, agentes Operations/Owner, deploy. Chamadas a LLM só via `llm/gateway.server.ts`.
- Banco: não reutilizar nem tocar nas 29 tabelas da IA antiga; só as migrations `20261102200000` (D13, colunas) e `20261102230000` (guardas D13/R6) foram aplicadas em produção; nenhuma outra sem autorização; nenhum DROP/TRUNCATE/DELETE. Estruturas novas (`ai_guest_cases`, `ai_turn_traces`, registro de liberação manual) só como proposta, com autorização.
- Não reativar o cron iCal 682.
- Título público do imóvel (`data/public-title.ts`): o prefixo de código interno (`AP014 - `) é removido só na representação para o hóspede (listing, dossiê, builder); `properties.name` nunca é alterado. Sem separação comprovada, o nome sai inteiro.
- O módulo é somente leitura: nenhum `.insert/.update/.upsert/.delete/.rpc` e nenhuma chamada às funções internas de autorização (teste estático em `data-boundary.test.ts`). A IA nunca altera autorizações.
