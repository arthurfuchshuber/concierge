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
  name: "get_property",
  title: "Get property details",
  description:
    "Fetch full details for one property (guide) owned by the signed-in user. Accepts either the id (UUID) or the slug.",
  inputSchema: {
    id: z.string().uuid().optional().describe("Property UUID."),
    slug: z.string().min(1).optional().describe("Property slug."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, slug }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    if (!id && !slug) {
      return { content: [{ type: "text", text: "Provide id or slug." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase.from("properties").select("*");
    q = id ? q.eq("id", id) : q.eq("slug", slug!);
    const { data, error } = await q.maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Not found" }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { property: data },
    };
  },
});
