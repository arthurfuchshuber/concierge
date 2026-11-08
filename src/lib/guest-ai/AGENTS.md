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
- Sinais vêm da MESMA decisão do Copiloto (contrato v5/v6: `hospitalityMilestone` + `milestoneQuote`, `guestEtas`); quem decide é `ops/policy.ts` (pura) com a barreira léxica `ops/lexical.ts`. Na dúvida, recusa.
- `GUEST_AI_OPS_MODE`: `live` (ou `on`) = ação real (G2c, decisão do titular de 06/11/2026); `shadow` = só registro; outro valor = desligado. Em `live`: `guest_ai_ops_claim` (idempotente por mensagem + ação) → escrita pela porta `apply` com as rotinas oficiais (`runAdvanceArrival` com `origin: "ai"`; previsão com `arrival_time_source = 'guest_ai'`, vale a informação mais recente, inclusive sobre previsão `staff`) → `guest_ai_ops_finish` (`applied` com foto antes/depois, ou `refused`). Auto-checkout (diretriz de 06/11/2026): só no dia da saída confirmada, no horário oficial do imóvel ou no late checkout FORMAL; previsão de horário (equipe, guia ou IA) é só informativa e nunca dá baixa.
- Conclusão de check-in só na fase `in_stay` (depois do horário oficial), salvo entrada antecipada combinada expressamente por atendente humano no chat no dia da entrada (`ops/early-checkin.ts`); sem esse alinhamento a IA pergunta e orienta o hóspede; check-out no dia da saída; SAÍDA ANTECIPADA (`early_departure`, card puxado para hoje) só com a estadia em curso e fato consumado explícito ("já saí", "deixei as chaves"); previsão só na data do card, dentro dos limites oficiais (janela que vira a meia-noite é respeitada) e a mais recente vale (inclusive sobre `staff`); MADRUGADA: chegada 00:00–05:00 no fuso do imóvel é da noite da data de entrada, nunca "amanhã". Pausa humana e atendente atribuído NÃO bloqueiam (só calam a IA no chat; nos bastidores ela segue registrando fatos do hóspede). Chamado aberto, encaminhamento, problema ou negociação também NÃO bloqueiam os registros nos cards (diretriz 07/11/2026).
- LATE CHECKOUT concedido pela equipe (`ops/late-checkout.ts`, ação `late_checkout`): só a mensagem MAIS RECENTE da equipe humana sobre saída (últimas 72 h) com UM horário depois do oficial e marca afirmativa explícita; negação, pergunta, condição/adiamento, cobrança ou dois horários ⇒ recusa. Pedido ou afirmação do hóspede nunca é autorização. Evidência auditada = a mensagem da equipe (o banco recusa outra), uma vez só por mensagem; autoria = `sender_user_id` dela.
- A resposta ao hóspede é sempre só sugestão do Copiloto; nunca anuncia registro de sistema.

