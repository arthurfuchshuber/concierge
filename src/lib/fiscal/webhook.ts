import { createHash, timingSafeEqual } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Comparação em tempo constante do segredo da URL contra o hash guardado. */
export function verifyWebhookSecret(presented: string, storedHashHex: string | null): boolean {
  if (!presented || !storedHashHex) return false;
  const a = Buffer.from(sha256Hex(presented), "hex");
  const b = Buffer.from(storedHashHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Chave de idempotência: mesmo corpo, mesma conexão ⇒ mesma chave. */
export function webhookDedupeKey(connectionId: string, rawBody: string): string {
  return sha256Hex(`${connectionId}:${rawBody}`);
}

/** Extrai a `ref` do corpo só como DICA para reconciliar; o estado nunca vem do webhook. */
export function extractRef(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const r = (body as Record<string, unknown>).ref ?? (body as Record<string, unknown>).referencia;
  return typeof r === "string" && /^cia-[0-9a-f-]{36}$/.test(r) ? r : null;
}

export interface WebhookPorts {
  loadConnection(connectionId: string): Promise<{ webhookSecretHash: string | null; active: boolean } | null>;
  ingest(connectionId: string, dedupeKey: string, bodyHash: string, body: unknown, ref: string | null): Promise<{ new: boolean; id?: string }>;
  /** Evento ainda `pending` com esta chave (reentrega do provedor após falha de processamento). Opcional. */
  findPending?(connectionId: string, dedupeKey: string): Promise<string | null>;
  /** Processamento IMEDIATO do evento já gravado (sem varredura periódica). Falha aqui nunca derruba a resposta ao provedor. */
  process?(eventId: string, connectionId: string): Promise<void>;
}

export type WebhookResult = { status: 200 | 202 | 400 | 401 | 413; code: string };
const MAX_BODY = 256 * 1024;

/**
 * Recebe o webhook: autentica pelo segredo da URL, limita tamanho, grava de forma idempotente e, quando há porta `process`,
 * processa o evento na hora (consulta o provedor, guarda XML/PDF). O estado fiscal nunca vem do corpo do webhook.
 */
export async function handleFocusWebhook(ports: WebhookPorts, args: { connectionId: string; secret: string; rawBody: string }): Promise<WebhookResult> {
  const conn = await ports.loadConnection(args.connectionId);
  // resposta idêntica para conexão inexistente e segredo errado (sem oráculo)
  if (!conn || !conn.active || !verifyWebhookSecret(args.secret, conn.webhookSecretHash)) return { status: 401, code: "unauthorized" };
  if (args.rawBody.length > MAX_BODY) return { status: 413, code: "too_large" };
  let body: unknown;
  try { body = JSON.parse(args.rawBody); } catch { return { status: 400, code: "invalid_json" }; }
  const key = webhookDedupeKey(args.connectionId, args.rawBody);
  const res = await ports.ingest(args.connectionId, key, sha256Hex(args.rawBody), body, extractRef(body));
  if (ports.process) {
    // Evento novo, ou reentrega de um evento que ficou pendente por falha anterior: processa agora. Erro ⇒ o evento segue `pending`.
    const eventId = res.new ? res.id ?? null : (await ports.findPending?.(args.connectionId, key)) ?? null;
    if (eventId) { try { await ports.process(eventId, args.connectionId); } catch (err) { console.error("[fiscal-webhook] processamento imediato falhou", (err as Error)?.message); } }
  }
  return { status: res.new ? 202 : 200, code: res.new ? "accepted" : "duplicate" };
}
