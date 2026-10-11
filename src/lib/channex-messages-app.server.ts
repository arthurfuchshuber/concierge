/**
 * Ciclo de vida do app "Channex Messages & Reviews" por propriedade Channex.
 * A chave da IA no painel é a única fonte: ligada = app instalado/ativo
 * (Channex passa a entregar mensagens), desligada = app desativado na Channex.
 * Gêmeos têm propriedade Channex própria, então recebem o mesmo tratamento.
 */
const BASE = "https://app.channex.io/api/v1";
const APP_CODE = "channex_messages";

function headers() {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave da Channex não configurada.");
  return { "user-api-key": key, "Content-Type": "application/json", Accept: "application/json" };
}

type Installation = { id: string; attributes: { property_id: string; application_code: string; is_active: boolean } };

async function listInstalled(): Promise<Installation[]> {
  const res = await fetch(`${BASE}/applications/installed`, { headers: headers() });
  if (!res.ok) throw new Error(`Channex respondeu ${res.status} ao listar apps.`);
  const j = (await res.json()) as { data?: Installation[] };
  return (j.data ?? []).filter((i) => i.attributes?.application_code === APP_CODE);
}

async function setActive(id: string, active: boolean) {
  const res = await fetch(`${BASE}/applications/installed/${id}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ application_installation: { is_active: active } }),
  });
  if (!res.ok) throw new Error(`Channex respondeu ${res.status} ao ${active ? "ativar" : "desativar"} o chat.`);
}

async function install(propertyId: string) {
  const res = await fetch(`${BASE}/applications/install`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ application_installation: { property_id: propertyId, application_code: APP_CODE } }),
  });
  if (!res.ok && res.status !== 422) throw new Error(`Channex respondeu ${res.status} ao instalar o chat.`);
}

/** Garante o app ligado/desligado em todas as propriedades Channex informadas. */
export async function syncMessagesApp(channexPropertyIds: string[], enabled: boolean) {
  const ids = [...new Set(channexPropertyIds.filter(Boolean))];
  if (!ids.length) return;
  const installed = await listInstalled();
  for (const pid of ids) {
    const inst = installed.find((i) => i.attributes.property_id === pid);
    // A listagem da Channex não traz is_active: o PUT é idempotente, então sempre aplica.
    if (enabled) {
      if (!inst) await install(pid);
      else await setActive(inst.id, true);
    } else if (inst) {
      await setActive(inst.id, false);
    }
  }
}

/** Propriedades Channex do imóvel (principal + gêmeos ativos). */
export async function channexPropertiesFor(admin: any, propertyId: string): Promise<string[]> {
  const [{ data: raw }, { data: twins }] = await Promise.all([
    admin.from("property_listing_raw_data").select("channex_property_id").eq("property_id", propertyId).maybeSingle(),
    admin
      .from("channex_twin_links")
      .select("primary_channex_property_id, twin_channex_property_id")
      .eq("property_id", propertyId)
      .eq("status", "active"),
  ]);
  const ids: string[] = [];
  if (raw?.channex_property_id) ids.push(raw.channex_property_id);
  for (const t of twins ?? []) ids.push(t.primary_channex_property_id, t.twin_channex_property_id);
  return ids.filter(Boolean);
}
