# Governança de check-in da IA: presença física, horário limite, terceiros e contingência

## Objetivo
Corrigir as duas falhas do caso Fernanda Clara (Casa Charmosa) e remover regras literais que engessam a IA, sem mexer no banco.

## Comportamento final

### A. Senha pedida sem presença física confirmada
- "Como acho a senha?" / "não consigo abrir o guia" = dúvida preparatória, não pessoa na porta.
- A IA ajuda com o guia (reenvia o caminho/link se o anfitrião já enviou) e pergunta, numa frase natural, se já está no imóvel ou a que horas chega.
- Credenciais completas só quando: o hóspede confirma que está no local/a caminho imediato, OU o horário informado está dentro da janela oficial e é hoje.
- Proibido fechar com "nos avise quando estiver dentro" para quem ainda não chegou.

### B. Chegada fora da janela (após `checkin_time_max`, ou madrugada) ou terceiros sem alinhamento
1. IA detecta: horário informado depois do limite de check-in do imóvel (Casa Charmosa: 23h) sem autorização da equipe no histórico, OU titular fala de "os hóspedes" chegando sem ele e sem alinhamento prévio.
2. Abre consulta interna com botões (card `ai_human_escalations`, `decision`), por exemplo:
   - Autorizar exceção às {hora} (entrada em silêncio)
   - Manter horário oficial
   - Pedir identificação dos hóspedes
3. Silêncio com o hóspede enquanto o card está pendente (regra atual de cards operacionais).
4. Após o clique: UMA resposta = advertência gentil (fora do padrão da casa, silêncio da vizinhança, identificação) + decisão da equipe.

### C. Contingência: equipe não respondeu e o hóspede cobra / está a caminho / chegou
- Gatilho: card pendente sem resposta + nova mensagem do hóspede cobrando ou dizendo que está chegando/no local.
- Se check-in 100% autônomo (cofre/fechadura/senha cadastrados com instruções) E reserva verificada E credenciais disponíveis no contexto: a IA decide sozinha, educa sobre o horário fora do padrão e o silêncio, e conduz a entrada com segurança. Registra no card que foi contingência.
- Caso contrário: ponte de espera — diz que está verificando a possibilidade de check-in nesse horário, que retorna por aqui assim que tiver resposta, e pede que aguarde. Uma vez por card; não repete a cada mensagem.
- Exceção explícita à regra atual "nunca prometer retorno": vale só aqui.

## Engessadores a ajustar (revisão)
1. `house-rules.ts` — "RESPONDA COMO SE O GUIA NÃO EXISTISSE": abrir exceção quando o hóspede relata problema com o guia.
2. `orchestrator.server.ts` — bloco "ESTADIA EM ANDAMENTO": "informe DIRETAMENTE e por completo" passa a depender da regra A.
3. `access-guidance.server.ts` — "PROIBIDO mencionar o horário de início": manter a proibição do início, mas permitir citar o limite final e as regras de silêncio quando a chegada passa do limite.
4. `prompt-rules.ts` — `THIRD_PARTY_BOOKING_RULES`: separar reserva centralizada (empresa/família, sem cadastro) de terceiros entrando sem o titular sem alinhamento (pergunta gentil + consulta à equipe).
5. `prompts.ts` — "Nunca pergunte 'você está no imóvel sem conseguir entrar?'": restringir ao cenário de antes do horário; na dúvida preparatória a pergunta de presença é permitida.

## Detalhes técnicos
- `stay-events.server.ts` / `access-guidance.server.ts`: `assessStayTimes` e `accessTiming` passam a ler `checkin_time_max`; nova função pura `isLateArrival(horaInformada, checkinMax, staffTime)` (trata virada da meia-noite: 00h–06h conta como após o limite).
- Nova função pura `decideContingency({ autonomous, verified, hasCredentials })` → `"conduct" | "hold"` em `access-guidance.server.ts`; `autonomous` derivado de `gate_code`/`lock_code`/instruções preenchidos.
- `orchestrator.server.ts`: quando `isLateArrival` ou terceiros sem alinhamento e sem autorização, injeta a orientação "consulte a equipe via request_human_handoff com decisão em botões e não responda ao hóspede"; com card pendente + cobrança, injeta orientação de contingência conforme `decideContingency`.
- O silêncio por card pendente (`cardSilencesAi`) ganha exceção: mensagem do hóspede com cobrança/chegada (`isGuestPressing`) libera uma resposta de contingência, com dedupe em `ops_push_log` (`contingency:{escalationId}`).
- Sem migração, sem mudança de RLS; atualizar `src/lib/ai/AGENTS.md` com a regra de contingência.

## Testes (vitest, em `src/lib/ai/__tests__/`)
- `isLateArrival`: 02:00 com limite 23:00 → true; 22:00 → false; autorização da equipe 02:00 → false.
- `decideContingency`: autônomo+verificado+credenciais → conduct; faltando qualquer um → hold.
- `isGuestPressing`: "estou chegando", "já estou aqui", "e aí, posso?" → true; "ok" → false.
- Orientação de acesso: dúvida preparatória não contém instrução de "entregar por completo"; chegada tardia contém consulta à equipe.
- Rodar os testes de IA existentes para garantir zero regressão.
