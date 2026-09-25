/**
 * Guarda e renova no aparelho o passe de identificação do hóspede/visitante.
 * O passe é emitido e conferido só pelo servidor.
 */
import { issueGuestPass } from "@/lib/guest-pass.functions";

const KEY = (scope: string) => `ci-pass:${scope}`;

export function readPass(scope: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY(scope));
  } catch {
    return null;
  }
}

export function savePass(scope: string, pass: string) {
  try {
    window.localStorage.setItem(KEY(scope), pass);
  } catch {
    /* sem armazenamento: o passe vale só nesta tela */
  }
}

export function clearPass(scope: string) {
  try {
    window.localStorage.removeItem(KEY(scope));
  } catch {
    /* ignora */
  }
}

/** Devolve o passe do guia, emitindo um novo se houver identificação salva. */
export async function ensureGuidePass(
  slug: string,
  identity: { name?: string | null; code?: string | null } | null,
): Promise<string | null> {
  const existing = readPass(`guide:${slug}`);
  if (existing) return existing;
  const name = identity?.name?.trim();
  if (!name || name.length < 2) return null;
  try {
    const { pass } = await issueGuestPass({
      data: { slug, guestName: name, reservationCode: identity?.code ?? null },
    });
    savePass(`guide:${slug}`, pass);
    return pass;
  } catch {
    return null;
  }
}
