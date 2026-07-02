// Small shared helpers for input masking and display normalization.
// Kept UI-agnostic so both admin dialogs and guest gate can reuse.

export function onlyDigits(v: string | null | undefined): string {
  return (v ?? "").replace(/\D+/g, "");
}

// CPF: 000.000.000-00
export function formatCPF(v: string | null | undefined): string {
  const d = onlyDigits(v).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  let out = p1;
  if (p2) out += "." + p2;
  if (p3) out += "." + p3;
  if (p4) out += "-" + p4;
  return out;
}

export function isValidCPF(v: string | null | undefined): boolean {
  const d = onlyDigits(v);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const calc = (base: string, factor: number) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (factor - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = calc(d.slice(0, 9), 10);
  const d2 = calc(d.slice(0, 10), 11);
  return d1 === Number(d[9]) && d2 === Number(d[10]);
}

// BR mobile phone: (11) 91234-5678
export function formatBRPhone(v: string | null | undefined): string {
  const d = onlyDigits(v).slice(0, 11);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

export function isValidBRMobile(v: string | null | undefined): boolean {
  const d = onlyDigits(v);
  return d.length === 10 || d.length === 11;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmail(v: string | null | undefined): boolean {
  return EMAIL_RE.test((v ?? "").trim());
}

// Title Case ("john van der berg" -> "John van der Berg" simplified to "John Van Der Berg";
// keeps small connectors lowercase when in the middle of the name).
const CONNECTORS = new Set(["da", "de", "do", "das", "dos", "e", "van", "von", "di", "del"]);
export function titleCaseName(v: string | null | undefined): string {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return "";
  return s
    .split(/\s+/)
    .map((word, idx) => {
      if (idx > 0 && CONNECTORS.has(word)) return word;
      return word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1);
    })
    .join(" ");
}
