/**
 * Transporte do Google Maps para as ferramentas da IA Guest — o ÚNICO ponto de rede de `guest-ai/tools/`.
 *
 * Usa o mesmo conector do Google Maps que o restante do SaaS (gateway do Lovable, com a chave
 * `GOOGLE_MAPS_API_KEY` existente no ambiente). Segurança:
 *  - as chaves só vão nos cabeçalhos; nunca em log, erro ou resultado;
 *  - o corpo de respostas de erro nunca é lido (só o status);
 *  - sem cache: "aberto agora" e rotas precisam ser do momento da consulta;
 *  - todo pedido carrega o `signal` (o executor corta em 6 s).
 */
import type { MapsHttp } from "./contracts";

export const MAPS_GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev/google_maps";

/** Chave do Maps (mesma ordem de leitura do resto do SaaS). `null` ⇒ ferramenta indisponível. */
function mapsKey(): string | null {
  const v =
    process.env["GOOGLE_MAPS_API_KEY_1"] ??
    process.env["GOOGLE_MAPS_API_KEY_2"] ??
    process.env["GOOGLE_MAPS_API_KEY"];
  return typeof v === "string" && v ? v : null;
}

export class MapsConfigMissing extends Error {
  constructor() {
    super("maps_config_missing");
    this.name = "MapsConfigMissing";
  }
}

/** Transporte de produção. Lança `MapsConfigMissing` sem chave (o executor converte em `indisponivel`). */
export const productionMapsHttp: MapsHttp = async (path, init) => {
  const apiKey = process.env["LOVABLE_API_KEY"];
  const key = mapsKey();
  if (!apiKey || !key) throw new MapsConfigMissing();
  const headers: Record<string, string> = {
    ...(init.headers ?? {}),
    Authorization: `Bearer ${apiKey}`,
    "X-Connection-Api-Key": key,
  };
  const res = await fetch(`${MAPS_GATEWAY_BASE_URL}${path}`, {
    method: init.method,
    headers,
    body: init.body,
    signal: init.signal,
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, status: res.status, json: async () => null };
  }
  return { ok: true, status: res.status, json: () => res.json() as Promise<unknown> };
};
