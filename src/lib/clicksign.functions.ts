import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ClicksignConfigPublic = {
  environment: "production" | "sandbox";
  status: "pending" | "active" | "error";
  hasToken: boolean;
  lastVerifiedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  documentsCount: number;
};

const SAVE_INPUT = z.object({
  apiToken: z.string().trim().min(10).max(500).optional(),
  environment: z.literal("production").default("production"),
});

export const getMyClicksignConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClicksignConfigPublic> => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("host_integration_credentials")
      .select("environment, status, api_token_encrypted, last_verified_at, last_sync_at, last_error")
      .eq("owner_id", userId)
      .eq("provider", "clicksign")
      .maybeSingle();
    const { count } = await supabase
      .from("clicksign_documents")
      .select("id", { count: "exact", head: true })
      .eq("account_owner_id", userId);
    return {
      environment: ((data?.environment as ClicksignConfigPublic["environment"]) ?? "production"),
      status: ((data?.status as ClicksignConfigPublic["status"]) ?? "pending"),
      hasToken: Boolean(data?.api_token_encrypted),
      lastVerifiedAt: (data?.last_verified_at as string) ?? null,
      lastSyncAt: (data?.last_sync_at as string) ?? null,
      lastError: (data?.last_error as string) ?? null,
      documentsCount: count ?? 0,
    };
  });

export const saveMyClicksignConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => SAVE_INPUT.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { csFetch } = await import("@/lib/clicksign.server");
    const { encryptToken, decryptToken } = await import("@/lib/whatsapp.server");

    let token = data.apiToken ?? "";
    if (!token) {
      const { data: existing } = await supabase
        .from("host_integration_credentials")
        .select("api_token_encrypted")
        .eq("owner_id", userId)
        .eq("provider", "clicksign")
        .maybeSingle();
      if (!existing?.api_token_encrypted) throw new Error("Informe a chave de API do ClickSign.");
      token = decryptToken(existing.api_token_encrypted as string);
    }

    // ClickSign não tem /me: validamos listando 1 documento.
    try {
      await csFetch(token, "production", "/api/v1/documents?page=1&per_page=1");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("host_integration_credentials").upsert({
        owner_id: userId,
        provider: "clicksign",
        environment: "production",
        status: "error",
        last_error: msg,
      }, { onConflict: "owner_id,provider" });
      throw new Error(`Chave inválida: ${msg}`);
    }

    const { error } = await supabase.from("host_integration_credentials").upsert({
      owner_id: userId,
      provider: "clicksign",
      environment: "production",
      api_token_encrypted: encryptToken(token),
      status: "active",
      last_error: null,
      last_verified_at: new Date().toISOString(),
    }, { onConflict: "owner_id,provider" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disconnectMyClicksign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ purge: z.boolean().default(false) }).parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (data.purge) {
      // Remove tudo que a integração criou: contratos importados e os cadastros
      // gerados automaticamente (os manuais permanecem intactos).
      const [{ data: owners }, { data: providers }] = await Promise.all([
        supabase.from("property_owners").select("id")
          .eq("account_owner_id", userId).eq("created_via", "clicksign"),
        supabase.from("service_providers").select("id")
          .eq("account_owner_id", userId).eq("created_via", "clicksign"),
      ]);
      const ids = [
        ...(owners ?? []).map((r) => r.id),
        ...(providers ?? []).map((r) => r.id),
      ];
      if (ids.length) {
        await supabase.from("stakeholder_link_aliases").delete()
          .eq("account_owner_id", userId).in("stakeholder_id", ids);
      }
      await supabase.from("clicksign_documents").delete().eq("account_owner_id", userId);
      if (owners?.length) {
        await supabase.from("property_owners").delete()
          .eq("account_owner_id", userId).eq("created_via", "clicksign");
      }
      if (providers?.length) {
        await supabase.from("service_providers").delete()
          .eq("account_owner_id", userId).eq("created_via", "clicksign");
      }
    }

    await supabase.from("host_integration_credentials").delete()
      .eq("owner_id", userId).eq("provider", "clicksign");
    return { ok: true, purged: data.purge };
  });

