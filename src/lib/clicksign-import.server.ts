// Racional de importação automática de cadastros a partir do ClickSign.
// Server-only: agrupa os signatários "contraparte" dos contratos já importados,
// detecta duplicidades com a base atual e prepara a criação dos cadastros.

import {
  buildInternalSignerSet,
  normalize,
  onlyDigits,
  selectCounterpartSigner,
  signerDoc,
} from "@/lib/clicksign.server";

export type SignerCandidate = {
  /** Chave estável do candidato (doc, e-mail ou nome). */
  key: string;
  name: string;
  doc: string;
  docType: "cpf" | "cnpj" | null;
  email: string;
  phone: string;
  /** Quantos contratos trouxeram esse signatário. */
  documents: number;
  /** Nome de um dos contratos, para contexto na tela. */
  sampleDocument: string;
};

export type DuplicateMatch = {
  type: "owner" | "provider";
  id: string;
  label: string;
  email: string | null;
  doc: string | null;
  /** Motivo da suspeita de duplicidade. */
  reason: "doc" | "email" | "name";
};

export type ImportCandidate = SignerCandidate & {
  status: "new" | "duplicate" | "linked";
  matches: DuplicateMatch[];
  /** Sugestão de tipo com base no documento (CNPJ → prestador). */
  suggestedType: "owner" | "provider";
};

type StakeRow = {
  id: string;
  name: string | null;
  trade_name: string | null;
  email: string | null;
  doc: string | null;
};

type DocRow = { name: string | null; signers: unknown };

function fingerprintOf(s: Record<string, unknown>): string | null {
  const doc = signerDoc(s);
  if (doc.length === 11 || doc.length === 14) return `doc:${doc}`;
  const email = normalize(s["email"]);
  if (email.includes("@")) return `email:${email}`;
  const name = normalize(s["name"]);
  if (name && name.split(" ").length >= 2) return `name:${name}`;
  return null;
}

function nameKeys(value: unknown): string[] {
  const n = normalize(value);
  if (!n) return [];
  const parts = n.split(" ").filter(Boolean);
  if (parts.length < 2) return [n];
  return [n, `${parts[0]} ${parts[parts.length - 1]}`];
}

/** Constrói a lista de candidatos a cadastro a partir dos contratos importados. */
export function buildCandidates(
  documents: DocRow[],
  owners: StakeRow[],
  providers: StakeRow[],
): ImportCandidate[] {
  const parsed = documents.map((d) => ({
    name: d.name ?? "Documento",
    signers: (Array.isArray(d.signers) ? d.signers : []) as Array<Record<string, unknown>>,
  }));
  const internal = buildInternalSignerSet(parsed.map((p) => ({ signers: p.signers })));

  const byKey = new Map<string, SignerCandidate>();
  for (const doc of parsed) {
    const signer = selectCounterpartSigner(doc.signers, doc.name, internal);
    if (!signer) continue;
    const key = fingerprintOf(signer);
    if (!key) continue;
    const d = signerDoc(signer);
    const prev = byKey.get(key);
    if (prev) {
      prev.documents += 1;
      prev.email ||= String(signer["email"] ?? "").trim();
      prev.phone ||= String(signer["phone_number"] ?? signer["phone"] ?? "").trim();
      continue;
    }
    byKey.set(key, {
      key,
      name: String(signer["name"] ?? "").trim() || "Sem nome",
      doc: d,
      docType: d.length === 14 ? "cnpj" : d.length === 11 ? "cpf" : null,
      email: String(signer["email"] ?? "").trim(),
      phone: String(signer["phone_number"] ?? signer["phone"] ?? "").trim(),
      documents: 1,
      sampleDocument: doc.name,
    });
  }

  // Índices da base atual para detectar duplicidade.
  const rows: Array<{ type: "owner" | "provider"; row: StakeRow }> = [
    ...owners.map((row) => ({ type: "owner" as const, row })),
    ...providers.map((row) => ({ type: "provider" as const, row })),
  ];

  return Array.from(byKey.values()).map((c) => {
    const matches: DuplicateMatch[] = [];
    const push = (type: "owner" | "provider", row: StakeRow, reason: DuplicateMatch["reason"]) => {
      if (matches.some((m) => m.id === row.id && m.type === type)) return;
      matches.push({
        type,
        id: row.id,
        label: row.trade_name?.trim() || row.name?.trim() || "Sem nome",
        email: row.email,
        doc: row.doc,
        reason,
      });
    };

    const cNames = new Set(nameKeys(c.name));
    for (const { type, row } of rows) {
      if (c.doc && onlyDigits(row.doc) === c.doc) push(type, row, "doc");
      else if (c.email && row.email && normalize(row.email) === normalize(c.email)) push(type, row, "email");
      else if ([...nameKeys(row.name), ...nameKeys(row.trade_name)].some((n) => cNames.has(n))) {
        push(type, row, "name");
      }
    }

    const strong = matches.some((m) => m.reason === "doc" || m.reason === "email");
    return {
      ...c,
      matches,
      status: strong ? "linked" : matches.length ? "duplicate" : "new",
      suggestedType: c.docType === "cnpj" ? "provider" : "owner",
    } satisfies ImportCandidate;
  });
}
