// Motor de vínculo compartilhado (server-only).
// Descobre a qual proprietário/prestador pertence um e-mail, documento ou nome
// vindo do Google Agenda ou do ClickSign — e aprende com os vínculos manuais.

export type StakeholderKind = "owner" | "provider";

export type StakeholderRef = {
  type: StakeholderKind;
  id: string;
  label: string;
  /** Como o vínculo foi encontrado — usado para mostrar confiança na UI. */
  via: "alias" | "doc" | "email" | "domain" | "phone" | "name";
};

export type StakeholderRow = {
  id: string;
  name: string | null;
  trade_name: string | null;
  email: string | null;
  doc: string | null;
  phone: string | null;
};

export type AliasRow = {
  alias_kind: "email" | "domain" | "doc" | "name";
  alias_value: string;
  stakeholder_type: StakeholderKind;
  stakeholder_id: string;
};

export function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function digits(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** Domínios genéricos nunca identificam uma empresa. */
const FREE_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.com.br",
  "icloud.com", "live.com", "bol.com.br", "uol.com.br", "terra.com.br",
  "me.com", "msn.com", "protonmail.com", "aol.com",
]);

export function emailDomain(email: string): string | null {
  const at = email.indexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).toLowerCase().trim();
  if (!d || FREE_DOMAINS.has(d)) return null;
  return d;
}

export type MatchIndex = {
  byAlias: Map<string, StakeholderRef>;
  byDoc: Map<string, StakeholderRef>;
  byEmail: Map<string, StakeholderRef>;
  byDomain: Map<string, StakeholderRef>;
  byPhone: Map<string, StakeholderRef>;
  byName: Map<string, StakeholderRef>;
};

function label(row: StakeholderRow): string {
  return (row.trade_name?.trim() || row.name?.trim() || "Sem nome");
}

function put(map: Map<string, StakeholderRef>, key: string, ref: StakeholderRef) {
  if (!key) return;
  // Chave ambígua (dois cadastros com o mesmo dado) não vale como vínculo.
  const prev = map.get(key);
  if (prev && (prev.id !== ref.id || prev.type !== ref.type)) {
    map.set(key, { ...prev, id: "__ambiguous__" });
    return;
  }
  map.set(key, ref);
}

export function buildMatchIndex(
  owners: StakeholderRow[],
  providers: StakeholderRow[],
  aliases: AliasRow[],
): MatchIndex {
  const idx: MatchIndex = {
    byAlias: new Map(), byDoc: new Map(), byEmail: new Map(),
    byDomain: new Map(), byPhone: new Map(), byName: new Map(),
  };

  const feed = (rows: StakeholderRow[], type: StakeholderKind) => {
    for (const r of rows) {
      const base = { type, id: r.id, label: label(r) };
      const d = digits(r.doc);
      if (d.length === 11 || d.length === 14) put(idx.byDoc, d, { ...base, via: "doc" });
      const email = norm(r.email);
      if (email.includes("@")) {
        put(idx.byEmail, email, { ...base, via: "email" });
        const dom = emailDomain(email);
        if (dom) put(idx.byDomain, dom, { ...base, via: "domain" });
      }
      const phone = digits(r.phone).slice(-11);
      if (phone.length >= 10) put(idx.byPhone, phone, { ...base, via: "phone" });
      for (const n of [r.name, r.trade_name]) {
        const nn = norm(n);
        if (nn && nn.split(" ").length >= 2) put(idx.byName, nn, { ...base, via: "name" });
      }
    }
  };
  feed(owners, "owner");
  feed(providers, "provider");

  const nameOf = (type: StakeholderKind, id: string) => {
    const row = (type === "owner" ? owners : providers).find((r) => r.id === id);
    return row ? label(row) : "Vínculo manual";
  };
  for (const a of aliases) {
    idx.byAlias.set(`${a.alias_kind}:${a.alias_value}`, {
      type: a.stakeholder_type,
      id: a.stakeholder_id,
      label: nameOf(a.stakeholder_type, a.stakeholder_id),
      via: "alias",
    });
  }
  return idx;
}

function valid(ref: StakeholderRef | undefined): StakeholderRef | null {
  if (!ref || ref.id === "__ambiguous__") return null;
  return ref;
}

/**
 * Resolve o vínculo a partir dos sinais de um evento/documento.
 * Ordem de confiança: vínculo manual aprendido → CPF/CNPJ → e-mail →
 * telefone → domínio corporativo → nome completo no título.
 */
export function resolveStakeholder(
  idx: MatchIndex,
  signals: { emails?: string[]; docs?: string[]; phones?: string[]; texts?: string[] },
): StakeholderRef | null {
  const emails = (signals.emails ?? []).map(norm).filter((e) => e.includes("@"));
  const docs = (signals.docs ?? []).map(digits).filter((d) => d.length === 11 || d.length === 14);
  const phones = (signals.phones ?? []).map((p) => digits(p).slice(-11)).filter((p) => p.length >= 10);
  const texts = (signals.texts ?? []).map(norm).filter(Boolean);

  for (const d of docs) {
    const hit = valid(idx.byAlias.get(`doc:${d}`)) ?? valid(idx.byDoc.get(d));
    if (hit) return hit;
  }
  for (const e of emails) {
    const hit = valid(idx.byAlias.get(`email:${e}`)) ?? valid(idx.byEmail.get(e));
    if (hit) return hit;
  }
  for (const p of phones) {
    const hit = valid(idx.byPhone.get(p));
    if (hit) return hit;
  }
  for (const e of emails) {
    const dom = emailDomain(e);
    if (!dom) continue;
    const hit = valid(idx.byAlias.get(`domain:${dom}`)) ?? valid(idx.byDomain.get(dom));
    if (hit) return hit;
  }
  for (const t of texts) {
    const hit = valid(idx.byAlias.get(`name:${t}`));
    if (hit) return hit;
    for (const [name, ref] of idx.byName) {
      if (t === name || t.includes(name)) {
        const ok = valid(ref);
        if (ok) return ok;
      }
    }
  }
  return null;
}