export const syncMyClicksignDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { decryptToken } = await import("@/lib/whatsapp.server");
    const cs = await import("@/lib/clicksign.server");

    const { data: cred } = await supabase
      .from("host_integration_credentials")
      .select("environment, api_token_encrypted")
      .eq("owner_id", userId)
      .eq("provider", "clicksign")
      .maybeSingle();
    if (!cred?.api_token_encrypted) throw new Error("Conecte o ClickSign antes de importar.");
    const token = decryptToken(cred.api_token_encrypted as string);
    const env = "production" as const;

    // 1. Baixa todos os documentos (com detalhes/signatários).
    type Doc = { csDoc: Record<string, unknown>; signers: Array<Record<string, unknown>> };
    const docs: Doc[] = [];
    // Sem recorte de período: percorre todas as páginas da conta.
    for (let page = 1; page <= 400; page++) {
      const res = await cs.csFetch(token, env, `/api/v1/documents?page=${page}&per_page=50`);
      const raw = (res["documents"] ?? res["document"] ?? []) as unknown;
      const list = (Array.isArray(raw) ? raw : [raw]) as Array<Record<string, unknown>>;
      if (!list.length) break;
      for (const summary of list) {
        const key = summary?.["key"];
        if (!key) continue;
        let csDoc = summary;
        let signers = (summary["signers"] as Array<Record<string, unknown>>) ?? [];
        try {
          const detail = await cs.csFetch(token, env, `/api/v1/documents/${String(key)}`);
          const d = (detail["document"] ?? detail) as Record<string, unknown>;
          csDoc = { ...summary, ...d };
          const sigs = d["signers"] ?? (Array.isArray(d["signatures"])
            ? (d["signatures"] as Array<Record<string, unknown>>).map((s) => (s["signer"] ?? s) as Record<string, unknown>)
            : []);
          signers = (sigs as Array<Record<string, unknown>>) ?? [];
        } catch {
          /* mantém o resumo */
        }
        docs.push({ csDoc, signers });
      }
      if (list.length < 50) break;
    }

    // 2. Base de stakeholders da conta + vínculos aprendidos.
    const [{ data: owners }, { data: providers }, { data: guests }, { data: aliases }] = await Promise.all([
      supabase.from("property_owners").select("id, name, trade_name, email, doc, phone").eq("account_owner_id", userId),
      supabase.from("service_providers").select("id, name, trade_name, email, doc, phone").eq("account_owner_id", userId),
      supabase.from("guide_access_logs").select("guest_name, property_id").not("guest_name", "is", null).limit(1000),
      supabase
        .from("stakeholder_link_aliases")
        .select("alias_kind, alias_value, stakeholder_type, stakeholder_id")
        .eq("account_owner_id", userId),
    ]);
    const matching = await import("@/lib/stakeholder-matching.server");
    const index = matching.buildMatchIndex(
      (owners ?? []) as never,
      (providers ?? []) as never,
      (aliases ?? []) as never,
    );
    const internal = cs.buildInternalSignerSet(docs);

    let inserted = 0;
    let updated = 0;
    let linked = 0;

    for (const { csDoc, signers } of docs) {
      const key = String(csDoc["key"]);
      const filename = (csDoc["filename"] as string) ?? (csDoc["path"] as string) ?? "Documento ClickSign";
      const signer = cs.selectCounterpartSigner(signers, filename, internal);

      let stakeholderType: string | null = null;
      let stakeholderId: string | null = null;
      let guestName: string | null = null;
      let propertyId: string | null = null;

      const hit = signer
        ? matching.resolveStakeholder(index, {
            docs: [cs.signerDoc(signer)],
            emails: [String(signer["email"] ?? "")],
            phones: [String(signer["phone_number"] ?? signer["phone"] ?? "")],
            texts: [String(signer["name"] ?? ""), filename],
          })
        : null;

      if (hit) {
        stakeholderType = hit.type;
        stakeholderId = hit.id;
      } else if (signer) {
        const sName = cs.normalize(signer["name"]);
        const g = (guests ?? []).find((row) => sName && cs.normalize(row.guest_name) === sName);
        if (g) {
          stakeholderType = "guest";
          guestName = g.guest_name as string;
          propertyId = (g.property_id as string) ?? null;
        }
      }
      if (stakeholderType) linked++;



      const downloads = (csDoc["downloads"] as Record<string, unknown> | undefined) ?? {};
      const payload = {
        account_owner_id: userId,
        document_key: key,
        name: filename,
        status: (csDoc["status"] as string) ?? "unknown",
        signers: signers as never,
        url_original: (downloads["original_file_url"] as string) ?? null,
        url_signed: (downloads["signed_file_url"] as string) ?? null,
        finished_at: (csDoc["finished_at"] as string) ?? null,
        stakeholder_type: stakeholderType,
        stakeholder_id: stakeholderId,
        guest_name: guestName,
        property_id: propertyId,
        raw: csDoc as never,
        synced_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from("clicksign_documents")
        .select("id")
        .eq("account_owner_id", userId)
        .eq("document_key", key)
        .maybeSingle();

      if (existing) {
        await supabase.from("clicksign_documents").update(payload).eq("id", existing.id);
        updated++;
      } else {
        await supabase.from("clicksign_documents").insert(payload);
        inserted++;
      }
    }

    await supabase.from("host_integration_credentials").update({
      last_sync_at: new Date().toISOString(),
      status: "active",
      last_error: null,
    }).eq("owner_id", userId).eq("provider", "clicksign");

    return { inserted, updated, linked, total: docs.length };
  });

export const listMyClicksignDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("clicksign_documents")
      .select("id, document_key, name, status, signers, url_signed, url_original, finished_at, stakeholder_type, stakeholder_id, guest_name, synced_at")
      .or(`account_owner_id.eq.${userId}`)
      .order("finished_at", { ascending: false, nullsFirst: false })
      .limit(200);
    return { documents: data ?? [] };
  });
