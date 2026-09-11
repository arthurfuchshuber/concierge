/**
 * A IA OUVINDO OS ÁUDIOS DA CONVERSA (pedido explícito, 11/09/2026).
 *
 * "precisamos que a IA consiga LER os áudios para também colocá-los no
 *  contexto da base de conhecimento da conversa com aquele hóspede"
 *
 * O problema era simples e grave: mensagem de áudio grava `content` vazio, e o
 * histórico enviado à IA lê `content`. Resultado — para ela, todo áudio era uma
 * mensagem em branco. Na conversa da Izabela (10/09) o atendente negociou a
 * diária extra em SEIS áudios; a IA não fazia ideia do que tinha sido dito nem
 * do que havia sido combinado.
 *
 * Aqui o áudio vira texto UMA vez, na hora em que é enviado, e fica guardado em
 * `attachment_transcript`. A partir daí ele é contexto como qualquer mensagem:
 * entra no histórico, na memória do hóspede e na tela de quem atende.
 *
 * Decisões que valem registro:
 *  · Transcrever no ENVIO, não na leitura. Transcrever toda vez que a IA monta
 *    o histórico custaria segundos e dinheiro a cada turno, e o áudio não muda.
 *  · Falhar em silêncio. Transcrição é enriquecimento: se a IA estiver fora do
 *    ar, o áudio tem que continuar sendo enviado. Fica sem transcrição e a
 *    conversa segue.
 *  · A MESMA transcrição das duas IAs (src/lib/ai/transcribe.server.ts), pelo
 *    motivo de sempre: falar tem que valer o mesmo que digitar.
 */

/** Só o pedaço do client que este arquivo usa — sem `any` solto. */
type UpdateChain = {
  update: (patch: Record<string, unknown>) => {
    eq: (col: string, val: string) => Promise<unknown>;
  };
};
type StorageBucket = {
  download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
};
type Admin = {
  from: (table: string) => UpdateChain;
  storage: { from: (bucket: string) => StorageBucket };
};

const BUCKET = "chat-attachments";

/** Teto de segurança — o upload já limita a 60s, isto é só o cinto. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Baixa o anexo, transcreve e grava em `attachment_transcript`.
 * Devolve o texto (ou null quando não deu para transcrever).
 */
export async function transcribeChatAttachment(
  admin: Admin,
  params: { messageId: string; path: string; mime: string | null },
): Promise<string | null> {
  try {
    const { data: blob, error } = await admin.storage.from(BUCKET).download(params.path);
    if (error || !blob) return null;

    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return null;

    const { transcribeAudio } = await import("@/lib/ai/transcribe.server");
    const text = (await transcribeAudio(bytes, params.mime || "audio/webm")).trim();
    if (!text) return null;

    await admin
      .from("property_chat_messages")
      .update({ attachment_transcript: text })
      .eq("id", params.messageId);

    return text;
  } catch (e) {
    // Enriquecimento nunca derruba o envio — ver cabeçalho.
    console.error("[chat-audio] transcrição falhou", (e as Error)?.message);
    return null;
  }
}

/**
 * O texto que a IA lê no lugar de uma mensagem de áudio.
 *
 * O prefixo existe para a IA saber que aquilo foi FALADO — transcrição vem sem
 * pontuação boa, com repetição e às vezes truncada, e tratá-la como se fosse
 * texto digitado foi exatamente o que produziu o "Passou de ligar a mensagem"
 * virando uma afirmação confiante e errada (auditoria de 10/09).
 */
export function transcriptAsContent(params: {
  content: string | null;
  attachmentType: string | null;
  transcript: string | null;
  durationMs?: number | null;
}): string {
  const typed = (params.content ?? "").trim();
  const spoken = (params.transcript ?? "").trim();
  const isMedia = params.attachmentType === "audio" || params.attachmentType === "video";

  if (!isMedia) return typed;
  if (!spoken) {
    // Áudio sem transcrição: melhor dizer que existe do que sumir com ele.
    const secs = params.durationMs ? Math.round(params.durationMs / 1000) : null;
    const label = secs ? `[áudio de ${secs}s, sem transcrição]` : "[áudio sem transcrição]";
    return typed ? `${typed}\n${label}` : label;
  }
  const label = `[áudio transcrito] ${spoken}`;
  return typed ? `${typed}\n${label}` : label;
}
