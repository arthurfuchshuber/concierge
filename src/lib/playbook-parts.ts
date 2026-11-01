/**
 * Campos COMPOSTOS do Dossiê (opção B aprovada, 01/11/2026): linhas que no guia do imóvel são vários campos
 * independentes (ex.: "Limpeza normal" e "Limpeza completa", cada uma com valor e duração) continuam sendo
 * campos separados na janela do Dossiê — um cartão por grupo, cada parte com o MESMO controle do guia.
 */
export type PartKind = "money" | "duration" | "time" | "bool" | "text";

export type PartDef = {
  id: string;
  label: string;
  column: string;
  kind: PartKind;
  /** Só aparece quando a parte indicada está ligada (ex.: apartamento só se for condomínio). */
  showWhen?: string;
  placeholder?: string;
};

export type PartGroup = { id: string; title: string; parts: PartDef[] };

export const PLAYBOOK_PARTS: Record<string, PartGroup[]> = {
  limpeza_operacional: [
    {
      id: "normal",
      title: "Limpeza normal",
      parts: [
        { id: "price_normal", label: "Valor", column: "cleaning_price_normal_cents", kind: "money" },
        { id: "dur_normal", label: "Duração", column: "cleaning_duration_normal_minutes", kind: "duration" },
      ],
    },
    {
      id: "full",
      title: "Limpeza completa",
      parts: [
        { id: "price_full", label: "Valor", column: "cleaning_price_full_cents", kind: "money" },
        { id: "dur_full", label: "Duração", column: "cleaning_duration_full_minutes", kind: "duration" },
      ],
    },
  ],
  horario_de_check_in: [
    {
      id: "checkin",
      title: "Horário de check-in",
      parts: [
        { id: "checkin_time", label: "A partir das", column: "checkin_time", kind: "time" },
        { id: "checkin_time_max", label: "Até as", column: "checkin_time_max", kind: "time" },
      ],
    },
  ],
  horario_de_check_out: [
    { id: "checkout", title: "Horário de check-out", parts: [{ id: "checkout_time", label: "Até as", column: "checkout_time", kind: "time" }] },
  ],
  imovel_em_condominio: [
    {
      id: "condo",
      title: "Imóvel em condomínio",
      parts: [
        { id: "in_condominium", label: "Condomínio", column: "in_condominium", kind: "bool" },
        { id: "apartment_number", label: "Apartamento", column: "apartment_number", kind: "text", showWhen: "in_condominium", placeholder: "Ex.: 302" },
        { id: "apartment_floor", label: "Andar", column: "apartment_floor", kind: "text", showWhen: "in_condominium", placeholder: "Ex.: 3º" },
      ],
    },
  ],
};

export const partsFor = (fieldKey: string): PartGroup[] | null => PLAYBOOK_PARTS[fieldKey] ?? null;

/** Duração em passos de 30 min (30min … 8h), igual ao guia. */
export const DURATION_OPTIONS = Array.from({ length: 16 }, (_, i) => {
  const minutes = (i + 1) * 30;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return { value: minutes, label: h === 0 ? `${m}min` : m === 0 ? `${h}h` : `${h}h${m}` };
});

/** Lê os valores atuais das partes a partir da linha do imóvel (tudo como texto). */
export function partsFromProperty(fieldKey: string, p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of PLAYBOOK_PARTS[fieldKey] ?? []) {
    for (const d of g.parts) {
      const v = p[d.column];
      out[d.id] = d.kind === "bool" ? (v === true ? "true" : "false") : v == null ? "" : String(v);
    }
  }
  return out;
}

/** Valida e converte as partes para as colunas do imóvel. Lança erro com mensagem amigável. */
export function partsToColumns(fieldKey: string, values: Record<string, string>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  const groups = PLAYBOOK_PARTS[fieldKey];
  if (!groups) throw new Error("Este campo não é editável aqui.");
  const defs = groups.flatMap((g) => g.parts);
  for (const d of defs) {
    const raw = (values[d.id] ?? "").trim();
    if (d.kind === "bool") out[d.column] = raw === "true";
    else if (d.kind === "money") {
      if (!raw) out[d.column] = null;
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new Error(`${d.label}: informe um valor válido.`);
        out[d.column] = n;
      }
    } else if (d.kind === "duration") {
      if (!raw) out[d.column] = null;
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 30 || n > 480 || n % 30 !== 0) throw new Error(`${d.label}: escolha de 30 min a 8 h.`);
        out[d.column] = n;
      }
    } else if (d.kind === "time") {
      if (raw && !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) throw new Error(`${d.label}: horário inválido.`);
      out[d.column] = raw || null;
    } else {
      if (raw.length > 40) throw new Error(`${d.label}: no máximo 40 caracteres.`);
      out[d.column] = raw || null;
    }
  }
  for (const d of defs) {
    if (d.showWhen && out[defs.find((x) => x.id === d.showWhen)!.column] !== true) out[d.column] = null;
  }
  return out;
}
