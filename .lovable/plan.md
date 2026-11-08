# Prompt único para o Claude — etapas restantes da IA (somente IA)

Cole o bloco abaixo inteiro no Claude. Ele executa uma etapa por vez, em branches separadas, e para em cada PR pedindo homologação. Nada de tela/layout entra aqui.

```text
CONTEXTO: ConciergeIA — trilha exclusiva da IA. Main atual após PR #31/#32.
Leia antes: src/lib/guest-ai/AGENTS.md e AGENTS.md da raiz.

REGRAS INEGOCIÁVEIS (valem para todas as etapas):
- src/lib/guest-ai/slot.server.ts continua retornando null (sem resposta autônoma).
  Nenhuma etapa ativa canal, toggle airbnb_ai_enabled ou envio automático.
- D9 intacta: credenciais só pela política existente; nenhum segredo em log, trace ou prompt.
- Sem DDL, sem db push e sem migrations. Se uma etapa exigir banco, PARE e
  entregue só a proposta SQL em texto para o titular aprovar.
- Distâncias só como comprimento/rota real do Google Maps; nunca estimar tempo
  (só se o hóspede insistir, com ressalva). Nunca inventar fatos; fonte = Dossiê + Maps.
- Explorar do Guia nunca entra no contexto da IA.
- Uma branch por etapa, PR com título semântico, `bunx vitest run` 100% verde,
  relatório com SHA do head. Sem merge direto na main. Pare ao fim de cada etapa
  e aguarde homologação antes de abrir a próxima.
- Não misture UI/layout nesta trilha.

ETAPA 0 — fix/guest-ai-json-prompt-and-ops-resilience (bloqueante)
1. Quando responseFormat=json, garantir a palavra "JSON" na mensagem de sistema
   e no transporte do gateway (erro OpenAI bad_request: "messages must contain json").
2. Failover para o modelo reserva só em erros de provedor recuperáveis
   (5xx, timeout, 429, e o 400 específico de formato json). Outros 4xx = fail-closed, sem retry cego.
3. Testes cobrindo o caso real: hóspede escreve "Check out feito" / "Saímos e deixamos
   a chave" → Copiloto gera sugestão + ação departure_confirmation → checkout_done →
   applyOpsAction (em modo shadow/live conforme GUEST_AI_OPS_MODE), sem falha silenciosa.
4. Erro de gateway deve aparecer em telemetria (código fixo), nunca sumir.

ETAPA 1 — fix/ops-respect-staff-time-and-late-checkout
1. Ação de checkout da IA nunca dá baixa antes do horário definido pela equipe
   (arrival_time_source='staff' maior que o oficial) nem antes de late checkout autorizado.
2. Previsão de chegada/saída dita pelo hóspede grava só previsão (origem guest_ai), nunca conclusão.
3. Faixa 00:00–04:59 no fuso do imóvel = "Nesta Madrugada"; testes de hoje/amanhã.
4. Late checkout após o limite só com autorização humana expressa no chat (G2c, porta existente).

ETAPA 2 — feature/guest-ai-vision-incident-diagnosis
1. Diagnóstico de foto do hóspede NA MESMA chamada multimodal (sem 2ª chamada, sem custo extra).
2. Schema estruturado (categoria, severidade, evidência visual, incerteza) com parser fail-closed.
3. Só fotos de hóspede (Guia, WhatsApp, Airbnb). Vistoria da equipe fica fora.
4. Proibido "recebi sua foto"; sem diagnóstico confiável → pergunta ao hóspede, não inventa.

ETAPA 3 — feature/guest-ai-tools-weather-flights
1. Registrar no registry de tools (src/lib/guest-ai/tools/) clima e voo (AviationStack,
   secret AVIATIONSTACK_API_KEY). Sem secret configurado = tool indisponível, sem erro.
2. Timeout, cache curto, disjuntor e teto de custo por turno, como Places/Routes.
3. Nunca afirmar horário de voo/clima sem retorno da tool.

ETAPA 4 — feature/guest-ai-continuous-learning (proposta + código sem DDL)
1. Aprendizado só de fatos encerrados (checkout feito, incidente resolvido, confirmação
   do hóspede), duradouros, isolados por imóvel, nunca pontuais.
2. Fluxo: candidato → revisão humana → Documento Vivo (transparente e editável).
3. Se precisar de tabela: entregar SQL como proposta e parar.

ETAPA 5 — feature/admin-ia-observability
Painel /admin/ia com dados reais server-side: KPIs (sugestões geradas, enviadas,
enviadas sem edição = assertividade, adoção = enviadas/geradas), incidentes,
erros de gateway, latência, tokens e custo, decisões D9 (sem valores),
estado dos cards. Contexto minimizado, sem segredos.

ETAPA 6 — checklist de ativação (somente relatório, não ativar)
Listar o que precisa estar verde para o titular decidir ligar o slot:
calibração 3–5 dias úteis ou 50–100 mensagens, taxa de erro, falhas zeradas,
pausa humana e posse por assunto testadas. A ativação é decisão exclusiva do titular.

ENTREGA DE CADA ETAPA: link do PR, SHA do head, testes rodados, arquivos tocados,
o que ficou fora e por quê.
```

## Como usar
1. Envie o bloco de uma vez só.
2. A cada PR, traga o relatório aqui para auditoria antes do merge.
3. Publish continua sendo seu.
