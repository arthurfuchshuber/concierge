/**
 * Janela de liberação do código de acesso (Wi-Fi/portão/fechadura) protegido
 * por `access_codes_pin`.
 *
 * Regra de negócio já existente e correta no agente de IA
 * (`src/lib/ai/context.server.ts`, `pinReleaseAt`): o código só deve ficar
 * disponível a partir de 24h antes do horário de check-in até o horário de
 * check-out da reserva vigente. Este módulo replica exatamente a mesma
 * fórmula (mesmo cálculo de 24h antes do check-in, mesmo horário de
 * check-out como fechamento) para aplicá-la também no caminho que
 * efetivamente libera os dados para o hóspede (`getPublicGuide` /
 * `submitAccessPin`, em `src/lib/guide.functions.ts`) — hoje esse caminho só
 * confere se o PIN digitado bate com o cadastrado, sem nenhuma checagem de
 * data, permitindo acesso fora da janela sempre que o PIN correto é
 * informado (ex.: código reutilizado após o check-out, ou compartilhado
 * antes da liberação prevista).
 *
 * Quando a propriedade não tem NENHUMA reserva/registro de chegada
 * cadastrado (nem `guide_access_logs`, nem `property_reservations`
 * sincronizada do Airbnb), não há dado real contra o qual aplicar a janela —
 * nesse caso mantemos o comportamento atual (liberado só pelo PIN), para não
 * quebrar anfitriões que usam esse campo sem registrar chegadas no sistema.
 */

import { zonedTimeToUtc } from "@/lib/property-timezone";

function parseHm(v: unknown, fallbackH: number): [number, number] {
  const m = String(v ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? [Number(m[1]), Number(m[2])] : [fallbackH, 0];
}

/** Data/hora local do imóvel (em UTC) para uma data ISO + horário configurado. */
function localMoment(dateIso: string, tz: string, time: unknown, fallbackH: number): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = parseHm(time, fallbackH);
  return zonedTimeToUtc(y ?? 1970, m ?? 1, d ?? 1, hh, mm, tz);
}

/** 24h antes do horário previsto de check-in (fuso do imóvel), em UTC. */
export function pinReleaseAt(checkinDate: string, tz: string, checkinTime: unknown): Date {
  return new Date(localMoment(checkinDate, tz, checkinTime, 15).getTime() - 86_400_000);
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

const PLACEHOLDER_GUEST = "hóspede pendente";

export type AccessPinWindowResult =
  | { hasData: false }
  | { hasData: true; released: boolean };

/**
 * Verifica se "agora" está dentro da janela [check-in - 24h, check-out] de
 * QUALQUER reserva vigente/próxima da propriedade (o PIN é único por imóvel,
 * compartilhado com quem quer que seja o hóspede atual — não há, neste
 * caminho, identificação de qual hóspede está acessando).
 */
export async function resolveAccessPinWindow(
  supabaseAdmin: any,
  propertyId: string,
  tz: string,
  checkinTime: unknown,
  checkoutTime: unknown,
  today: string,
): Promise<AccessPinWindowResult> {
  const from = addDaysISO(today, -2);
  const to = addDaysISO(today, 2);

  const [{ data: logRows }, { data: resRows }] = await Promise.all([
    supabaseAdmin
      .from("guide_access_logs")
      .select("guest_name, checkin_date, checkout_date")
      .eq("property_id", propertyId)
      .gte("checkin_date", from)
      .lte("checkin_date", to)
      .limit(200),
    supabaseAdmin
      .from("property_reservations")
      .select("checkin_date, checkout_date")
      .eq("property_id", propertyId)
      .eq("source", "airbnb")
      .gte("checkin_date", from)
      .lte("checkin_date", to)
      .limit(200),
  ]);

  type Row = { guest_name?: string | null; checkin_date: string; checkout_date: string | null };
  const logs = ((logRows ?? []) as Row[]).filter(
    (l) => (l.guest_name ?? "").trim().toLowerCase() !== PLACEHOLDER_GUEST,
  );
  const reservations = (resRows ?? []) as Row[];
  const all = [...logs, ...reservations];

  if (all.length === 0) return { hasData: false };

  const now = Date.now();
  for (const r of all) {
    const ci = String(r.checkin_date).slice(0, 10);
    const co = r.checkout_date ? String(r.checkout_date).slice(0, 10) : ci;
    const releaseAt = pinReleaseAt(ci, tz, checkinTime).getTime();
    const closeAt = localMoment(co, tz, checkoutTime, 11).getTime();
    if (now >= releaseAt && now <= closeAt) return { hasData: true, released: true };
  }
  return { hasData: true, released: false };
}
