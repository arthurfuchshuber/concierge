// Preenche campos vazios de um cadastro a partir do contrato ClickSign vinculado.
// Server-only: usado pela extração individual e pelo botão "Atualizar Dados".

import type { SupabaseClient } from "@supabase/supabase-js";

export const FIELD_LABELS: Record<string, string> = {
  birth_date: "data de nascimento",
  phone: "telefone",
  cep: "CEP",
  address: "endereço",
  district: "bairro",
  city: "cidade",
  state: "estado",
  email: "e-mail",
  doc: "documento",
};

const FIELDS = [
  "birth_date",
  "phone",
  "cep",
  "address",
  "district",
  "city",
  "state",
  "email",
  "doc",
] as const;

async function freshDocUrl(
  supabase: SupabaseClient,
  userId: string,
  doc: Record<string, unknown>,
): Promise<string | null> {
  let url = (doc["url_signed"] as string) ?? (doc["url_original"] as string) ?? null;
  try {
    const { decryptToken } = await import("@/lib/whatsapp.server");
    const cs = await import("@/lib/clicksign.server");
    const { data: cred } = await supabase
      .from("host_integration_credentials")
      .select("api_token_encrypted")
      .eq("owner_id", userId)
      .eq("provider", "clicksign")
      .maybeSingle();
    if (cred?.api_token_encrypted) {
      const token = decryptToken(cred.api_token_encrypted as string);
      const detail = await cs.csFetch(
        token,
        "production",
        `/api/v1/documents/${String(doc["document_key"])}`,
      );
      const d = (detail["document"] ?? detail) as Record<string, unknown>;
      const dl = (d["downloads"] as Record<string, unknown> | undefined) ?? {};
      url = (dl["signed_file_url"] as string) ?? (dl["original_file_url"] as string) ?? url;
    }
  } catch {
    /* usa a URL salva */
  }
  return url;
}

/** Lê o contrato mais recente e preenche SOMENTE os campos vazios do cadastro. */
export async function fillFromContract(
  supabase: SupabaseClient,
  userId: string,
  kind: "owner" | "provider",
  id: string,
): Promise<{ filled: string[]; docName: string | null }> {
  const table = kind === "provider" ? "service_providers" : "property_owners";

  const { data: row } = await supabase
    .from(table)
    .select("*")
    .eq("id", id)
    .eq("account_owner_id", userId)
    .maybeSingle();
  if (!row) throw new Error("Cadastro não encontrado.");

  const { data: docs } = await supabase
    .from("clicksign_documents")
    .select("id, name, document_key, url_signed, url_original, finished_at, created_at")
    .eq("account_owner_id", userId)
    .eq("stakeholder_type", kind)
    .eq("stakeholder_id", id)
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const doc = (docs ?? [])[0] as Record<string, unknown> | undefined;
  if (!doc) throw new Error("Nenhum contrato vinculado a este cadastro.");

  // Nada a preencher? evita download e chamada de IA.
  const missing = FIELDS.filter((f) => !String((row as Record<string, unknown>)[f] ?? "").trim());
  if (missing.length === 0) return { filled: [], docName: (doc["name"] as string) ?? null };

  const url = await freshDocUrl(supabase, userId, doc);
  if (!url) throw new Error("Documento sem arquivo disponível para leitura.");

  const ex = await import("@/lib/contract-extract.server");
  const page = await ex.firstPageText(url);
  const party = await ex.parseContratante(ex.contratanteBlock(page));

  const patch: Record<string, unknown> = {};
  for (const f of missing) {
    const next = party[f as keyof typeof party];
    if (next) patch[f] = next;
  }
  if (patch["phone"] && !String((row as Record<string, unknown>)["phone_country"] ?? "").trim()) {
    patch["phone_country"] = "55";
  }
  if (Object.keys(patch).length === 0) return { filled: [], docName: (doc["name"] as string) ?? null };

  const { error } = await supabase
    .from(table)
    .update(patch as never)
    .eq("id", id)
    .eq("account_owner_id", userId);
  if (error) throw new Error(error.message);

  const filled = Object.keys(patch).filter((k) => FIELD_LABELS[k]);
  await supabase.from("stakeholder_events").insert({
    account_owner_id: userId,
    stakeholder_type: kind,
    stakeholder_id: id,
    kind: "clicksign",
    message: `Dados extraídos do contrato "${(doc["name"] as string) ?? "ClickSign"}": ${filled
      .map((k) => FIELD_LABELS[k])
      .join(", ")}.`,
    metadata: { source: "clicksign_contract_extract", document_id: doc["id"], fields: filled },
  });

  return { filled, docName: (doc["name"] as string) ?? null };
}

/**
 * Data (yyyy-mm-dd) do primeiro documento assinado no ClickSign vinculado a
 * este cadastro. Quando há mais de um documento (contrato, aditivo, termo…),
 * usamos sempre o mais antigo já concluído — é o que mais se aproxima do
 * início real da vigência.
 */
async function earliestSignedAt(
  supabase: SupabaseClient,
  userId: string,
  kind: "owner" | "provider",
  id: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("clicksign_documents")
    .select("finished_at")
    .eq("account_owner_id", userId)
    .eq("stakeholder_type", kind)
    .eq("stakeholder_id", id)
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const at = (data?.finished_at as string | undefined) ?? null;
  return at ? at.slice(0, 10) : null;
}

/**
 * Preenche a "Início do contrato" com a data do primeiro documento assinado
 * no ClickSign. Nunca sobrescreve um valor já existente por conta própria —
 * se o cadastro já tem uma data diferente, isso vira um "conflito" e só é
 * resolvido se quem acionou a sincronização pedir explicitamente (`overwrite`).
 */
export async function fillContractStartFromClicksign(
  supabase: SupabaseClient,
  userId: string,
  kind: "owner" | "provider",
  id: string,
  overwrite: boolean,
): Promise<{
  status: "filled" | "overwritten" | "conflict" | "unchanged";
  name: string | null;
  current: string | null;
  suggested: string | null;
}> {
  const table = kind === "provider" ? "service_providers" : "property_owners";
  const suggested = await earliestSignedAt(supabase, userId, kind, id);
  if (!suggested) return { status: "unchanged", name: null, current: null, suggested: null };

  const { data: row } = await supabase
    .from(table)
    .select("contract_start, name, trade_name")
    .eq("id", id)
    .eq("account_owner_id", userId)
    .maybeSingle();
  if (!row) return { status: "unchanged", name: null, current: null, suggested };

  const name = ((row as Record<string, unknown>)["trade_name"] as string) || ((row as Record<string, unknown>)["name"] as string) || null;
  const current = ((row as Record<string, unknown>)["contract_start"] as string | null) ?? null;

  if (!current) {
    await supabase.from(table).update({ contract_start: suggested }).eq("id", id).eq("account_owner_id", userId);
    return { status: "filled", name, current: null, suggested };
  }
  if (current === suggested) return { status: "unchanged", name, current, suggested };
  if (!overwrite) return { status: "conflict", name, current, suggested };

  await supabase.from(table).update({ contract_start: suggested }).eq("id", id).eq("account_owner_id", userId);
  return { status: "overwritten", name, current, suggested };
}
