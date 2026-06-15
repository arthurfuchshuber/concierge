// Build default FAQ entries from a property's filled fields.
// A question is only generated when its source data is present —
// matches the core rule: empty = hide.

export type DefaultFaqTag = "chegada" | "saida" | "residencia" | "explore";

export type DefaultFaqInput = {
  checkin_time?: string | null;
  checkin_time_max?: string | null;
  checkout_time?: string | null;
  checkout_time_min?: string | null;
  address?: string | null;
  maps_url?: string | null;
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  gate_code?: string | null;
  lock_code?: string | null;
  host_name?: string | null;
  host_phone?: string | null;
  checkin_instructions?: string | null;
  checkout_instructions?: string | null;
};

export type DefaultFaqItem = {
  question: string;
  answer: string;
  tags: DefaultFaqTag[];
};

const t = (v?: string | null) => (typeof v === "string" ? v.trim() : "");

export function buildDefaultFaqs(p: DefaultFaqInput): DefaultFaqItem[] {
  const out: DefaultFaqItem[] = [];

  // Check-in time
  const ciMin = t(p.checkin_time);
  const ciMax = t(p.checkin_time_max);
  if (ciMin || ciMax) {
    out.push({
      question: "Qual é o horário de check-in?",
      answer:
        ciMin && ciMax
          ? `O check-in pode ser feito entre ${ciMin} e ${ciMax}.`
          : ciMin
          ? `O check-in está disponível a partir das ${ciMin}.`
          : `O check-in pode ser feito até as ${ciMax}.`,
      tags: ["chegada"],
    });
  }

  // Check-out time
  const coMax = t(p.checkout_time);
  const coMin = t(p.checkout_time_min);
  if (coMax || coMin) {
    out.push({
      question: "Qual é o horário de check-out?",
      answer:
        coMin && coMax
          ? `O check-out deve ser feito entre ${coMin} e ${coMax}.`
          : coMax
          ? `O check-out deve ser feito até as ${coMax}.`
          : `O check-out está disponível a partir das ${coMin}.`,
      tags: ["saida"],
    });
  }

  // Address + Maps
  const addr = t(p.address);
  const maps = t(p.maps_url);
  if (addr || maps) {
    const parts: string[] = [];
    if (addr) parts.push(addr);
    if (maps) parts.push(`Localização no Maps: ${maps}`);
    out.push({
      question: "Qual é o endereço da residência?",
      answer: parts.join("\n"),
      tags: ["chegada"],
    });
  }

  // Wi-Fi
  const ssid = t(p.wifi_ssid);
  const pass = t(p.wifi_password);
  if (ssid || pass) {
    const lines: string[] = [];
    if (ssid) lines.push(`Rede: ${ssid}`);
    if (pass) lines.push(`Senha: ${pass}`);
    out.push({
      question: "Qual é a senha do Wi-Fi?",
      answer: lines.join("\n"),
      tags: ["residencia"],
    });
  }

  // Gate code
  const gate = t(p.gate_code);
  if (gate) {
    out.push({
      question: "Qual é o código do portão?",
      answer: `O código do portão é ${gate}.`,
      tags: ["chegada"],
    });
  }

  // Lock code
  const lock = t(p.lock_code);
  if (lock) {
    out.push({
      question: "Qual é o código da fechadura?",
      answer: `O código da fechadura é ${lock}.`,
      tags: ["chegada"],
    });
  }

  // Host contact
  const hostName = t(p.host_name);
  const hostPhone = t(p.host_phone);
  if (hostPhone || hostName) {
    const who = hostName || "o anfitrião";
    out.push({
      question: "Como entrar em contato com o anfitrião?",
      answer: hostPhone
        ? `Você pode falar com ${who} pelo telefone/WhatsApp: ${hostPhone}.`
        : `Em caso de dúvidas, fale com ${who}.`,
      tags: ["residencia"],
    });
  }

  // Check-in instructions
  const ciInstr = t(p.checkin_instructions);
  if (ciInstr) {
    out.push({
      question: "Como faço o check-in?",
      answer: ciInstr,
      tags: ["chegada"],
    });
  }

  // Check-out instructions
  const coInstr = t(p.checkout_instructions);
  if (coInstr) {
    out.push({
      question: "O que devo fazer no check-out?",
      answer: coInstr,
      tags: ["saida"],
    });
  }

  return out;
}

// Merge new defaults into an existing FAQ list, skipping duplicates by question.
export function mergeDefaultFaqs<T extends { question: string; answer: string; tags: DefaultFaqTag[] }>(
  existing: T[],
  defaults: DefaultFaqItem[],
): { merged: T[]; added: number } {
  const seen = new Set(existing.map((f) => f.question.trim().toLowerCase()));
  const additions: T[] = [];
  for (const d of defaults) {
    const key = d.question.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push(d as unknown as T);
  }
  return { merged: [...existing, ...additions], added: additions.length };
}
