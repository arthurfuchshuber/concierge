## Escopo aprovado

1. **Layout mobile** — apenas o chat aberto com o hóspede (ConversationView do admin). Aplicar `env(safe-area-inset-bottom/left/right)` no composer e footer para não ser cortado por notch/arredondamento.
2. **Anexos e áudios (atendente ↔ hóspede)** — imagens (jpg/png/webp), PDF/documentos, vídeos curtos, áudio gravado estilo Instagram (hold-to-record, waveform, máx 60s).
3. **Melhorias beta**:
   - Indicador "digitando…" no widget do hóspede (Realtime).
   - Som + badge no título da aba do painel quando chega mensagem nova.
   - Respostas rápidas com **aprendizado contínuo** — sugestões geradas a partir das respostas humanas anteriores.

## Backend

**Bucket de storage** `chat-attachments` (privado, servido via signed URL).

**Schema `property_chat_messages`** — adicionar colunas:
- `attachment_url text` (path no bucket)
- `attachment_type text` (`image` | `audio` | `video` | `document`)
- `attachment_mime text`
- `attachment_duration_ms int` (para áudio/vídeo)
- `attachment_size_bytes int`

**Nova tabela `chat_quick_replies`** por `account_id`:
- `id`, `account_id`, `property_id (nullable)`, `trigger_pattern text`, `response text`, `usage_count int`, `last_used_at`, `learned_from_message_id (nullable)`, `created_at`.
- Aprendizado: quando o atendente envia manualmente uma resposta que "resolve" (a próxima mensagem do hóspede não é pergunta), um trigger extrai o par pergunta→resposta e cria/incrementa uma quick reply. Sugestões aparecem no composer quando o texto da última mensagem do hóspede tem similaridade (LIKE / trigram) com um `trigger_pattern`.

**Nova tabela `chat_typing_indicators`** (efêmera, TTL 8s) — `conversation_id`, `who` (`guest`|`staff`), `updated_at`. Alimentada por Realtime broadcast em vez de escrita constante (mais leve): usar canal Supabase `broadcast` sem persistir.

**Server functions novas em `src/lib/chat-attachments.functions.ts`**:
- `createStaffUploadUrl({ conversationId, mime, sizeBytes })` — valida permissão, retorna `{ path, signedUploadUrl }`.
- `attachStaffMessage({ conversationId, path, type, mime, sizeBytes, durationMs, caption })` — insere mensagem com anexo.

**Rota pública `src/routes/api/public/guide-chat-upload.ts`** — hóspede POSTa multipart (validado por `sessionId`+`conversationId`) e o servidor faz upload com `supabaseAdmin`, retornando o path. Polling existente do widget já entrega o attachment.

**Server function `src/lib/chat-quick-replies.functions.ts`**:
- `suggestQuickReplies({ conversationId })` → top 3 respostas com maior score.
- `recordQuickReplyUsage({ id })`.
- Job de aprendizado leve: dentro de `sendHandoffMessage`, quando `sender_type='human'` e `is_internal_note=false`, olha a última mensagem do hóspede e faz upsert em `chat_quick_replies` (dedupe por normalização + similaridade).

## Frontend

**`src/components/handoff/ConversationView.tsx`**
- Wrap externo com `pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]` no rodapé (form + estado "resolvido/locked").
- Composer redesenhado: linha superior com checkbox nota; linha do input com botões `[📎 anexo] [🎤 áudio] [textarea] [enviar]`.
- **Attachment button**: `<input type=file accept="image/*,application/pdf,video/mp4">` → preview → envia.
- **Áudio Instagram-style**: press-and-hold no botão do microfone → começa `MediaRecorder`, mostra timer + waveform (canvas + AnalyserNode), desliza para a esquerda = cancelar, solta = enviar. Corte automático em 60s.
- Renderização de mensagens: se `attachment_type='image'` → thumb; `audio` → player custom com waveform+duração; `video` → `<video controls>`; `document` → cartão com nome/tamanho + link.
- **Quick replies**: chip row acima do composer com as 3 sugestões do `suggestQuickReplies`. Clicar preenche o textarea (permite editar antes de enviar) e dispara `recordQuickReplyUsage` no envio.

**`src/components/GuideAiChat.tsx`**
- Botões `[📎] [🎤]` no composer do hóspede (só quando `humanMode` — evita distrair a IA). Áudio mesma UX (hold-to-record, 60s).
- Renderização de anexos idêntica.

**Indicador de digitação (Realtime broadcast)**
- Ambos os lados publicam `typing` a cada 2s enquanto digitam; escutam o canal e mostram "atendente está digitando…" / "hóspede está digitando…" quando `now - last < 4s`.

**Som + badge no painel `admin.atendimento`**
- Hook `useNewMessageAlert(conversationId?)` que, ao receber postgres_changes em `property_chat_messages` (mensagens que não são do usuário atual), toca um som curto (`/sounds/ping.mp3`, gerado como base64 pequeno) e atualiza `document.title` prefixando `(N) ` até a aba ganhar foco.

**Empty/erros**: toasts em português. Bloqueios: 20MB por arquivo, mime allowlist, áudio 60s.

## Arquivos

Novos:
- `supabase/migrations/<ts>_chat_attachments_and_quickreplies.sql`
- `src/lib/chat-attachments.functions.ts`
- `src/lib/chat-quick-replies.functions.ts`
- `src/components/handoff/AudioRecorderButton.tsx`
- `src/components/handoff/AttachmentPreview.tsx`
- `src/components/handoff/QuickRepliesRow.tsx`
- `src/hooks/useTypingIndicator.ts`
- `src/hooks/useNewMessageAlert.ts`
- `src/routes/api/public/guide-chat-upload.ts`
- `public/sounds/ping.mp3` (asset gerado)

Editados:
- `src/components/handoff/ConversationView.tsx`
- `src/components/GuideAiChat.tsx`
- `src/routes/api/public/guide-chat.ts` (retornar campos `attachment_*` no polling)
- `src/lib/handoff.functions.ts` (hook de aprendizado de quick replies dentro de `sendHandoffMessage`)

## Fora do escopo agora (posso fazer depois se quiser)

- Transcrição automática dos áudios (poderia usar `openai/gpt-4o-transcribe` via Lovable AI para virar texto pesquisável e alimentar a IA).
- Marcar mensagem individual como lida/não lida.
- Compressão client-side de imagens/vídeos antes do upload.

Confirma que posso executar tudo isso?
