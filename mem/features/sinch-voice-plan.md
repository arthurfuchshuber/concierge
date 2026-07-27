---
name: Ligações in-app (Sinch Voice + WebRTC) — plano pendente
description: Alternativa aprovada para implementar ligações direto do sistema via WebRTC, aguardando validação
type: feature
---
Aprovado para implementação futura: ligação in-app via Sinch Voice + SDK WebRTC.
- Operador liga do navegador (sem depender de sinal de celular).
- Chamada aparece pro hóspede vindo do número Voice cadastrado.
- Webhook Sinch grava evento tipo `call` em property_chat_conversations (horário, duração, status, link opcional de gravação MP3), unificado no histórico.
- Requer: produto Voice separado no dashboard Sinch (App ID + token distintos do Conversations), verificação de conta 1-3 dias úteis, número Voice BR (~US$1-3/mês) ou caller ID verificado.
- Custos estimados: ~US$10-15/mês em uma operação de 50 chamadas/mês, 3min média, celular BR, sem gravação.
- Aguardar validação do que já foi entregue antes de iniciar.