## Guia Digital × IA (06/11/2026)
- Recomendações de lugares (07/11/2026, PR de tool calling): o Explorar do anfitrião NÃO entra no prompt (é navegação do hóspede, não base nem teto da IA). A IA usa o conhecimento amplo da cidade + as ferramentas de consulta em tempo real (`tools/`), sem inventar nota, horário, preço, endereço ou "aberto agora", sempre situando em relação ao imóvel (nunca só o bairro), com funil de proximidade e postura consultiva. O carregador do dossiê ainda lê `places` (não usado no prompt), sem efeito na resposta.
- Distância: só a de TRAJETO real devolvida pelas ferramentas (`distancia_m`, Distance Matrix a partir das coordenadas do cadastro do imóvel; a pé até 1 km, acima de carro). Sem dado (falha, prazo, sem rota, sem coordenadas) ⇒ a IA não fala em metros, situa com naturalidade e convida a abrir no Maps. Tempo de deslocamento nunca é devolvido nem escrito; se o hóspede insistir, a IA explica que varia com trânsito, semáforos, horário e ritmo.
- Eventos da cidade: o mesmo feed da Home (`city_daily_news`, janela `city-news-window.ts`), cidade do imóvel do turno; fora da lista ⇒ a IA admite que não sabe.
- Item do guia que abriu o chat: só eventos da PÁGINA PRINCIPAL (`property_chat_messages.guide_context`, `kind = city_event`, conferido pelo servidor na edição vigente da cidade do imóvel); lido pelo histórico só em mensagem do hóspede. O Explorar NÃO abre o chat: tocar no card abre o Google Maps (auditoria do PR #10, 07/11/2026).
- Formatação por canal (`copilot/channel-format.ts`): rede de segurança de forma na sugestão — sem letras estilizadas em canal nenhum; Airbnb sem links/Markdown; WhatsApp com negrito nativo leve.
- Rajadas: o disparo do Copiloto espera `COPILOT_BURST_QUIET_MS` (6 s, com `waitUntil`) e a geração dispensa a mensagem se o hóspede já mandou outra; mensagens seguidas do hóspede no fim do histórico formam um único turno no prompt.

## Tool calling — ferramentas de consulta (07/11/2026)
- Esteira extensível em `tools/`: `contracts.ts` (contrato `GuestTool`: spec JSON + `parse` + `execute`), `registry.ts` (registro central; plugar ferramenta nova = implementar o contrato e registrar), `executor.ts` (paralelo, prazo de 6 s por ferramenta limitado ao que resta do turno, nunca lança: falha vira `{ ok: false, erro }` com código fixo; resultado limitado a 3.000 caracteres), `google-places.ts` (`search_city_places`), `google-routes.ts` (`calculate_property_distance`) e `google-maps.server.ts` (ÚNICO ponto de rede de `tools/`: conector do Google Maps com `GOOGLE_MAPS_API_KEY`, sem cache, corpo de erro nunca lido).
- Ferramentas só CONSULTAM: sem banco, credenciais, D9, canais ou escrita (teste estático em `data-boundary.test.ts`). O contexto delas (`GuestToolContext`) só tem origem (coordenadas do cadastro), cidade/estado/país e canal, lido por `data/property-origin.server.ts` (`PROPERTY_ORIGIN_COLUMNS`) a partir do turno validado.
- O gateway (`llm/`) só TRANSPORTA ferramentas (declaração, `tool_calls`, mensagens `tool`, `toolChoice`) nos dois fios (chat/completions e Responses); não executa nem conhece nenhuma. Pedido de ferramenta sem ferramentas oferecidas ⇒ `invalid_response`.
- Quem orquestra é o gerador do Copiloto (continua o ÚNICO chamador do gateway): 1ª chamada com ferramentas (`auto`) → executor → 2ª chamada com os resultados e `toolChoice: "none"` (só a resposta final, JSON). No máximo UMA rodada de ferramentas. Ferramentas só são oferecidas se as DUAS chamadas couberem no teto de US$ 0,15 (reserva de 8.000 tokens); antes da 2ª o custo é recalculado exato e, se não couber, os resultados viram `indisponivel`. `beforeNetwork` é conferido antes de cada chamada. Sem origem do imóvel (ou falha ao lê-la) o pedido sai idêntico ao de antes, sem ferramentas.
- `slot.server.ts` continua `return null` e não conhece ferramentas.

## Visão de incidentes (Etapa 2, 07/11/2026)
- As fotos do hóspede (Guia, WhatsApp, Airbnb) vão ANEXADAS à mesma chamada multimodal do Copiloto (`attachVision`); não existe chamada separada de visão (decisão do titular: sem custo nem espera extra). Leitura das fotos com prazo de 8 s (`VISION_LOAD_TIMEOUT_MS`): estourou ou falhou ⇒ segue só com texto e o aviso `[imagem não carregada]`.
- O diagnóstico estruturado vem na própria decisão: contrato v6 = v5 + `visualDiagnosis` (`hasIncident`, `category`, `severity`, `detectedApplianceOrFixture`, `userFriendlyDiagnosis`, `suggestedAction`, `requiresStaffIntervention`; `null` sem foto). Schema, parse e redes de segurança em `vision/analyzer.ts` (puro). Diagnóstico malformado vira `null` (a resposta em texto segue); sem foto no turno é descartado.
- Incidente que exige a equipe (ou gravidade alta) sempre marca encaminhamento na sugestão, com urgência pela gravidade (nunca rebaixa a urgência já declarada).
- Frase de recibo de anexo no início da resposta ("recebi sua foto", "obrigado pela imagem"…) é removida (`stripRoboticAck`), preservando a saudação; o prompt já proíbe.
- Manutenção: o dossiê manda em regras, horários e senhas; para avarias e aparelhos a IA usa conhecimento técnico geral, sem travar em "não consta no dossiê", sem afirmar localização não declarada (registro, quadro) e sem pedir nada perigoso. Foto nunca libera credenciais (D9 intacta) e códigos vistos em fotos nunca são repetidos.
- Privacidade: o diagnóstico não é persistido nem registrado em log; a linha da sugestão só recebe encaminhamento/urgência. Vistoria por fotos da limpeza fica para etapa própria (não há onde guardar essas fotos sem migration).

## Catálogo único, raciocínio elástico e resiliência (Diretiva Global, 07/11/2026)
- Só dois modelos de texto no SaaS: Titular `openai/gpt-6-astra` (padrão global: atendimento, Copiloto, contratos, assistente do painel) e Reserva `google/gemini-3.8-flash`; embeddings só `google/gemini-embedding-2`. Nenhum outro modelo pode ser registrado (`llm/models.ts` aqui e `src/lib/llm/models.ts`). A extração de memória do hóspede roda no Reserva (`GUEST_AI_RESERVE_MODEL`), porque o teto de US$ 0,01 por tentativa não comporta o Titular.
- Reserva automática: na Guest AI, falha de rede, 5xx ou 404 do Titular ⇒ a 2ª tentativa (mesmo prazo) vai para o Reserva (`GUEST_AI_FALLBACK_MODELS`); 429/402/401 nunca trocam. Nas funções convencionais, Titular ↔ Reserva; o agente com ferramentas (`runAgent`) só troca para modelo da Responses API, então quem cai para o Gemini é o `chatText`.
- Raciocínio 100% elástico (ajuste fino do PR #11): NÃO existe tabela de esforço por assunto, nem no Copiloto nem nas funções convencionais. O Copiloto chama em `auto` (`COPILOT_REASONING_EFFORT`): o parâmetro de esforço não vai ao fio e o próprio modelo dosa o raciocínio. O guarda-corpo financeiro é externo: teto de US$ 0,15 por turno conferido no pior caso antes da rede, teto de saída `COPILOT_MAX_OUTPUT_TOKENS` (4.096, os tokens de raciocínio contam como saída) com recuo para `COPILOT_MIN_OUTPUT_TOKENS` (1.536) se o cheio não couber, e o teto diário. Não reintroduzir classificação de esforço por tópico.
- Varredura de segredos: emojis (ZWJ entre pictogramas, seletores FE0E/FE0F, tons de pele, bandeiras, keycaps) e diferenças só de normalização NFC são `safe` com o texto ORIGINAL; só caracteres invisíveis de verdade (ZWJ solto, zero-width, bidi) tornam a mensagem `sanitized` (`hidden_character`).
- Conversa sem vínculo de reserva degrada para `inquiry`: o contexto do Copiloto reutiliza o MESMO turno validado da cadeia (sem revalidar depois do vínculo), e o fluxo do Airbnb aguarda o vínculo pelo código ANTES de disparar o Copiloto. Divergência real de reserva continua recusada.
- Enriquecimentos opcionais (eventos; o Explorar saiu do prompt) recusados pela guarda ou com erro de consulta só esvaziam a própria seção; tabelas críticas do Dossiê continuam derrubando o turno.
- Verdade estrita do Dossiê (`STRICT_FACTS` no prompt): comodidade só se declarada; pedido de entrada antecipada ⇒ horário oficial com franqueza e, sem guarda-volumes declarado, dizer que não há onde deixar malas antes da liberação; sem perguntas burocráticas; sem muletas de transferência ("vou avisar a equipe", "nossa equipe já foi acionada").
