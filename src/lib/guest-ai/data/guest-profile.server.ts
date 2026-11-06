/**
 * MEMÓRIA DO HÓSPEDE — LEITURA do perfil canônico do hóspede (somente leitura, projeções próprias).
 *
 * Regra das duas portas (diretriz do titular, 06/11/2026), sempre DENTRO da conta do turno (`tenantId`):
 *  - Porta 1 (plataforma): a conta do hóspede na OTA (`guest_contacts.ota_guest_id`, ex. `airbnb:<id>`) da
 *    reserva VINCULADA à conversa. Tem prioridade: identifica mesmo com outro telefone.
 *  - Porta 2 (fora da plataforma): telefones em E.164 — os da reserva vinculada e, no WhatsApp, o da sessão.
 *    Um número novo no WhatsApp só leva ao perfil quando a conversa está vinculada à reserva, e o vínculo
 *    só nasce pelo código oficial da reserva (`linkConversationByCode`). Nunca por nome ou coincidência.
 *  - Telefone marcado como conflito (número reciclado) não identifica ninguém; telefones que apontam para
 *    perfis diferentes ⇒ `conflict` (nunca se escolhe um).
 * Devolve só contagem de estadias, última saída e notas de hospitalidade: nada de nome, telefone, conta,
 * documento, e-mail ou dado financeiro. Falha de leitura (inclusive tabela ainda não criada) ⇒
 * `unavailable`, sem derrubar o turno. Só o cancelamento interrompe (`GuestAiAbortedError`).
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import {
  GuestAiAbortedError,
  abortableDb,
  getGuestAiDb,
  throwIfAborted,
  type GuestAiDb,
} from "./client.server";
import {
  GUEST_IDENTITY_COLUMNS,
  GUEST_PROFILE_ANCHOR_COLUMNS,
  GUEST_PROFILE_COLUMNS,
  cols,
} from "./projections";

export const GUEST_NOTE_CATEGORIES = [
  "preferencia",
  "rotina",
  "cuidado",
  "pedido_recorrente",
  "outro",
] as const;
export type GuestNoteCategory = (typeof GUEST_NOTE_CATEGORIES)[number];
export interface GuestProfileNote {
  categoria: GuestNoteCategory;
  texto: string;
}
export const GUEST_NOTE_MAX = 20;
export const GUEST_NOTE_MAX_CHARS = 280;

export type GuestProfileLoad =
  | {
      status: "found";
      via: "ota" | "phone";
      stayCount: number;
      lastStayCheckout: string | null;
      notes: GuestProfileNote[];
    }
  | { status: "not_found"; reason: "no_anchor" | "no_profile" }
  | { status: "conflict" }
  | { status: "unavailable" };

/** E.164 sem palpite de DDI: 8 a 15 dígitos depois de tirar `00` inicial (mesma regra do banco). */
export function normalizeGuestPhone(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const d = String(raw).replace(/\D/g, "").replace(/^00/, "");
  return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
}

