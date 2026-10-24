# Nova limpeza — ajustes v3 (mockups 1 a 4) + serviços na mesma trilha

Data: 23/10/2026. Fonte: canvas "Nova limpeza — ajustes v3" (Imóvel, Reserva, Prestador, Data).
Antes desta entrega só estavam feitos a janela do "+", o filtro e os cartões; as listas da trilha
continuavam no desenho antigo. Agora tudo abaixo está implementado.

## O que mudou, arquivo por arquivo

### `src/components/dashboard/TrailParts.tsx`
- **`PropertyPickRow` redesenhado** (mockups 1 e 2) — o MESMO cartão da aba Imóveis:
  foto colada à esquerda em altura cheia (96px); título em UMA linha com reticências
  (toque mostra o nome inteiro — `ClampName` em modo "linha de seleção"); botão do Maps de 28px no topo,
  alinhado ao título (é o `PropertyMapsButton` de sempre: copiar link / copiar endereço / abrir app);
  cidade logo abaixo; no rodapé "Proprietário(a): nome" + ícone verde de chat colado ao nome
  (`PhoneActionButton`); SEM bolinha de seleção — o cartão marcado ganha fundo rosa suave (`accent/10`);
  altura mínima 104px; divisória entre cartões. Toque no Maps/chat não seleciona o cartão.
  Na Reserva entram duas linhas antes da cidade: "Hóspede: nome" (ou "Cód. Reserva: código") e o período "12/10 → 22/10".
- **`ProviderPickRow` novo** (mockup 3): "Nome · Atividade" (atividade em cinza, peso médio) e ✓ rosa no marcado.
  Saiu o "padrão deste imóvel".
- **`Step`** ganhou `bleed`: a lista de cartões "sangra" 32px para a esquerda, até a borda do corpo (como no mockup).
- **`PickList`**: altura máxima 320px no celular / 380px no computador (e nunca mais que 46% da tela).
- **`TrailDialog`**: 366×600 no celular (100vw−24 × 600) e 560×680 no computador.

### `src/components/dashboard/ManualCleaningButton.tsx`
- **Imóvel / Reserva**: usam o cartão novo, com Maps, telefone do proprietário e linhas de hóspede/período.
- **Prestador**: o prestador do imóvel já vem **pré-marcado** (✓), mas a pergunta continua aberta para confirmar
  ou trocar (é o estado do mockup 3: bolinha verde + lista com o marcado).
- **Data**: `min={today}` removido — **qualquer dia** pode ser escolhido, inclusive passado e os dias de setembro
  que aparecem na grade. Atalhos Hoje / Amanhã / Depois de amanhã, mês com setas, hoje circulado, escolhido em círculo cheio
  (o calendário já era o desenho do mockup).
- **Mesma trilha para as outras situações** (`situation` na `ManualCleaningPanel` / `ManualCleaningHost`):
  Manutenção, Danos, Outro e as criadas pelo usuário (ex.: "Check-in Presencial") passam por
  1 Vincular (imóvel ou reserva) → 2 Qual → 3 Prestador → 4 Data → 5 Valor + descrição (5 perguntas; sai só "tipo de limpeza").
  Título "Novo serviço · {situação}", botão "Criar serviço".

### `src/components/dashboard/ServiceSituationUi.tsx`
- Escolher uma situação (que não seja Limpeza) abre a trilha completa acima. Quem não tem a permissão de dinheiro
  (a mesma da limpeza avulsa) continua com o registro simples de duas perguntas.
- Cartões de Imóvel/Reserva do registro simples também no desenho novo.

### `src/components/dashboard/NewRecordButton.tsx`
- "+ Registro" passa a usar o cartão novo (regra: todo lugar com o nome do anúncio leva proprietário e Maps).

### `src/lib/manual-cleaning.functions.ts`
- `getManualCleaningOptions` agora devolve endereço / link do Maps / link da garagem, telefone do proprietário,
  atividade do prestador e a linha "Hóspede / Cód. Reserva".
- **Reservas só com check-out até hoje** (nota do mockup 2) para Nova limpeza; para serviços a janela continua
  ampla (−120 a +90 dias), porque serviço pode ser de estadia em curso/futura (ex.: check-in presencial).
- **Data passada aceita** em `createManualCleaning` (nota do mockup 4). Para dia passado não há push ao prestador
  e o aviso diz só "Limpeza criada em dd/mm.".

