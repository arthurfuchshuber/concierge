/**
 * PLAYBOOK — EDIÇÃO EM MASSA / REPLICAÇÃO (política de segurança, pura e testável).
 *
 * O que pode ser copiado entre imóveis da mesma conta é uma LISTA BRANCA: regras da casa e
 * convivência, FAQ geral, instruções padronizadas de check-in/check-out, checklist de saída,
 * descarte de lixo e as notas/linhas criadas à mão (bairro, cidade, governança).
 * Tudo que NÃO está na lista branca é recusado — inclusive campos que ainda nem existem.
 *
 * Nunca replicável (recusado no backend, não só escondido na tela): senhas de Wi-Fi, códigos de
 * fechadura/portão/cofre, endereço/CEP/coordenadas, IDs de integração, fotos e a
 * estrutura física (quartos, camas, banheiros, capacidade).
 */

/** Campos do Playbook (f:<campo>) que podem ser replicados. */
export const BULK_REPLICABLE_FIELDS: ReadonlySet<string> = new Set([
  "regras_adicionais_da_casa",
  "instrucoes_de_check_in",
  "aviso_de_check_in",
  "instrucoes_de_check_out",
  "aviso_de_check_out",
  "checklist_de_saida",
  "descarte_de_lixo",
]);

/** Campos que gravam coluna de `properties` (subconjunto da lista branca). */
export const BULK_COLUMN_FIELDS: Readonly<Record<string, string>> = {
  regras_adicionais_da_casa: "house_rules",
  instrucoes_de_check_in: "checkin_instructions",
  aviso_de_check_in: "checkin_note",
  instrucoes_de_check_out: "checkout_instructions",
  aviso_de_check_out: "checkout_note",
};

/** Motivos legíveis para o que é bloqueado de propósito (mensagem útil ao usuário). */
const BLOCKED_REASON: Array<[RegExp, string]> = [
  [/wi_?fi|senha|password|fechadura|portao|cofre|codigo|bateria/, "credenciais e códigos de acesso são exclusivos de cada imóvel"],
  [/cep|bairro|endereco|link_do_mapa|lat|lng|coorden|gps|complemento|apartamento|andar/, "endereço e localização são exclusivos de cada imóvel"],
  [/airbnb|channex|listing|room_?type|ical/, "IDs de integração são exclusivos de cada imóvel"],
  [/foto|galeria|planta|capa|cover|image/, "fotos e plantas são exclusivas de cada imóvel"],
  [/quarto|cama|banheiro|capacidade|hospede|veiculo|vaga|garagem/, "estrutura física e capacidade são exclusivas de cada imóvel"],
];

/** Texto sensível em rótulo/chave de linha criada à mão (não dá para confiar só no nome). */
const SENSITIVE_LABEL =
  /senha|password|wi-?fi|fechadura|cofre|c[oó]digo\b|endere[cç]o|\bcep\b|latitude|longitude|coordenad|\bgps\b|listing|channex|room.?type|capacidade|planta|\bfoto/i;

/** Valor com cara de segredo ou localização exata. */
const SENSITIVE_VALUE: Array<[RegExp, string]> = [
  [/(?:senha|password|c[oó]digo\s+(?:da|do|de)\s+(?:porta|fechadura|port[aã]o|cofre))\b[^\n:=]{0,30}[:=]\s*\S+/i, "o texto parece conter uma senha ou código de acesso"],
  [/-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/, "o texto parece conter coordenadas GPS"],
  [/\b\d{5}-\d{3}\b/, "o texto parece conter um CEP"],
];

const norm = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type BulkRowClass =
  | { ok: true; kind: "column" | "list" | "entry" | "faq" | "custom"; key: string }
  | { ok: false; reason: string };

/** Classifica a linha de origem e diz se pode ser replicada. */
export function classifyBulkRow(rowId: string): BulkRowClass {
  const [kind, ...rest] = rowId.split(":");
  const key = rest.join(":");
  if (kind === "f") {
    if (BULK_REPLICABLE_FIELDS.has(key)) {
      return { ok: true, kind: BULK_COLUMN_FIELDS[key] ? "column" : key === "checklist_de_saida" ? "list" : "entry", key };
    }
    const n = norm(key);
    const why = BLOCKED_REASON.find(([re]) => re.test(n))?.[1] ?? "este campo não está na lista de campos replicáveis";
    return { ok: false, reason: `Campo bloqueado para edição em massa: ${why}.` };
  }
  if (kind === "faq" && /^[0-9a-f-]{36}$/i.test(key)) return { ok: true, kind: "faq", key };
  if (kind === "custom" && /^[0-9a-f-]{36}$/i.test(key)) return { ok: true, kind: "custom", key };
  if (kind === "prov") return { ok: false, reason: "Campo bloqueado para edição em massa: prestadores têm telefone e dados de cada imóvel." };
  return { ok: false, reason: "Campo bloqueado para edição em massa: este tipo de linha não é replicável." };
}

/** Recusa rótulo ou valor que pareçam dado sensível (vale também para notas digitadas). */
export function assertBulkContentSafe(label: string | null | undefined, value: string | null | undefined): void {
  if (label && SENSITIVE_LABEL.test(label)) {
    throw new Error("Bloqueado para edição em massa: o título sugere um dado sensível ou exclusivo do imóvel (senha, código, endereço, capacidade…).");
  }
  for (const [re, why] of SENSITIVE_VALUE) {
    if (value && re.test(value)) throw new Error(`Bloqueado para edição em massa: ${why}.`);
  }
}

/** Mesma linha em outro imóvel = mesmo título (sem acento/caixa) na mesma seção. */
export function sameCustomRow(
  a: { custom_label: string | null; section_num: number | null },
  b: { custom_label: string | null; section_num: number | null },
): boolean {
  return norm((a.custom_label ?? "").trim()) === norm((b.custom_label ?? "").trim()) && (a.section_num ?? 5) === (b.section_num ?? 5);
}
