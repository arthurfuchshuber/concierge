/**
 * Modo da reserva: individual ou grupo — decidido pelos PRÓPRIOS hóspedes,
 * nunca forçado pelo sistema. Quando mais de uma pessoa aparece vinculada à
 * mesma reserva (mesmo imóvel + mesmas datas, nomes diferentes), a IA avisa
 * e pergunta se querem tratar assuntos como roteiro em conjunto. Só vira
 * "grupo" de verdade quando TODAS as pessoas que já apareceram nessa
 * reserva votaram "grupo" — enquanto isso não acontece (ninguém votou,
 * votos incompletos, ou alguém prefere separado), cada um continua isolado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient;

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Nomes distintos de hóspedes já vinculados a esta reserva (via conversas
 * criadas), incluindo o próprio — usado pra saber se há alguém mais. */
export async function getReservationGuestNames(params: {
  supabase: Admin;
  propertyId: string;
  checkinDate: string;
  checkoutDate: string;
}): Promise<string[]> {
  const { data } = await params.supabase
    .from("property_chat_conversations")
    .select("guest_name")
    .eq("property_id", params.propertyId)
    .eq("checkin_date", params.checkinDate)
    .eq("checkout_date", params.checkoutDate)
    .not("guest_name", "is", null);
  const names = (data ?? []).map((r) => r.guest_name as string).filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const n of names) {
    const key = normalizeName(n);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(n);
    }
  }
  return unique;
}

export type ReservationModeInfo = {
  /** "group" só quando TODOS os nomes conhecidos votaram "group". Caso
   * contrário "individual" — o padrão seguro enquanto não há consenso. */
  mode: "individual" | "group";
  /** Outras pessoas (diferente da atual) já vinculadas a esta reserva. */
  otherGuestNames: string[];
  /** true quando a pessoa atual ainda não votou nada nesta reserva — sinal
   * pra IA perguntar, uma vez só. */
  currentGuestHasNotVoted: boolean;
};

export async function getReservationMode(params: {
  supabase: Admin;
  propertyId: string;
  checkinDate: string;
  checkoutDate: string;
  currentGuestName: string;
}): Promise<ReservationModeInfo> {
  const [allNames, votesRes] = await Promise.all([
    getReservationGuestNames({
      supabase: params.supabase,
      propertyId: params.propertyId,
      checkinDate: params.checkinDate,
      checkoutDate: params.checkoutDate,
    }),
    params.supabase
      .from("reservation_group_votes")
      .select("normalized_name, vote")
      .eq("property_id", params.propertyId)
      .eq("checkin_date", params.checkinDate)
      .eq("checkout_date", params.checkoutDate),
  ]);

  const currentKey = normalizeName(params.currentGuestName);
  const otherGuestNames = allNames.filter((n) => normalizeName(n) !== currentKey);

  const votes = votesRes.data ?? [];
  const votesByName = new Map(votes.map((v) => [v.normalized_name as string, v.vote as string]));
  const currentGuestHasNotVoted = !votesByName.has(currentKey);

  // Só é "group" se: há mais de uma pessoa conhecida nesta reserva, TODAS
  // já votaram, e TODAS votaram "group". Uma única pessoa sozinha na
  // reserva (ainda) não tem com quem agrupar — fica individual por padrão,
  // sem precisar de voto nenhum.
  if (allNames.length <= 1) {
    return { mode: "individual", otherGuestNames, currentGuestHasNotVoted: false };
  }
  const allVoted = allNames.every((n) => votesByName.has(normalizeName(n)));
  const allWantGroup = allVoted && allNames.every((n) => votesByName.get(normalizeName(n)) === "group");

  return {
    mode: allWantGroup ? "group" : "individual",
    otherGuestNames,
    currentGuestHasNotVoted,
  };
}

export async function setReservationVote(params: {
  supabase: Admin;
  propertyId: string;
  checkinDate: string;
  checkoutDate: string;
  guestName: string;
  vote: "individual" | "group";
}): Promise<void> {
  await params.supabase.from("reservation_group_votes").upsert(
    {
      property_id: params.propertyId,
      checkin_date: params.checkinDate,
      checkout_date: params.checkoutDate,
      guest_name: params.guestName,
      normalized_name: normalizeName(params.guestName),
      vote: params.vote,
      voted_at: new Date().toISOString(),
    },
    { onConflict: "property_id,checkin_date,checkout_date,normalized_name" },
  );
}