### `src/lib/service-situations.functions.ts`
- **`createServiceRecord`** (novo): cria o serviço já realizado como pendência concluída (`tasks`, `status='done'`,
  `situation`, prestador em `resolved_by_provider_id`, dia em `completed_at`, custo em `amount_spent_cents`) —
  exatamente o que a aba Serviços lê para Serviços Extras, cartões, gráficos, Eficiência e Top 5.
  Valida: permissão de dinheiro, situação (sistema ou da conta), imóvel acessível, prestador da mesma conta, reserva do imóvel.

### `src/lib/reservation-records.functions.ts`
- `getNewRecordOptions` também devolve endereço e links do Maps (para o botão do cartão).

### Novos
- `src/lib/manual-cleaning-labels.ts` (rótulos puros) + `src/lib/__tests__/manual-cleaning-labels.test.ts` (7 testes).

## Decisões minhas (não havia mockup) — confirmar
1. Última pergunta dos serviços (valor + descrição) reaproveita o desenho da última pergunta da limpeza; valor começa em R$ 0,00.
2. Serviço novo exige a mesma permissão da limpeza avulsa (quem faz o serviço não cria a própria cobrança).
3. Reserva para serviço: janela ampla (não só check-out até hoje).
4. Categoria interna da pendência: Manutenção→`maintenance`, Danos→`inspection`, demais→`other` (a situação é a chave real).

## Auditoria linha a linha (23/10/2026) — correções finais
Comparei texto a texto cada tela do canvas com o código. Corrigido:
- **`OperationWorkspace.tsx` (aba Serviços):** título da página = só o nome da situação ("Todas as Situações" para todas);
  subtítulo "Histórico e custos de {Nome}." / "Histórico e custos de todas as situações." (sem minúsculas);
  gráficos "{Nome} · Qtde", "{Nome} · Custo", "{Nome} · Eficiência" ("Todas as situações" para todas);
  nova linha dourada sob cada título (10,5px/500, ouro a 70%, margem -6px 0 10px 16px):
  "Últimos 7 Dias - Visão por Dia" (barras e área), "… - Visão Geral" (Eficiência), "… - Visão por Imóvel" (Top 5).
  Com "Próximos 7 dias" ou período personalizado o trecho inicial acompanha a janela. Limpeza mantém os textos antigos.
- **Seletor/formulário de situações:** redesenhados conforme 0b/0c (`ServiceSituationUi.tsx`, `service-situations.ts`).
- **Conferidos sem divergência:** filtro de Situação (desktop antes do "+", primeira linha do menu Filtros no celular),
  4 cartões, janelas Despesa/Diferença/Qual (`TaskResolveDialog.tsx`; o que sobrou na comparação é dado de exemplo).
- A cor dourada usa `var(--gold, #cbb87f)` (a variável não existe no projeto; o fallback é a cor do mockup).
- **Conflito a decidir:** as notas do canvas (n9/n10) divergem dos títulos renderizados; segui o que está desenhado.
- **Pergunta aberta:** serviços perderam mídia/título/ditado do registro antigo (não há mockup). Restaurar?

## Última pergunta do serviço (mockup 0l, aprovado em 23/10/2026)
Restaura o que o registro antigo tinha (mídias, título, ditado) dentro da trilha nova do serviço.
- **`ServiceDetailsFields.tsx` (novo):** "Informe os detalhes do serviço:" — Título (obrigatório, 50 caracteres, contador 0/50,
  microfone/ditado) e Valor lado a lado no computador (Valor com 150px) e um abaixo do outro no celular; depois Descrição (ditado)
  e Fotos e vídeos (miniaturas com prévia, "+", Foto/Vídeo/Galeria/Arquivo, máx. 10). Sem o texto "Prefere falar?".
- **`ManualCleaningButton.tsx`:** o último passo do serviço usa o componente acima (a Limpeza continua igual); "Criar serviço" só
  acende com título; ao criar, as mídias vão pela fila do aparelho (`enfileirarSituacao`, já existente: guarda, envia em segundo plano,
  retoma e não duplica).
- **`service-situations.functions.ts`:** `createServiceRecord` agora recebe `title` (≤50), `description` e `groupId`; grava o título na
  pendência concluída e cria o registro principal (título + descrição) ligado a ela, onde as mídias se juntam.
