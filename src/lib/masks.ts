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

// CNPJ: 00.000.000/0000-00
export function formatCNPJ(v: string | null | undefined): string {
  const d = onlyDigits(v).slice(0, 14);
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);
  let out = p1;
  if (p2) out += "." + p2;
  if (p3) out += "." + p3;
  if (p4) out += "/" + p4;
  if (p5) out += "-" + p5;
  return out;
}

export function isValidCNPJ(v: string | null | undefined): boolean {
  const d = onlyDigits(v);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string) => {
    const weights =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calc(d.slice(0, 12));
  const d2 = calc(d.slice(0, 13));
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

// Formata CPF ou CNPJ automaticamente pelo comprimento.
export function formatTaxId(v: string | null | undefined): string {
  const d = onlyDigits(v);
  return d.length > 11 ? formatCNPJ(d) : formatCPF(d);
}

// BR mobile phone: (11) 91234-5678 — legado, mantido para compat.
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

// International phone helpers — powered by libphonenumber-js.
// Aceitam telefones de qualquer país.
import {
  parsePhoneNumberFromString,
  isValidPhoneNumber as _isValidIntl,
  type CountryCode,
} from "libphonenumber-js";

function toIso2(country: string | null | undefined): CountryCode | undefined {
  if (!country) return undefined;
  const c = String(country).trim().toUpperCase().replace(/^\+/, "");
  if (/^[A-Z]{2}$/.test(c)) return c as CountryCode;
  const map: Record<string, CountryCode> = {
    "1": "US", "44": "GB", "55": "BR", "351": "PT", "34": "ES", "33": "FR",
    "49": "DE", "39": "IT", "52": "MX", "54": "AR", "56": "CL", "57": "CO",
    "58": "VE", "51": "PE", "598": "UY", "595": "PY", "591": "BO", "593": "EC",
    "81": "JP", "82": "KR", "86": "CN", "91": "IN", "61": "AU", "64": "NZ",
    "27": "ZA", "20": "EG", "212": "MA", "234": "NG",
  };
  return map[c.replace(/^0+/, "")];
}

function parseAny(phone: string, country?: string | null) {
  const raw = phone.trim();
  if (raw.startsWith("+")) return parsePhoneNumberFromString(raw);
  const iso = toIso2(country);
  if (iso) return parsePhoneNumberFromString(raw, iso);
  return parsePhoneNumberFromString(`+${onlyDigits(raw)}`);
}

// E.164 ("+5511987654321") ou "" se inválido/vazio.
export function toE164(phone: string | null | undefined, country?: string | null): string {
  const raw = (phone ?? "").toString().trim();
  if (!raw) return "";
  return parseAny(raw, country)?.number ?? "";
}

// Formato humano internacional: "+55 11 98765-4321".
export function formatIntlPhone(phone: string | null | undefined, country?: string | null): string {
  const raw = (phone ?? "").toString().trim();
  if (!raw) return "";
  const p = parseAny(raw, country);
  return p ? p.formatInternational() : raw;
}

// wa.me exige apenas dígitos, sem "+".
export function toWhatsappNumber(phone: string | null | undefined, country?: string | null): string {
  return toE164(phone, country).replace(/\D+/g, "");
}

export function isValidIntlPhone(phone: string | null | undefined, country?: string | null): boolean {
  const raw = (phone ?? "").toString().trim();
  if (!raw) return false;
  if (raw.startsWith("+")) return _isValidIntl(raw);
  const iso = toIso2(country);
  return iso ? _isValidIntl(raw, iso) : _isValidIntl(`+${onlyDigits(raw)}`);
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
