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

/**
 * The Data API caps each response at 1,000 rows even when a larger limit is
 * requested. Engagement events must therefore be read page by page; otherwise
 * older, less frequent events such as `checkin-lido` disappear from cards.
 */
export async function fetchEngagementSectionEvents(
  supabase: SupabaseClient,
  propertyIds: string[],
  sections: string[],
): Promise<EngagementSectionEvent[]> {
  if (propertyIds.length === 0 || sections.length === 0) return [];

  const rows: EngagementSectionEvent[] = [];
  for (let from = 0; ; from += EVENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("guide_section_events")
      .select("id, property_id, section, guest_name, guest_phone, created_at")
      .in("property_id", propertyIds)
      .in("section", sections)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + EVENT_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as EngagementSectionEvent[];
    rows.push(...page);
    if (page.length < EVENT_PAGE_SIZE) break;
  }
  return rows;
}