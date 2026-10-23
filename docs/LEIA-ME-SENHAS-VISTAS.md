# Falsos "Não viu as senhas" (23/10/2026)

Arquivos:
- src/lib/arrival-passwords.ts (NOVO) — regra pura: onboarding, chat, check-in concluído.
- src/lib/arrival-board.server.ts — usa o módulo; reservas sem log cruzam por nome/telefone da reserva; check-in done => viewedPasswords true; consulta o chat (property_chat_conversations/messages, últimos 60 dias, mensagens ai/human não internas contendo lock_code/gate_code).
- src/routes/g.$slug.index.tsx — onboarding: ao avançar da etapa de senhas ou concluir, grava senhas:lock, senhas:gate e senhas:onboarding (force, mesmo com janela travada).
- src/lib/dashboard.functions.ts — barra de engajamento também reconhece senhas:onboarding.
- src/components/dashboard/OperationWorkspace.tsx — EngagementFlags: checkinDone omite "Não viu as senhas".
- src/lib/__tests__/arrival-board-passwords.test.ts (NOVO) — 12 testes (passam).

Não verificado: tsc da árvore completa e o build (o registry de dependências do projeto é inacessível neste ambiente). Vitest dos 12 testes rodou isolado.
