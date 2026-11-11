/**
 * SAÍDA DA IA · leitura (servidor). Monta o contexto para resolver tags no texto que vai ao canal:
 *  - credenciais: SÓ quando o texto pede algo sensível. O Context Engine reavalia a D9 com estado FRESCO, emite o
 *    `CredentialGrant` (30 s, mesma reserva/imóvel/conversa) e só então lê as colunas de segredo. Negou, falhou ou
 *    expirou ⇒ `null` (nada é presumido);
 *  - campos públicos do imóvel e slug do guia: projeção fechada `PROPERTY_OUTBOUND_TAG_COLUMNS` (sem segredo).
 * Nada daqui vai para log.
 */
import { buildGuestContext } from "@/lib/guest-ai/context/builder.server";
import { getGuestAiDb } from "@/lib/guest-ai/data/client.server";
import { PROPERTY_OUTBOUND_TAG_COLUMNS, cols } from "@/lib/guest-ai/data/projections";
import type { OutboundContext, PublicPropertySnapshot } from "@/lib/guest-ai/outbound-text";
import type { GuestCredentials, GuestSurface } from "@/lib/guest-ai/types";

export interface CredentialRequest {
  surface: GuestSurface;
  conversationId: string;
  messageId: string;
  expectedOwnerId?: string | null;
}

export async function loadAuthorizedCredentials(req: CredentialRequest): Promise<GuestCredentials | null> {
  try {
    const guest = await buildGuestContext(
      {
        surface: req.surface,
        conversationId: req.conversationId,
        messageId: req.messageId,
        expectedOwnerId: req.expectedOwnerId ?? null,
      },
      { credentials: "fetch" },
    );
    if (!guest.access.credentialsAllowed || !guest.credentials) return null;
    return guest.credentials;
  } catch {
    return null;
  }
}

async function loadPublicSnapshot(
  propertyId: string,
): Promise<{ property: PublicPropertySnapshot | null; slug: string | null }> {
  try {
    const db = await getGuestAiDb();
    const { data, error } = await db
      .from("properties")
      .select(cols(PROPERTY_OUTBOUND_TAG_COLUMNS))
      .eq("id", propertyId)
      .maybeSingle();
    if (error || !data) return { property: null, slug: null };
    const row = data as Record<string, unknown>;
    const slug = typeof row["slug"] === "string" && row["slug"] ? (row["slug"] as string) : null;
    return { property: row as PublicPropertySnapshot, slug };
  } catch {
    return { property: null, slug: null };
  }
}

/** Contexto de saída; `needsCredentials` evita reavaliar a D9 quando o texto não pede nada sensível. */
export async function loadOutboundContext(
  req: CredentialRequest,
  propertyId: string,
  needsCredentials: boolean,
): Promise<OutboundContext> {
  const [credentials, pub] = await Promise.all([
    needsCredentials ? loadAuthorizedCredentials(req) : Promise.resolve(null),
    loadPublicSnapshot(propertyId),
  ]);
  return {
    surface: req.surface,
    credentials,
    property: pub.property,
    guideSlug: pub.slug,
    origin: process.env["GUIDE_PUBLIC_ORIGIN"] || undefined,
  };
}