- **`reservation-records.functions.ts`:** só exporta três ajudantes (`nextRecordNameFor`, `composeRecordBody`, `resolveAuthorNameFor`).
- **`TrailParts.tsx`:** removida a seta de voltar do cabeçalho (o botão "Voltar" do rodapé continua).
- Não há rascunho guardado do serviço (se fechar a janela antes de criar, perde o que digitou) — a folha antiga tinha; diga se quer.

## Correção do "pisca" ao trocar de janela (pedido do Lovable, 23/10/2026)
- **`global-overlay-store.ts`:** novo `markDialogHandoff()` — antes de trocar uma janela por outra, marca o `<html>` com
  `data-dialog-handoff` por ~450 ms.
- **`styles.css`:** durante a troca, `[data-dialog-overlay]` fica sem animação (o véu da janela que sai some na hora e o da que entra
  já nasce inteiro) — a tela de trás não aparece mais.
- **`ui/dialog.tsx`:** o véu ganhou `data-dialog-overlay` e também pula o fade-in durante a troca.
- **`ServiceSituationUi.tsx`:** lista de situações e formulário (Adicionar/Editar) viraram UMA janela só (`SituationFormDialog`
  removido; o formulário entra dentro do mesmo `<Dialog>`; "Cancelar"/clique fora volta à lista). Escolher a situação, abrir a
  trilha e ir para a folha de registro chamam `markDialogHandoff()`.
- **`NewRecordButton.tsx`:** "Continuar" → folha de registro também usa a troca sem piscar.
- Não mexi em arquivos gerados nem na integração com `global-overlay-store` além do acréscimo acima.

## Não verificado aqui
Sem `tsc`/`vite build` completos e sem navegador (registro npm do projeto bloqueado neste ambiente). Passaram 110 testes
isolados e a checagem de sintaxe. Validar no Lovable: lista de Imóvel/Reserva, Prestador pré-marcado, data passada e "Criar serviço".

## Solicitação do Lovable nº 2 — IA, previsão de horário e aprendizado (23/10/2026)
- **`ai/orchestrator.server.ts` (prompt):** o "nos avise quando estiver dentro da acomodação" só vale com check-in **HOJE**; para amanhã/futuro
  é proibido. Nova etapa de preparação e acolhimento (Guia Digital aberto? instruções de chegada claras?) e, havendo pedido de antecipação,
  o texto "Avisaremos por aqui amanhã assim que tivermos a confirmação da limpeza; senão, a entrada garantida é a partir das [horário oficial]".
- **`ai/stay-intent-resolver.server.ts`:**
  `detectStayForecast` entende espanhol (`ingresar`, `llegar`, `salimos`…) e **não descarta mais** pergunta/pedido de antecipação
  ("consigo ingresar antes? Meio dia?" → check-in 12:00). Só incerteza ("talvez", "não sei", "no sé si") e dúvida sobre o horário oficial
  ("o check-in é às 15h?") continuam sendo ignoradas. `registerStayTimeForecast` **não bloqueia mais** nenhum horário (saiu `fora_do_permitido`)
  e grava `arrival_time_source = 'guest'` ('staff' segue protegido; 'ai' antigo ainda pode ser atualizado). `forecastAllowed` continua
  exportada (não é mais usada para barrar).
- **`ai/tools.server.ts`:** a ferramenta `register_stay_time_forecast` perdeu o ramo "fora do permitido" e orienta a IA a registrar e seguir
  informando o horário oficial.
- **`dashboard/OperationWorkspace.tsx`:** seletor de horário (`PredictedEditor`) com as 24h livres (sem a folga de 3h `SLACK_MIN`).
  Novo `forecastDiffLabel` + `ForecastDiff`: etiqueta `text-red-500 font-bold text-[10px] tabular-nums` sob o horário previsto —
  check-in antes do permitido: "-3h" (previsto 12:00, permitido 15:00); check-out depois do limite: "+1h". Madrugada no check-in
  (00:00–05:59) é chegada tardia e não recebe etiqueta; só vale no dia da reserva confirmada. Aparece na coluna PREVISÃO do cartão e nos lados do histórico.
- **`channex-messages.server.ts`:** a fala do anfitrião só "responde" escalações pendentes criadas nas **últimas 4 horas**.
- **`ai/human-loop/host-answer-learning.server.ts`:** `distillHumanDecision` nulo / `shouldLearn !== true` / sem memória → aborta, **sem card**;
  removido o fallback `draft = hostText`; erro na destilação também aborta. Novo `isRoutineHostScript` (saudação, agradecimento, desculpa,
  link do guia, instruções de check-in/check-out) ignora antes mesmo de chamar a IA.
