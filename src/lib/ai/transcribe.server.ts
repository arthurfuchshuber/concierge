/**
 * Transcrição de áudio — uma implementação para todas as IAs do produto.
 *
 * Pedido explícito (07/09/2026): "para todo áudio enviado para a IA, seja pelo
 * hóspede, seja por um usuário, ela deve transcrever automaticamente e
 * responder com base em sua compreensão".
 *
 * Isso é uma REGRA DA CASA aplicada em código, não só em prompt: falar tem que
 * valer o mesmo que digitar, nos dois chats. O áudio vira texto e segue pelo
 * caminho normal da conversa — com o mesmo contexto, as mesmas ferramentas e,
 * no painel, o mesmo cartão de confirmação antes de gravar qualquer coisa.
 * Nenhuma das duas IAs tem um "modo áudio" com regras próprias.
 *
 * Antes desta unificação a transcrição existia solta em property-details, e o
 * áudio do hóspede não era transcrito em lugar nenhum — a IA recebia uma
 * mensagem vazia com um anexo e literalmente não sabia o que tinha sido dito.
 */

/** Extensão a partir do mime — o endpoint de transcrição usa o nome do arquivo. */
function extFor(mimeType: string): string {
  const base = mimeType.split(";")[0];
  return (
    (
      {
        "audio/webm": "webm",
        "audio/mp4": "mp4",
        "audio/m4a": "m4a",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/ogg": "ogg",
      } as Record<string, string>
    )[base] ?? "webm"
  );
}

export class TranscriptionError extends Error {}

/**
 * Converte áudio em texto. Recebe bytes, não base64: quem chama já tem o
 * formato mais barato à mão (o guia tem o arquivo, o painel decodifica uma
 * vez só) e evita uma cópia extra em memória para cada áudio.
 */
export async function transcribeAudio(bytes: Uint8Array, mimeType = "audio/webm"): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new TranscriptionError("IA não configurada.");

  const form = new FormData();
  form.append("model", "openai/gpt-4o-transcribe");
  form.append(
    "file",
    new Blob([bytes as unknown as BlobPart], { type: mimeType }),
    `audio.${extFor(mimeType)}`,
  );

  const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[transcribe] falhou", res.status, body.slice(0, 300));
    if (res.status === 429) throw new TranscriptionError("Muitas requisições. Tente em instantes.");
    if (res.status === 402) throw new TranscriptionError("Créditos de IA esgotados.");
    throw new TranscriptionError("Não consegui transcrever o áudio. Tente gravar novamente.");
  }
  const json = (await res.json()) as { text?: string };
  const text = (json.text ?? "").trim();
  if (!text) throw new TranscriptionError("Não entendi o áudio. Grave novamente, por favor.");
  return text;
}

/** Variante para quem só tem o base64 (o navegador manda assim). */
export async function transcribeAudioBase64(
  base64: string,
  mimeType = "audio/webm",
): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return transcribeAudio(bytes, mimeType);
}
