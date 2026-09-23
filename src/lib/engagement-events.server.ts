import type { SupabaseClient } from "@supabase/supabase-js";

export type EngagementSectionEvent = {
  id: string;
  property_id: string;
  section: string;
  guest_name: string | null;
  guest_phone: string | null;
  created_at: string;
};

const EVENT_PAGE_SIZE = 1000;
const MAX_TENTATIVAS = 3;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Falha temporária do banco (fila de conexões cheia) — vale tentar de novo. */
function eTemporario(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("connection pool") ||
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("too many connections")
  );
}

/**
 * The Data API caps each response at 1,000 rows even when a larger limit is
 * requested. Engagement events must therefore be read page by page; otherwise
 * older, less frequent events such as `checkin-lido` disappear from cards.
 *
 * Uma falha temporária do banco não pode derrubar o painel inteiro: tentamos de
 * novo algumas vezes e, se ainda assim falhar, devolvemos o que já foi lido.
 */
export async function fetchEngagementSectionEvents(
  supabase: SupabaseClient,
  propertyIds: string[],
  sections: string[],
): Promise<EngagementSectionEvent[]> {
  if (propertyIds.length === 0 || sections.length === 0) return [];

  const rows: EngagementSectionEvent[] = [];
  for (let from = 0; ; from += EVENT_PAGE_SIZE) {
    let page: EngagementSectionEvent[] | null = null;
    let ultimoErro = "";

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      const { data, error } = await supabase
        .from("guide_section_events")
        .select("id, property_id, section, guest_name, guest_phone, created_at")
        .in("property_id", propertyIds)
        .in("section", sections)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + EVENT_PAGE_SIZE - 1);

      if (!error) {
        page = (data ?? []) as EngagementSectionEvent[];
        break;
      }
      ultimoErro = error.message;
      if (!eTemporario(ultimoErro) || tentativa === MAX_TENTATIVAS) break;
      await espera(250 * tentativa);
    }

    if (!page) {
      if (eTemporario(ultimoErro)) {
        console.error("[engagement-events] banco indisponível, seguindo com dados parciais:", ultimoErro);
        return rows;
      }
      throw new Error(ultimoErro);
    }

    rows.push(...page);
    if (page.length < EVENT_PAGE_SIZE) break;
  }
  return rows;
}

