# Previsão de horário gravada mesmo com atendimento humano (23/10/2026)

- src/lib/ai/stay-intent-resolver.server.ts — NOVO detectStayForecast (pura); forecastAllowed: madrugada 00:00–05:59 no check-in conta como chegada tardia (+24h).
- src/lib/ai/conversation-link.server.ts — NOVO applyStayForecastOnIngest (grava via registerStayTimeForecast; mesmas travas: nunca regride, não sobrescreve horário da equipe, respeita horário permitido).
- src/lib/channex-messages.server.ts, src/routes/api/public/guide-chat.ts, src/routes/api/public/whatsapp/sinch-webhook.ts — chamam applyStayForecastOnIngest logo após applyStayCompletionOnIngest, antes da trava de pausa da IA.
- src/lib/ai/__tests__/stay-intent-forecast-ingest.test.ts — NOVO (testes da frase da Lucélia, perguntas, limite, madrugada e gravação com banco falso).

Testes: 103 passam (novos + stay-intent-resolver + checkin-release-followup + stay-completion-detect + senhas). Não verificado: tsc/build da árvore completa (registry de dependências bloqueado aqui).
