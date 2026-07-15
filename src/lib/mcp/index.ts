import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listPropertiesTool from "./tools/list-properties";
import getPropertyTool from "./tools/get-property";
import recentGuideEventsTool from "./tools/recent-guide-events";

// The OAuth issuer MUST be the direct Supabase host — the published SUPABASE_URL
// is the .lovable.cloud proxy which mcp-js rejects. VITE_SUPABASE_PROJECT_ID is
// inlined by Vite at build time.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "sigmaconcierge-mcp",
  title: "Concierge",
  version: "0.1.0",
  instructions:
    "Tools to inspect your Concierge properties (guest guides) and recent guest activity. Use list_properties to discover guides, get_property for full details, and recent_guide_events to see live guest navigation.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listPropertiesTool, getPropertyTool, recentGuideEventsTool],
});