- **Testes:** `stay-intent-forecast-ingest`, `stay-intent-resolver` (ajustados: source 'guest', sem trava) e `host-answer-learning` (novos casos). 125 passando nos arquivos isolados.
- Sem migração: a constraint de `arrival_time_source` já aceita 'guest'.

## Nova limpeza/serviço/registro — cabeçalho, resumo, janela justa e listas compactas (mockups 0m, 0n, 0o — 23/10/2026)
Corrige os 4 pontos dos prints do cliente. Só layout; nenhuma regra de negócio mudou.
- **`TrailParts.tsx`**
  - `TrailDialog`: nova prop `subtitle`; o título fica em UMA linha (reticências) e o subtítulo (ex.: "Check-in Presencial") vai abaixo, em 11,5px cinza.
    A altura deixou de ser fixa (`h-[min(600px,90dvh)]`, que deixava o vão vazio sob os botões): agora `h-auto max-h-[90dvh]` — acompanha o conteúdo e
    nunca passa de 90% da tela; só o miolo rola.
  - Regra ANTICORTE: continua vindo da base `Dialog` (hook `useAntiClipWindow`); as linhas das listas (`PropertyPickRow`, `ProviderPickRow`)
    ganharam `data-clip-row`, a "unidade" que a regra usa para nunca cortar um cartão ao meio na borda de baixo.
  - `PropertyPickRow`: cartão COMPACTO — miniatura 52px arredondada, nome em 1 linha, uma informação por linha em 11,5px, Proprietário(a) + chat.
    Nova prop `hideMaps` (reserva não mostra o Maps) e `lines[].suffix` (reserva: "Hóspede - 22/10 → 25/10", mesma fonte e cor do nome, sem ícone de calendário).
    A reserva não mostra mais a cidade. Imóvel segue com Maps + cidade + proprietário.
  - Novos: `PropertySummary` (resposta estruturada do passo "Qual imóvel/reserva?": nome, hóspede - período, Proprietário(a)+chat; Maps só no imóvel),
    `guestShort` (tira o prefixo "Hóspede: ") e `OwnerLine`.
  - `Step`: nova prop `answerNode`; a resposta recolhida virou `div role="button"` (não pode haver botão dentro de botão: chat e Maps do resumo).
- **`ManualCleaningButton.tsx`:** título "Novo serviço" + subtítulo com a situação; passo 2 respondido usa `PropertySummary`; lista de reservas compacta sem Maps.
- **`NewRecordButton.tsx`:** mesmo resumo estruturado e lista de reservas compacta.
- Não verificado em navegador (sem build aqui); conferir a altura em celular baixo e a rolagem da lista com muitas reservas.

## Rodada de 23/10/2026 (18h) — 5 correções + conferência com o Lovable

1. **"role para o lado" removido** dos cartões de gráfico (`OperationWorkspace.tsx` → `CleaningChartFrame`; `ds/DailyBarChartCard.tsx`).
2. **Seta de voltar e ícone removidos dos cabeçalhos**: `FilterScreenHeader` (submenus de filtro, ex.: Situação) agora mostra só título + "Limpar"; `OverlayHeader` sem selo de ícone; "Voltar" do topo (`DialogDateRow`) sem seta; "Resumo das pendências" sem seta. Setas de mês do calendário e de carrossel de fotos permanecem (não são cabeçalho de janela).
3. **"R$ 750"**: rótulo do gráfico de área (`OperationWorkspace.tsx`, formatter) agora com espaço.
4. **"Outro" → "Outras Situações"** em `service-situations.ts` e `service-situations.functions.ts` (a categoria de pendência `TASK_CATEGORY_LABEL.other` continua "Outro": é outro conceito).
5. **Calendário de ocupação**: removidos o ícone à esquerda do título e a linha "Toque numa noite livre…".
6. Ajustes finos da trilha para bater com os mockups 0m–0o: espaço entre passos 12px, título/subtítulo com gap 10px, corpo com 14px no topo, entrelinhas 1,3/1,35 e gap 5px na linha do proprietário.
7. **Lovable**: o HEAD (8ede80f) contém exatamente as entregas anteriores; só houve reformatação de espaços em `tasks.functions.ts`, `pendencias.tsx` e `CleaningDayDetail.tsx` (adotada).
