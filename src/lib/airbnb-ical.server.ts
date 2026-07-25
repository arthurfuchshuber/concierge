// Server-only helpers for Airbnb iCal sync.
// - Parses .ics files (line unfolding + VEVENT extraction)
// - Fetches remote calendar with timeout
// - Upserts into public.property_reservations

export type ParsedEvent = {
  uid: string;
  checkin: string; // YYYY-MM-DD
  checkout: string; // YYYY-MM-DD
  summary: string | null;
  description: string | null;
  url: string | null;
  status: string | null;
};

import { classifyCalendarPeriod } from "@/lib/reservations.server";

function unfold(ics: string): string[] {
  // RFC5545 line unfolding: any CRLF/LF followed by space or tab continues the previous line.
  const raw = ics.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function toISODate(raw: string): string | null {
  // Accepts YYYYMMDD or YYYYMMDDTHHMMSSZ; returns YYYY-MM-DD.
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function unescape(v: string): string {
  return v.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

export function parseIcs(ics: string): ParsedEvent[] {
  const lines = unfold(ics);
  const events: ParsedEvent[] = [];
  let current: Partial<ParsedEvent> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current && current.uid && current.checkin && current.checkout) {
        events.push({
          uid: current.uid,
          checkin: current.checkin,
          checkout: current.checkout,
          summary: current.summary ?? null,
          description: current.description ?? null,
          url: current.url ?? null,
          status: current.status ?? null,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const rawKey = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const key = rawKey.split(";")[0].toUpperCase();

    switch (key) {
      case "UID":
        current.uid = value.trim();
        break;
      case "DTSTART": {
        const d = toISODate(value);
        if (d) current.checkin = d;
        break;
      }
      case "DTEND": {
        const d = toISODate(value);
        if (d) current.checkout = d;
        break;
      }
      case "SUMMARY":
        current.summary = unescape(value).slice(0, 500);
        break;
      case "DESCRIPTION":
        current.description = unescape(value).slice(0, 2000);
        break;
      case "URL":
        current.url = value.trim().slice(0, 2048);
        break;
      case "STATUS":
        current.status = value.trim().toLowerCase().slice(0, 40);
        break;
    }
  }
  return events;
}

export function extractGuestHint(ev: ParsedEvent): string | null {
  // Airbnb confirmation codes look like "HM" + 6+ uppercase alphanumerics.
  // Host iCal feeds usually omit them entirely (SUMMARY="Reserved", no URL/DESCRIPTION);
  // only the guest's trip iCal exposes the code. Scan every field defensively and
  // require the HM… shape to avoid picking up path fragments like "/hosting/…".
  const src = [ev.description, ev.summary, ev.url, ev.uid].filter(Boolean).join("\n");
  const m = src.match(/\bHM[A-Z0-9]{6,}\b/);
  return m ? m[0] : null;
}

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "ConciergeIA/1.0 (+https://sigmaconcierge.lovable.app)" },
    });
  } finally {
    clearTimeout(t);
  }
}

export type SyncOutcome = {
  ok: boolean;
  imported: number;
  updated: number;
  removed: number;
  error?: string;
};

export async function syncPropertyIcal(propertyId: string, icalUrl: string): Promise<SyncOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date().toISOString();
  try {
    const res = await fetchWithTimeout(icalUrl);
    if (!res.ok) {
      const msg = `HTTP ${res.status}`;
      await supabaseAdmin
        .from("properties")
        .update({ airbnb_ical_last_sync_at: now, airbnb_ical_last_error: msg })
        .eq("id", propertyId);
      return { ok: false, imported: 0, updated: 0, removed: 0, error: msg };
    }
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) {
      const msg = "Arquivo iCal inválido (VCALENDAR ausente).";
      await supabaseAdmin
        .from("properties")
        .update({ airbnb_ical_last_sync_at: now, airbnb_ical_last_error: msg })
        .eq("id", propertyId);
      return { ok: false, imported: 0, updated: 0, removed: 0, error: msg };
    }

    const events = parseIcs(text);

    let imported = 0;
    let updated = 0;
    if (events.length > 0) {
      const rows = events.map((ev) => ({
        property_id: propertyId,
        source: "airbnb",
        external_uid: ev.uid,
        checkin_date: ev.checkin,
        checkout_date: ev.checkout,
        raw_summary: ev.summary,
        guest_hint: extractGuestHint(ev),
        reservation_url: ev.url,
        status:
          classifyCalendarPeriod({ checkin_date: ev.checkin, checkout_date: ev.checkout, raw_summary: ev.summary, status: ev.status }) === "block"
            ? "blocked"
            : ev.status ?? "confirmed",
        synced_at: now,
      }));
      const { data: existing } = await supabaseAdmin
        .from("property_reservations")
        .select("external_uid")
        .eq("property_id", propertyId)
        .eq("source", "airbnb");
      const known = new Set((existing ?? []).map((r) => r.external_uid));
      imported = rows.filter((r) => !known.has(r.external_uid)).length;
      updated = rows.length - imported;

      const { error: upErr } = await supabaseAdmin
        .from("property_reservations")
        .upsert(rows, { onConflict: "property_id,source,external_uid" });
      if (upErr) throw upErr;
    }

    // Remove past reservations that vanished from the feed (Airbnb only exposes future window).
    const uids = events.map((e) => e.uid);
    let removed = 0;
    const { data: staleFuture } = await supabaseAdmin
      .from("property_reservations")
      .select("id, external_uid")
      .eq("property_id", propertyId)
      .eq("source", "airbnb")
      .gte("checkout_date", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    const toDelete = (staleFuture ?? []).filter((r) => !uids.includes(r.external_uid)).map((r) => r.id);
    if (toDelete.length > 0) {
      const { error: delErr } = await supabaseAdmin
        .from("property_reservations")
        .delete()
        .in("id", toDelete);
      if (!delErr) removed = toDelete.length;
    }

    await supabaseAdmin
      .from("properties")
      .update({ airbnb_ical_last_sync_at: now, airbnb_ical_last_error: null })
      .eq("id", propertyId);

    return { ok: true, imported, updated, removed };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 500) : "erro desconhecido";
    await supabaseAdmin
      .from("properties")
      .update({ airbnb_ical_last_sync_at: now, airbnb_ical_last_error: msg })
      .eq("id", propertyId);
    return { ok: false, imported: 0, updated: 0, removed: 0, error: msg };
  }
}
