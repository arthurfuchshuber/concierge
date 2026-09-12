// ClickSign — cliente HTTP e heurísticas de vínculo (server-only).
// Racional importado do Orks Tech: importa todos os documentos da conta,
// identifica o signatário "contratante" (externo) e tenta casá-lo com um
// proprietário, prestador ou hóspede já cadastrado.

const CS_PROD = "https://app.clicksign.com";
const CS_SANDBOX = "https://sandbox.clicksign.com";

export type CsEnv = "production" | "sandbox";

export async function csFetch(token: string, env: CsEnv, path: string): Promise<Record<string, unknown>> {
  const base = env === "sandbox" ? CS_SANDBOX : CS_PROD;
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${base}${path}${sep}access_token=${encodeURIComponent(token)}`, {
    headers: { Accept: "application/json" },
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`ClickSign ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

export function normalize(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function onlyDigits(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

type Signer = Record<string, unknown>;

export function signerDoc(signer: Signer): string {
  return onlyDigits(signer?.["documentation"] ?? signer?.["cpf"] ?? signer?.["cnpj"]);
}

function hasValidDoc(signer: Signer): boolean {
  const d = signerDoc(signer);
  return d.length === 11 || d.length === 14;
}

function fingerprints(signer: Signer): string[] {
  const doc = signerDoc(signer);
  const email = normalize(signer?.["email"]);
  const name = normalize(signer?.["name"]);
  return [doc && `doc:${doc}`, email && `email:${email}`, name && `name:${name}`].filter(Boolean) as string[];
}

function primaryFingerprint(signer: Signer): string | null {
  return fingerprints(signer)[0] ?? null;
}

/** Signatários que aparecem em muitos contratos são, quase sempre, a própria operação. */
export function buildInternalSignerSet(docs: Array<{ signers: Signer[] }>): Set<string> {
  const counts = new Map<string, number>();
  for (const d of docs) {
    const seen = new Set<string>();
    for (const s of d.signers ?? []) {
      const fp = primaryFingerprint(s);
      if (fp) seen.add(fp);
    }
    for (const fp of seen) counts.set(fp, (counts.get(fp) ?? 0) + 1);
  }
  const threshold = docs.length <= 2 ? 2 : Math.max(3, Math.ceil(docs.length * 0.35));
  const internal = new Set<string>();
  for (const d of docs) {
    for (const s of d.signers ?? []) {
      const fp = primaryFingerprint(s);
      if (fp && (counts.get(fp) ?? 0) >= threshold) for (const a of fingerprints(s)) internal.add(a);
    }
  }
  return internal;
}

function isInternal(signer: Signer, internal: Set<string>): boolean {
  return fingerprints(signer).some((fp) => internal.has(fp));
}

function nameMatchesFilename(signer: Signer, filename: string | null): boolean {
  const docNorm = normalize(filename);
  const name = normalize(signer?.["name"]);
  if (!docNorm || !name) return false;
  if (docNorm.includes(name)) return true;
  const words = name.split(" ").filter((w) => w.length > 2);
  if (words.length === 1) return docNorm.includes(words[0]!);
  return words.slice(0, 2).every((w) => docNorm.includes(w));
}

export function selectCounterpartSigner(
  signers: Signer[],
  filename: string | null,
  internal: Set<string>,
): Signer | null {
  const eligible = (signers ?? []).filter(hasValidDoc);
  if (!eligible.length) return null;

  const byRole = eligible.filter((s) => {
    const role = String(s?.["sign_as"] ?? s?.["role"] ?? "").toLowerCase();
    return ["contractee", "contratante", "customer", "client", "cliente"].includes(role);
  }).filter((s) => !isInternal(s, internal));
  if (byRole.length === 1) return byRole[0]!;

  const byFile = eligible.filter((s) => nameMatchesFilename(s, filename));
  const externalByFile = byFile.filter((s) => !isInternal(s, internal));
  if (externalByFile.length === 1) return externalByFile[0]!;
  if (byFile.length === 1) return byFile[0]!;

  const external = eligible.filter((s) => !isInternal(s, internal));
  if (external.length === 1) return external[0]!;
  return null;
}

export type StakeholderRow = {
  id: string;
  name: string | null;
  trade_name: string | null;
  email: string | null;
  doc: string | null;
};

export function matchStakeholder(signer: Signer | null, rows: StakeholderRow[]): string | null {
  if (!signer || !rows.length) return null;
  const sDoc = signerDoc(signer);
  const sEmail = normalize(signer?.["email"]);
  const sName = normalize(signer?.["name"]);
  for (const r of rows) {
    if (sDoc && onlyDigits(r.doc) === sDoc) return r.id;
  }
  for (const r of rows) {
    if (sEmail && r.email && normalize(r.email) === sEmail) return r.id;
  }
  for (const r of rows) {
    if (sName && sName.split(" ").length >= 2) {
      if ([r.name, r.trade_name].filter(Boolean).map(normalize).includes(sName)) return r.id;
    }
  }
  return null;
}
