/**
 * Enriquecimento de endereço a partir de fontes públicas confiáveis.
 *
 * Regra do projeto: campos que podem ser conferidos online (CEP, endereço,
 * cidade/UF) NÃO devem ficar vazios quando é possível descobri-los. Aqui a
 * ordem de confiança é:
 *   1. BrasilAPI /cep (Correios/open-cep) — fonte oficial para CEP brasileiro;
 *   2. Nominatim (OpenStreetMap) — busca textual do endereço, usada quando não
 *      há CEP válido ou quando o CEP não resolveu.
 *
 * Nunca sobrescreve valor já preenchido pelo usuário: só completa o que falta.
 */

type Addr = {
  cep?: string | null;
  address?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
};

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const blank = (v: unknown) => !String(v ?? "").trim();

async function fromCep(cep: string): Promise<{ city?: string; state?: string; district?: string; street?: string } | null> {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    return {
      city: j["city"] ? String(j["city"]) : undefined,
      state: j["state"] ? String(j["state"]) : undefined,
      district: j["neighborhood"] ? String(j["neighborhood"]) : undefined,
      street: j["street"] ? String(j["street"]) : undefined,
    };
  } catch {
    return null;
  }
}

const UF_BY_NAME: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapá: "AP", amazonas: "AM", bahia: "BA", ceará: "CE",
  "distrito federal": "DF", "espírito santo": "ES", goiás: "GO", maranhão: "MA",
  "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", pará: "PA",
  paraíba: "PB", paraná: "PR", pernambuco: "PE", piauí: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondônia: "RO", roraima: "RR",
  "santa catarina": "SC", "são paulo": "SP", sergipe: "SE", tocantins: "TO",
};

async function fromNominatim(query: string): Promise<{ city?: string; state?: string } | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "1");
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "AnfitriaoSigma/1.0 (address-validation)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<Record<string, unknown>>;
    const a = (arr?.[0]?.["address"] ?? null) as Record<string, unknown> | null;
    if (!a) return null;
    const city = [a["city"], a["town"], a["village"], a["municipality"]].find(Boolean);
    const stateName = a["state"] ? String(a["state"]) : "";
    const uf = a["ISO3166-2-lvl4"]
      ? String(a["ISO3166-2-lvl4"]).split("-")[1]
      : UF_BY_NAME[stateName.toLowerCase()];
    return { city: city ? String(city) : undefined, state: uf };
  } catch {
    return null;
  }
}

/**
 * Completa cidade/UF (e bairro, quando vazio) consultando fontes online.
 * Retorna apenas os campos que estavam faltando.
 */
export async function enrichAddress(input: Addr): Promise<Partial<Addr>> {
  const out: Partial<Addr> = {};
  const needsCity = blank(input.city);
  const needsState = blank(input.state);
  if (!needsCity && !needsState) return out;

  const cep = digits(input.cep);
  if (cep.length === 8) {
    const r = await fromCep(cep);
    if (r) {
      if (needsCity && r.city) out.city = r.city;
      if (needsState && r.state) out.state = r.state;
      if (blank(input.district) && r.district) out.district = r.district;
    }
  }

  if ((needsCity && !out.city) || (needsState && !out.state)) {
    const q = [input.address, input.district, input.city, input.state, cep ? `CEP ${cep}` : "", "Brasil"]
      .filter((v) => !blank(v))
      .join(", ");
    if (q.replace(/Brasil/, "").trim().length > 4) {
      const r = await fromNominatim(q);
      if (r) {
        if (needsCity && !out.city && r.city) out.city = r.city;
        if (needsState && !out.state && r.state) out.state = r.state;
      }
    }
  }

  return out;
}
