import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Valida CPF/CNPJ. Para CNPJ, consulta a Receita Federal via BrasilAPI
// (endpoint público que espelha dados oficiais). Para CPF, a Receita não
// expõe consulta pública — validamos apenas os dígitos verificadores
// oficiais (algoritmo da própria RF).

function onlyDigits(v: string) {
  return (v ?? "").replace(/\D+/g, "");
}

function isValidCPFDigits(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (base: string, factor: number) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (factor - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return (
    calc(d.slice(0, 9), 10) === Number(d[9]) &&
    calc(d.slice(0, 10), 11) === Number(d[10])
  );
}

function isValidCNPJDigits(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
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
  return (
    calc(d.slice(0, 12)) === Number(d[12]) &&
    calc(d.slice(0, 13)) === Number(d[13])
  );
}

export type TaxIdCheck = {
  ok: boolean;
  kind: "cpf" | "cnpj";
  digits: string;
  formatted: string;
  name?: string | null;
  status?: string | null;
  error?: string;
};

export const validateTaxId = createServerFn({ method: "POST" })
  .inputValidator((data: { value: string }) => data)
  .handler(async ({ data }): Promise<TaxIdCheck> => {
    const d = onlyDigits(data.value);
    const kind: "cpf" | "cnpj" = d.length > 11 ? "cnpj" : "cpf";

    if (kind === "cpf") {
      const formatted = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
      if (!isValidCPFDigits(d)) {
        return { ok: false, kind, digits: d, formatted, error: "CPF inválido." };
      }
      // Receita Federal não expõe consulta pública de CPF. Validamos os
      // dígitos verificadores oficiais — mesmo algoritmo da RF.
      return { ok: true, kind, digits: d, formatted };
    }

    const formatted = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
    if (!isValidCNPJDigits(d)) {
      return { ok: false, kind, digits: d, formatted, error: "CNPJ inválido." };
    }

    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, {
        headers: { accept: "application/json" },
      });
      if (res.status === 404) {
        return { ok: false, kind, digits: d, formatted, error: "CNPJ não encontrado na Receita Federal." };
      }
      if (!res.ok) {
        // Falha do provedor — não bloqueia (dígitos já são válidos).
        return { ok: true, kind, digits: d, formatted };
      }
      const json: any = await res.json();
      const situacao: string = String(json?.descricao_situacao_cadastral ?? json?.situacao ?? "").toUpperCase();
      const name: string | null = json?.razao_social ?? json?.nome_fantasia ?? null;
      if (situacao && situacao !== "ATIVA") {
        return {
          ok: false,
          kind,
          digits: d,
          formatted,
          name,
          status: situacao,
          error: `CNPJ encontrado, mas a situação cadastral é "${situacao}". Só é possível prosseguir com CNPJ ATIVO.`,
        };
      }
      return { ok: true, kind, digits: d, formatted, name, status: situacao || "ATIVA" };
    } catch {
      // Rede indisponível — não bloqueia checkout se dígitos batem.
      return { ok: true, kind, digits: d, formatted };
    }
  });
