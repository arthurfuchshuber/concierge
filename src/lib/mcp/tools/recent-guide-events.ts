import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "recent_guide_events",
  title: "Recent guide activity",
  description:
    "List the most recent guest navigation events on one of the signed-in user's properties (guide accesses, pages viewed).",
  inputSchema: {
    propertyId: z.string().uuid().describe("Property UUID to inspect."),
    limit: z.number().int().min(1).max(200).optional().describe("Max events (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ propertyId, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    // RLS on properties restricts to owner — confirm ownership first.
    const { data: prop, error: propErr } = await supabase
      .from("properties")
      .select("id")
      .eq("id", propertyId)
      .maybeSingle();
    if (propErr) return { content: [{ type: "text", text: propErr.message }], isError: true };
    if (!prop) return { content: [{ type: "text", text: "Property not found or not yours." }], isError: true };

    const { data, error } = await supabase
      .from("guide_section_events")
      .select("created_at, session_id, guest_name, guest_phone, page_path, section, dwell_ms")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { events: data },
    };
  },
});
