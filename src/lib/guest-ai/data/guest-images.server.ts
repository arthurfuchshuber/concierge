/**
 * COPILOTO · VISÃO — LEITURA das fotos enviadas pelo hóspede (somente leitura, projeção própria).
 *
 * - Só depois de um `ValidatedTurn`: a consulta é filtrada pelo `conversation_id` DO TURNO, e só entram
 *   mensagens do HÓSPEDE (`role='user'` E `sender_type='guest'`), não notas internas, com
 *   `attachment_type='image'`, enviadas ATÉ a mensagem atual (inclusive). Nunca mensagem posterior.
 * - As `IMAGE_LIMITS.maxImagesPerTurn` mais recentes, da mais nova para a mais antiga.
 * - Isolamento no storage: o caminho tem de começar por `<imóvel do turno>/<conversa do turno>/` (é assim que
 *   o canal grava). Caminho de outro imóvel ou conversa é recusado sem download.
 * - Download pela porta restrita (`getGuestAiAttachmentStorage`: só `chat-attachments`, só leitura);
 *   formato pelos bytes, tetos de tamanho e de lado (`image.ts`). Teto da soma do turno.
 * - NUNCA lança por falha de banco ou storage: a imagem vira `{ status: "failed" }` e a geração segue só
 *   com texto, com o aviso `[imagem não carregada]`. Só o cancelamento do turno interrompe
 *   (`GuestAiAbortedError`). O caminho do anexo não sai deste módulo.
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import { instantKey } from "@/lib/guest-ai/history";
import { IMAGE_LIMITS, prepareImage, type PreparedImage } from "@/lib/guest-ai/image";
import {
  GuestAiAbortedError,
  abortableDb,
  getGuestAiAttachmentStorage,
  getGuestAiDb,
  throwIfAborted,
  type GuestAiAttachmentStorage,
  type GuestAiDb,
} from "./client.server";
import { GUEST_IMAGE_MESSAGE_COLUMNS, cols } from "./projections";

/** Linhas lidas além do teto de imagens (cobre mensagens posteriores à atual, descartadas). */
export const GUEST_IMAGE_SCAN_ROWS = 20;

export type GuestImageFailure =
  | "lookup_failed"
  | "path_out_of_scope"
  | "download_failed"
  | "turn_budget_exceeded"
  | Extract<PreparedImage, { ok: false }>["reason"];

export type GuestImage =
  | {
      status: "loaded";
      messageId: string;
      at: string;
      dataUrl: string;
      width: number;
      height: number;
      bytes: number;
      tokenBound: number;
    }
  | { status: "failed"; messageId: string | null; at: string | null; reason: GuestImageFailure };

interface GuestImageRow {
  id: string;
  conversation_id: string;
  role: string | null;
  sender_type: string | null;
  is_internal_note: boolean | null;
  created_at: string | null;
  attachment_type: string | null;
  attachment_path: string | null;
  attachment_size_bytes: number | null;
}

export async function fetchGuestImages(
  turn: ValidatedTurn,
  deps: { db?: GuestAiDb; storage?: GuestAiAttachmentStorage; signal?: AbortSignal } = {},
): Promise<GuestImage[]> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);

  let rows: GuestImageRow[];
  let currentKey: number | null;
  try {
    const cur = await db
      .from("property_chat_messages")
      .select(cols(["id", "conversation_id", "created_at"]))
      .eq("id", turn.messageId)
      .eq("conversation_id", turn.conversationId)
      .maybeSingle();
    if (cur.error || !cur.data) {
      throwIfAborted(deps.signal);
      return [{ status: "failed", messageId: null, at: null, reason: "lookup_failed" }];
    }
    currentKey = instantKey((cur.data as { created_at: string | null }).created_at);
    const res = await db
      .from("property_chat_messages")
      .select(cols(GUEST_IMAGE_MESSAGE_COLUMNS))
      .eq("conversation_id", turn.conversationId)
      .eq("attachment_type", "image")
      .eq("is_internal_note", false)
      .eq("role", "user")
      .eq("sender_type", "guest")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(GUEST_IMAGE_SCAN_ROWS);
    if (res.error || !Array.isArray(res.data)) {
      throwIfAborted(deps.signal);
      return [{ status: "failed", messageId: null, at: null, reason: "lookup_failed" }];
    }
    rows = res.data as GuestImageRow[];
  } catch (e) {
    if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
    return [{ status: "failed", messageId: null, at: null, reason: "lookup_failed" }];
  }
  throwIfAborted(deps.signal);
  if (currentKey === null)
    return [{ status: "failed", messageId: null, at: null, reason: "lookup_failed" }];

  // defesa em profundidade: refaz no código os filtros da consulta e descarta o que vier depois da atual
  const eligible = rows
    .filter(
      (r) =>
        r &&
        r.conversation_id === turn.conversationId &&
        r.role === "user" &&
        r.sender_type === "guest" &&
        r.is_internal_note === false &&
        r.attachment_type === "image",
    )
    .map((r) => ({ r, key: instantKey(r.created_at) }))
    .filter((x): x is { r: GuestImageRow; key: number } => x.key !== null && x.key <= currentKey!)
    .sort((a, b) =>
      a.key !== b.key ? b.key - a.key : a.r.id < b.r.id ? 1 : a.r.id > b.r.id ? -1 : 0,
    )
    .slice(0, IMAGE_LIMITS.maxImagesPerTurn);
  if (eligible.length === 0) return [];

  const storage = deps.storage ?? (await getGuestAiAttachmentStorage());
  const scopePrefix = `${turn.propertyId}/${turn.conversationId}/`;
  const out: GuestImage[] = [];
  let totalBytes = 0;
  for (const { r } of eligible) {
    throwIfAborted(deps.signal);
    const at = String(r.created_at);
    const fail = (reason: GuestImageFailure) =>
      out.push({ status: "failed", messageId: r.id, at, reason });
    const path = typeof r.attachment_path === "string" ? r.attachment_path : "";
    if (!path.startsWith(scopePrefix)) {
      fail("path_out_of_scope");
      continue;
    }
    if (
      typeof r.attachment_size_bytes === "number" &&
      r.attachment_size_bytes > IMAGE_LIMITS.maxBytes
    ) {
      fail("too_large");
      continue;
    }
    if (
      typeof r.attachment_size_bytes === "number" &&
      totalBytes + r.attachment_size_bytes > IMAGE_LIMITS.maxTotalBytes
    ) {
      fail("turn_budget_exceeded");
      continue;
    }
    let bytes: Uint8Array | null = null;
    try {
      bytes = await storage.download(path, deps.signal);
    } catch {
      bytes = null;
    }
    throwIfAborted(deps.signal);
    if (!bytes) {
      fail("download_failed");
      continue;
    }
    const prepared = prepareImage(bytes);
    if (!prepared.ok) {
      fail(prepared.reason);
      continue;
    }
    if (totalBytes + prepared.bytes > IMAGE_LIMITS.maxTotalBytes) {
      fail("turn_budget_exceeded");
      continue;
    }
    totalBytes += prepared.bytes;
    out.push({
      status: "loaded",
      messageId: r.id,
      at,
      dataUrl: prepared.dataUrl,
      width: prepared.width,
      height: prepared.height,
      bytes: prepared.bytes,
      tokenBound: prepared.tokenBound,
    });
  }
  return out;
}
