# Planejamento estratégico — melhorias aprovadas

Agrupei os 15 itens aprovados em **4 ondas**, priorizando o que destrava valor rápido e o que corrige bugs abertos (áudio, "com quem"), antes de partir para as features maiores (memória de IA, iCal, analytics avançado).

Regra geral: cada onda é entregue e validada antes de começar a próxima, para evitar regressões no fluxo crítico de atendimento.

---

## Onda 1 — Correções + quick wins (1 sessão)

Coisas curtas que já estão "quase prontas" ou são bug.

- **#25 Áudio não toca para quem recebe** — investigar `AudioRecorderButton` + `AttachmentBubble`. Provável causa: MIME/`content-type` no upload ou URL assinada expirando. Corrigir player e reencode se necessário.
- **#24 Coluna "Com alguém"** na aba Atendimento — mostrar nome do agente que assumiu (`assigned_to`) na lista e no header da conversa. Badge "Com Fulano" quando `status = human`.
- **#23 Gates de permissão restantes** — varrer server functions ainda sem `requireMemberPermission` (edição de propriedade, exclusão de guia, alteração de recomendações, reset de conversa). Aplicar UI `disabled` correspondente.

## Onda 2 — Analytics & feedback do hóspede (1 sessão)

- **#6 NPS/CSAT automático após conversa** — ao marcar conversa como `resolved`, disparar mensagem final no chat do hóspede com 1 pergunta (👍/👎 + estrelas 1-5 + comentário opcional). Guardar em `chat_message_feedback` (tabela já existe) com flag `kind = 'csat'`. Widget no admin/atendimento e agregado em Engajamento.

## Onda 3 — Integração de calendário (1–2 sessões)

- **#11 iCal** — sim, é possível. Airbnb, Booking e a maioria dos PMS exportam `.ics`.
  - Campo `ical_url` por propriedade.
  - Cron (`/api/public/cron.sync-ical`) 1×/h fazendo fetch + parse (`ical.js`), populando `reservations` (nova tabela) com `guest_name?`, `checkin`, `checkout`, `source`.
  - Pré-preencher check-in/check-out no `GuideAccessGate` quando telefone/nome baterem com uma reserva próxima.
  - Bloquear datas passadas continua valendo; datas fora de qualquer reserva ficam livres mas com aviso "não encontramos sua reserva".

## Onda 4 — IA memória longa + inovações restantes (2 sessões)

- **#1 Memória de longo prazo** por hóspede — tabela `guest_memory` (chave: `phone` + `owner_id`), com preferências extraídas automaticamente da conversa (Gemini structured output ao resolver a conversa). Injetar no system prompt em estadias futuras.
- **#2 Follow-up proativo da IA** — job que envia mensagem 1 dia antes do check-in ("posso ajudar com algo?"). Sem envio pós-check-out, conforme confirmado.
- **#3 Sugestões contextuais** — cards "hóspedes parecidos amaram" nas recomendações, com base em `poi_engagement_events`.
- **#4 Detecção de intenção crítica** — classifier em cima da mensagem do hóspede; se `emergency|complaint`, escalar direto para humano + push prioritário.
- **#10 Insights por propriedade** (perguntas mais frequentes, POIs bombados, gargalos).
- **#16, #17, #20, #21, #22** — auditoria completa, exportação LGPD, modo offline PWA, compartilhamento de guia por link, audit log.

---

## Detalhes técnicos (para referência)

**Áudio (#25):** provavelmente MIME `audio/webm;codecs=opus` sendo salvo sem `content-type` no bucket, ou `<audio>` sem `type`. Fix: setar `contentType` no `storage.upload` e no `<audio><source type>`; fallback transcodar para `mp3` server-side se necessário.

**"Com alguém" (#24):** join `handoff.functions.ts` já traz `assigned_to`; falta `profiles.full_name` do agente. Adicionar no `select` e no componente `ConversationList` + header.

**iCal (#11):** dependência nova `ical.js` ou `node-ical`. Cron URL: `https://sigmaconcierge.lovable.app/api/public/cron.sync-ical`. Agendar via `pg_cron` a cada 1h.

**NPS (#6):** reaproveita `chat_message_feedback`. Novo componente `CsatPrompt` no `GuideAiChat` quando `conversation.status = 'resolved'` e ainda sem feedback.

**Memória IA (#1):** `generateText` com `Output.object({ preferences: z.array(...) })` ao resolver conversa. Prompt: "extraia preferências duráveis (alergias, restrições, gostos)".

---

## Confirmações que preciso antes de começar

1. **Onda 1 primeiro** (áudio + "com alguém" + gates)? — recomendo sim, são bugs/UX.
2. **NPS (#6)**: envio automático ou só quando o humano marcar como resolvida? (padrão que sugiro: automático em ambos os casos, humano + IA).
3. **iCal (#11)**: começar só com Airbnb ou já suportar múltiplas URLs (Airbnb + Booking + PMS) por propriedade?