const OTA_ID = /^[a-z][a-z0-9_]{1,31}:[a-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeNotes(raw: unknown): GuestProfileNote[] {
  if (!Array.isArray(raw)) return [];
  const out: GuestProfileNote[] = [];
  for (const n of raw) {
    if (out.length >= GUEST_NOTE_MAX) break;
    const o = n && typeof n === "object" ? (n as Record<string, unknown>) : null;
    const texto =
      typeof o?.["texto"] === "string"
        ? o["texto"].replace(/\s+/g, " ").trim().slice(0, GUEST_NOTE_MAX_CHARS)
        : "";
    if (!texto) continue;
    const cat = o?.["categoria"];
    const categoria = (GUEST_NOTE_CATEGORIES as readonly unknown[]).includes(cat)
      ? (cat as GuestNoteCategory)
      : "outro";
    out.push({ categoria, texto });
  }
  return out;
}

export async function fetchGuestProfile(
  turn: ValidatedTurn,
  deps: { db?: GuestAiDb; signal?: AbortSignal } = {},
): Promise<GuestProfileLoad> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
  const unavailable = (): GuestProfileLoad => {
    throwIfAborted(deps.signal);
    return { status: "unavailable" };
  };
  try {
    // 1) âncoras: reserva vinculada à conversa (mesmo imóvel do turno) + telefone da sessão do WhatsApp
    let ota: string | null = null;
    const phones = new Set<string>();
    if (turn.reservationId) {
      const res = await db
        .from("property_reservations")
        .select(cols(GUEST_PROFILE_ANCHOR_COLUMNS))
        .eq("id", turn.reservationId)
        .eq("property_id", turn.propertyId)
        .maybeSingle();
      if (res.error) return unavailable();
      const row = res.data as { ota_guest_id?: unknown; phones?: unknown } | null;
      if (row) {
        const o = typeof row.ota_guest_id === "string" ? row.ota_guest_id.trim().toLowerCase() : "";
        if (OTA_ID.test(o)) ota = o;
        if (Array.isArray(row.phones))
          for (const p of row.phones) {
            const n = normalizeGuestPhone(p);
            if (n) phones.add(n);
          }
      }
    }
    if (turn.surface === "whatsapp" && turn.guestSessionId.startsWith("wa:")) {
      const n = normalizeGuestPhone(turn.guestSessionId.slice(3));
      if (n) phones.add(n);
    }
    if (!ota && phones.size === 0) return { status: "not_found", reason: "no_anchor" };

    // 2) identidades da CONTA do turno
    const values = [...(ota ? [ota] : []), ...phones];
    const ids = await db
      .from("guest_ai_guest_identities")
      .select(cols(GUEST_IDENTITY_COLUMNS))
      .eq("tenant_id", turn.tenantId)
      .in("value", values);
    if (ids.error || !Array.isArray(ids.data)) return unavailable();
    const rows = ids.data as Array<{
      canonical_id: string;
      kind: string;
      value: string;
      status: string;
    }>;

    let canonical: string | null = null;
    let via: "ota" | "phone" = "phone";
    const otaHit = ota
      ? rows.find((r) => r.kind === "ota" && r.value === ota && r.status === "active")
      : undefined;
    if (otaHit) {
      canonical = otaHit.canonical_id;
      via = "ota";
    } else {
      const phoneRows = rows.filter((r) => r.kind === "phone" && phones.has(r.value));
      if (phoneRows.some((r) => r.status !== "active")) return { status: "conflict" };
      const distinct = [...new Set(phoneRows.map((r) => r.canonical_id))];
      if (distinct.length > 1) return { status: "conflict" };
      if (distinct.length === 0) return { status: "not_found", reason: "no_profile" };
      canonical = distinct[0]!;
    }

    // 3) perfil (mesma conta), só contagens e notas
    const prof = await db
      .from("guest_ai_guest_profiles")
      .select(cols(GUEST_PROFILE_COLUMNS))
      .eq("canonical_id", canonical)
      .eq("tenant_id", turn.tenantId)
      .maybeSingle();
    if (prof.error) return unavailable();
    const p = prof.data as {
      canonical_id?: string;
      tenant_id?: string;
      stay_count?: unknown;
      last_stay_checkout?: unknown;
      behavioral_notes?: unknown;
    } | null;
    if (!p || p.canonical_id !== canonical || p.tenant_id !== turn.tenantId)
      return { status: "not_found", reason: "no_profile" };
    const stayCount =
      typeof p.stay_count === "number" && Number.isInteger(p.stay_count) && p.stay_count >= 0
        ? p.stay_count
        : 0;
    const last =
      typeof p.last_stay_checkout === "string" && DATE.test(p.last_stay_checkout.slice(0, 10))
        ? p.last_stay_checkout.slice(0, 10)
        : null;
    return {
      status: "found",
      via,
      stayCount,
      lastStayCheckout: last,
      notes: sanitizeNotes(p.behavioral_notes),
    };
  } catch (e) {
    if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
    return { status: "unavailable" };
  }
}
