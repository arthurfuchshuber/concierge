import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Colunas de conteúdo do guia — exclui deliberadamente os códigos de acesso
// físico do imóvel (wifi_password, gate_code, lock_code, access_codes_pin,
// pin_code). Este tool é exposto via OAuth a qualquer app externo que o
// anfitrião autorizar no consentimento (`/.lovable/oauth/consent`); um
// `select("*")` devolvia esses códigos por completo a qualquer app
// autorizado, mesmo quando o consentimento descreve o acesso apenas como
// "seus guias e a atividade dos hóspedes" — muito mais amplo do que o texto
// sugere. Em vez de remover o tool, mantemos os dados de conteúdo (úteis
// para um assistente revisar/editar o guia) e devolvemos apenas *_set para
// os campos sensíveis, para que o assistente saiba se estão preenchidos sem
// nunca ver o valor.
const PROPERTY_SAFE_COLUMNS =
  "id,owner_id,owner_contact_id,slug,name,tagline,city,state,country,address,address_note,maps_url,garage_maps_url,lat,lng," +
  "hero_image_url,gallery_images,theme_images,brand_name,brand_logo_url,marketplace_links," +
  "checkin_time,checkin_time_max,checkin_note,checkin_instructions,checkin_media," +
  "checkout_time,checkout_time_min,checkout_note,checkout_instructions," +
  "gate_label,gate_instructions,gate_media,gate_video_url," +
  "lock_label,lock_instructions,lock_media,lock_video_url," +
  "wifi_ssid,host_name,host_phone,portaria_email,house_rules," +
  "access_mode,pin_expires_at,require_access_gate,collect_arrival_time,collect_vehicles,vehicles_max,collect_document,document_scope," +
  "airbnb_ical_url,airbnb_ical_url_2,airbnb_ical_last_sync_at,airbnb_ical_last_error,airbnb_listing_url," +
  "default_language,guide_theme,guide_created,property_type_id,published," +
  "sigma_pack_city_key,sigma_pack_activated_at,sigma_pack_snapshot,created_at,updated_at";

export default defineTool({
  name: "get_property",
  title: "Get property details",
  description:
    "Fetch details for one property (guide) owned by the signed-in user — guide content and settings only. " +
    "Does NOT return physical access codes (Wi-Fi password, gate/lock codes, access PIN); use the *_set booleans " +
    "to check whether they're configured. Accepts either the id (UUID) or the slug.",
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
    let q = supabase.from("properties").select(PROPERTY_SAFE_COLUMNS);
    q = id ? q.eq("id", id) : q.eq("slug", slug!);
    const { data, error } = await q.maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Not found" }], isError: true };
    const row = data as unknown as Record<string, unknown>;
    // Segunda query, mínima, só para saber se cada segredo está preenchido —
    // nunca devolve o valor em si.
    const { data: secretFlags } = await supabase
      .from("properties")
      .select("wifi_password,gate_code,lock_code,access_codes_pin,pin_code")
      .eq("id", row.id as string)
      .maybeSingle();
    const sf = (secretFlags ?? {}) as Record<string, unknown>;
    const withFlags = {
      ...row,
      wifi_password_set: !!String(sf.wifi_password ?? "").trim(),
      gate_code_set: !!String(sf.gate_code ?? "").trim(),
      lock_code_set: !!String(sf.lock_code ?? "").trim(),
      access_codes_pin_set: !!String(sf.access_codes_pin ?? "").trim(),
      pin_code_set: !!String(sf.pin_code ?? "").trim(),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(withFlags, null, 2) }],
      structuredContent: { property: withFlags },
    };
  },
});
