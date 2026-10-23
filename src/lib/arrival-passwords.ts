/**
 * "Viu as senhas?" — regra única dos cards de Check-in (arrival-board.server.ts).
 *
 * Por quê (23/10/2026): o card mostrava "Não viu as senhas" para hóspedes que
 * já tinham as credenciais — só contava quem abria o Guia e tocava no olho (👁)
 * de CADA código. Ficavam de fora quem concluiu a etapa de senhas do
 * onboarding, quem recebeu o código no chat (IA/anfitrião/Airbnb/WhatsApp),
 * reservas sem log web e check-ins já concluídos.
 *
 * Este módulo é puro (sem banco) para a regra poder ser testada isoladamente.
 */

export type SeenSets = { strict: Set<string>; loose: Set<string>; phones: Set<string> };

export const eventKey = (pid: string, name: string | null, phone: string | null) =>
  `${pid}|${(name || "").trim().toLowerCase()}|${(phone || "").replace(/\D/g, "")}`;
export const looseKey = (pid: string, name: string | null) => `${pid}|${(name || "").trim().toLowerCase()}`;
export const phoneKey = (pid: string, phone: string | null) => {
  const d = (phone || "").replace(/\D/g, "");
  return d.length >= 8 ? `${pid}|${d.slice(-8)}` : null;
};

export const newSeen = (): SeenSets => ({ strict: new Set(), loose: new Set(), phones: new Set() });

export const addSeen = (set: SeenSets, pid: string, name: string | null, phone: string | null) => {
  set.strict.add(eventKey(pid, name, phone));
  if ((name || "").trim()) set.loose.add(looseKey(pid, name));
  const pk = phoneKey(pid, phone);
  if (pk) set.phones.add(pk);
};

export const hasSeen = (set: SeenSets, pid: string, name: string | null, phone: string | null) => {
  if (set.strict.has(eventKey(pid, name, phone))) return true;
  if ((name || "").trim() && set.loose.has(looseKey(pid, name))) return true;
  const pk = phoneKey(pid, phone);
  return !!pk && set.phones.has(pk);
};

export type PasswordSeen = {
  lock: SeenSets;
  gate: SeenSets;
  any: SeenSets;
  /** Credencial entregue por mensagem (chat do Guia, IA, anfitrião, Airbnb, WhatsApp). */
  chat: SeenSets;
};

export const newPasswordSeen = (): PasswordSeen => ({
  lock: newSeen(),
  gate: newSeen(),
  any: newSeen(),
  chat: newSeen(),
});

/** Registra um evento de seção do guia. Devolve true se era um evento de senha. */
export function registerPasswordEvent(
  seen: PasswordSeen,
  section: string,
  pid: string,
  name: string | null,
  phone: string | null,
): boolean {
  if (section === "senhas:lock") {
    addSeen(seen.lock, pid, name, phone);
    addSeen(seen.any, pid, name, phone);
  } else if (section === "senhas:gate") {
    addSeen(seen.gate, pid, name, phone);
    addSeen(seen.any, pid, name, phone);
  } else if (section === "senhas") {
    addSeen(seen.any, pid, name, phone);
  } else if (section === "senhas:onboarding") {
    // Concluiu a etapa de senhas do onboarding: viu o resumo de acesso inteiro.
    addSeen(seen.lock, pid, name, phone);
    addSeen(seen.gate, pid, name, phone);
    addSeen(seen.any, pid, name, phone);
  } else {
    return false;
  }
  return true;
}

/**
 * Viu as senhas de acesso do imóvel?
 * - imóvel sem senha → true (nada a ver);
 * - qualquer registro de visualização (lote, onboarding, olho, chat) basta:
 *   não penalizamos quem viu em lote.
 */
export function sawPasswords(
  accessCodes: Array<"lock" | "gate">,
  seen: PasswordSeen,
  pid: string,
  name: string | null,
  phone: string | null,
): boolean {
  if (accessCodes.length === 0) return true;
  return (
    hasSeen(seen.any, pid, name, phone) ||
    hasSeen(seen.lock, pid, name, phone) ||
    hasSeen(seen.gate, pid, name, phone) ||
    hasSeen(seen.chat, pid, name, phone)
  );
}

/**
 * Valor final de `viewedPasswords` de um card. Check-in já concluído SEMPRE
 * é "viu": quem entrou no imóvel teve e usou a senha.
 */
export function resolveViewedPasswords(args: {
  checkinDone: boolean;
  accessCodes: Array<"lock" | "gate">;
  seen: PasswordSeen;
  propertyId: string;
  name: string | null;
  phone: string | null;
  /** A reserva já recebeu a credencial no chat (cruzamento por reservation_id). */
  chatDeliveredToReservation?: boolean;
}): boolean {
  if (args.checkinDone) return true;
  if (args.chatDeliveredToReservation) return true;
  return sawPasswords(args.accessCodes, args.seen, args.propertyId, args.name, args.phone);
}

/** A mensagem contém algum dos códigos de acesso do imóvel? (códigos curtos demais são ignorados) */
export function messageHasAccessCode(content: string | null | undefined, codes: Array<string | null | undefined>): boolean {
  const text = (content || "").toLowerCase();
  if (!text) return false;
  return codes.some((c) => {
    const code = (c || "").trim().toLowerCase();
    return code.length >= 3 && text.includes(code);
  });
}
