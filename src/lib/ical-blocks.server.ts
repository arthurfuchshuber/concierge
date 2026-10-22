/**
 * "Importar bloqueios manuais" da janela "Finalize a ativação": lê o iCal do anúncio e grava cada
 * bloqueio (não as reservas, que chegam pela API) como bloqueio manual do imóvel — gêmeos inclusos,
 * pois compartilham o imóvel — e guarda o link para a carga inicial da unidade ainda não mapeada.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Eventos do iCal do Airbnb: datas [from, to) e se é reserva de hóspede ("Reserved") ou bloqueio. */
export function parseIcalEvents(raw: string) {
  const text = raw.replace(/\r?\n[ \t]/g, "");
  const f = (x: string) => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`;
  const out: { from: string; to: string; reserved: boolean }[] = [];
  for (const ev of text.split("BEGIN:VEVENT").slice(1)) {
    const s = /DTSTART[^:]*:(\d{8})/.exec(ev)?.[1];
    const e = /DTEND[^:]*:(\d{8})/.exec(ev)?.[1];
    if (!s || !e) continue;
    const summary = /SUMMARY[^:]*:([^\r\n]*)/.exec(ev)?.[1] ?? "";
    out.push({ from: f(s), to: f(e), reserved: /reserv/i.test(summary) });
  }
  return out;
}

export function isAirbnbIcsLink(url: string) {
  try {
    return /\.ics$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export async function importIcalBlocks(propertyId: string, icalUrl: string, userId: string | null) {
  const url = icalUrl.trim();
  const { isAllowedIcalUrl } = await import("@/lib/airbnb-ical-url");
  if (!isAllowedIcalUrl(url) || !isAirbnbIcsLink(url))
    throw new Error("Link inválido. Use o link de exportação do calendário do Airbnb (termina em .ics).");
  let timedOut = false;
  const res = await fetch(url, { headers: { Accept: "text/calendar" }, signal: AbortSignal.timeout(10_000) }).catch((e) => {
    timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    return null;
  });
  if (timedOut) throw new Error("O Airbnb demorou para responder ao link do calendário. Tente novamente em alguns instantes.");
  if (!res?.ok) throw new Error("Não conseguimos ler este link. Confira se copiou o link de exportação correto.");
  const body = await res.text();
  if (!body.includes("BEGIN:VCALENDAR")) throw new Error("Este link não é um calendário iCal válido.");
  const today = isoDay(new Date());
  const { createManualBlock, pushPropertyAvailability } = await import("@/lib/manual-blocks.server");
  let imported = 0;
  let skipped = 0;
  for (const ev of parseIcalEvents(body)) {
    if (ev.reserved || ev.to <= today) continue;
    const from = ev.from < today ? today : ev.from;
    try {
      await createManualBlock({ propertyId, from, to: ev.to, note: "Bloqueio importado do Airbnb (iCal)", userId, push: false });
      imported++;
    } catch {
      skipped++;
    }
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await (supabaseAdmin as any).from("properties").update({ airbnb_ical_url: url }).eq("id", propertyId);
  const { seedUnitCalendar } = await import("@/lib/channex-full-connect.server");
  await seedUnitCalendar(propertyId, userId).catch((e) => console.error("[ical-blocks] seed", e));
  await pushPropertyAvailability(propertyId, userId).catch((e) => console.error("[ical-blocks] push", e));
  return { imported, skipped };
}
