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

## Restrições de F0/F1
- Proibido: chamadas a LLM de qualquer fornecedor, gateway multimodelo, embeddings, RAG vetorial, Conversational Core, resposta automática, envio de mensagens, ativação de canal, agentes Operations/Owner.
- Banco: não reutilizar nem tocar nas 29 tabelas da IA antiga; só as migrations `20261102200000` (D13, colunas) e `20261102230000` (guardas D13/R6) foram aplicadas em produção; nenhuma outra sem autorização; nenhum DROP/TRUNCATE/DELETE. Estruturas novas (`ai_guest_cases`, `ai_turn_traces`, registro de liberação manual) só como proposta, com autorização.
- Não reativar o cron iCal 682.
- Título público do imóvel (`data/public-title.ts`): o prefixo de código interno (`AP014 - `) é removido só na representação para o hóspede (listing, dossiê, builder); `properties.name` nunca é alterado. Sem separação comprovada, o nome sai inteiro.
- O módulo é somente leitura: nenhum `.insert/.update/.upsert/.delete/.rpc` e nenhuma chamada às funções internas de autorização (teste estático em `data-boundary.test.ts`). A IA nunca CONCEDE autorizações: a única escrita de autorização é o registro de um late checkout que um atendente humano concedeu expressamente no chat (G2c), feito FORA do módulo pela porta `apply` com `internal_set_late_checkout` em nome do próprio atendente (o trigger R6 confere a permissão dele).
- Exceções de escrita, todas por RPC `service_role` atrás de lista fechada em `data/client.server.ts`: geração do Copiloto (`COPILOT_RPC_FUNCTIONS`) e a auditoria das ações operacionais (`OPS_RPC_FUNCTIONS = ["guest_ai_ops_record", "guest_ai_ops_claim", "guest_ai_ops_finish"]`, usadas só por `ops/executor.server.ts`). A escrita nos cards NUNCA acontece dentro deste módulo: só pela porta `apply`, implementada fora dele em `src/lib/guest-ai-ops-apply.server.ts`.

## Ações operacionais (Gate G2)
- Sinais vêm da MESMA decisão do Copiloto (contrato v5: `hospitalityMilestone` + `milestoneQuote`, `guestEtas`); quem decide é `ops/policy.ts` (pura) com a barreira léxica `ops/lexical.ts`. Na dúvida, recusa.
- `GUEST_AI_OPS_MODE`: `live` (ou `on`) = ação real (G2c, decisão do titular de 06/11/2026); `shadow` = só registro; outro valor = desligado. Em `live`: `guest_ai_ops_claim` (idempotente por mensagem + ação) → escrita pela porta `apply` com as rotinas oficiais (`runAdvanceArrival` com `origin: "ai"`; previsão com `arrival_time_source = 'guest_ai'`, UPDATE condicional que nunca sobrescreve `staff`) → `guest_ai_ops_finish` (`applied` com foto antes/depois, ou `refused`). Auto-checkout (diretriz de 06/11/2026): só no dia da saída confirmada, no horário oficial do imóvel ou no late checkout FORMAL; previsão de horário (equipe, guia ou IA) é só informativa e nunca dá baixa.
- Conclusão de check-in só na fase `in_stay` (depois do horário oficial); check-out no dia da saída; SAÍDA ANTECIPADA (`early_departure`, card puxado para hoje) só com a estadia em curso e fato consumado explícito ("já saí", "deixei as chaves"); previsão só na data do card, dentro dos limites oficiais (janela que vira a meia-noite é respeitada) e nunca sobre previsão `staff`; MADRUGADA: chegada 00:00–05:00 no fuso do imóvel é da noite da data de entrada, nunca "amanhã". Pausa humana e atendente atribuído NÃO bloqueiam (só calam a IA no chat; nos bastidores ela segue registrando fatos do hóspede). Chamado aberto (motivo diferente do padrão "sem IA"), problema ou negociação ⇒ nada.
- LATE CHECKOUT concedido pela equipe (`ops/late-checkout.ts`, ação `late_checkout`): só a mensagem MAIS RECENTE da equipe humana sobre saída (últimas 72 h) com UM horário depois do oficial e marca afirmativa explícita; negação, pergunta, condição/adiamento, cobrança ou dois horários ⇒ recusa. Pedido ou afirmação do hóspede nunca é autorização. Evidência auditada = a mensagem da equipe (o banco recusa outra), uma vez só por mensagem; autoria = `sender_user_id` dela.
- A resposta ao hóspede é sempre só sugestão do Copiloto; nunca anuncia registro de sistema.
