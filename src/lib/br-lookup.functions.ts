import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Consulta pública de CNPJ na Receita Federal (via BrasilAPI) para
// preenchimento automático dos cadastros de Proprietários e Prestadores.

export type CnpjLookup = {
  ok: boolean;
  error?: string;
  data?: {
    razao_social: string;
    nome_fantasia: string;
    telefone: string;
    email: string;
    logradouro: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
    situacao: string;
  };
};

export const lookupCnpj = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ cnpj: z.string().trim().max(20) }).parse(i))
  .handler(async ({ data }): Promise<CnpjLookup> => {
    const d = data.cnpj.replace(/\D/g, "");
    if (d.length !== 14) return { ok: false, error: "CNPJ incompleto." };
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, {
        headers: { accept: "application/json" },
      });
      if (res.status === 404) return { ok: false, error: "CNPJ não encontrado na Receita Federal." };
      if (!res.ok) return { ok: false, error: "Não foi possível consultar a Receita Federal agora." };
      const j = (await res.json()) as Record<string, unknown>;
      const str = (v: unknown) => (v == null ? "" : String(v));
      const situacao = str(j["descricao_situacao_cadastral"] ?? j["situacao"]).toUpperCase();
      const ddd = str(j["ddd_telefone_1"]).replace(/\D/g, "");
      return {
        ok: true,
        data: {
          razao_social: str(j["razao_social"]),
          nome_fantasia: str(j["nome_fantasia"]),
          telefone: ddd,
          email: str(j["email"]),
          logradouro: [str(j["descricao_tipo_de_logradouro"]), str(j["logradouro"]), str(j["numero"])]
            .filter(Boolean)
            .join(" ")
            .trim(),
          bairro: str(j["bairro"]),
          cidade: str(j["municipio"]),
          estado: str(j["uf"]),
          cep: str(j["cep"]).replace(/\D/g, ""),
          situacao: situacao || "ATIVA",
        },
      };
    } catch {
      return { ok: false, error: "Falha de rede ao consultar a Receita Federal." };
    }
  });
