/**
 * TOOL CALLING da ConciergeIA Guest — contrato comum das ferramentas de CONSULTA (07/11/2026).
 *
 * Esteira extensível: toda ferramenta (lugares, rotas e, no futuro, clima, voos, visão) segue o mesmo
 * contrato — schema JSON para o modelo, validação dos argumentos, execução com prazo e resultado em JSON.
 *
 * Invariantes (iguais para qualquer ferramenta nova):
 *  - Só CONSULTA: nenhuma ferramenta escreve no banco, envia mensagem, altera reserva, card ou chamado.
 *  - Nunca lê nem devolve credenciais: o contexto da ferramenta (`GuestToolContext`) só tem a origem
 *    geográfica do imóvel e a cidade; a política D9 não passa por aqui.
 *  - Argumentos vêm do modelo ⇒ são DADO NÃO CONFIÁVEL: `parse` valida tudo e recusa o resto.
 *  - Falha, prazo ou dado incompleto ⇒ resultado `{ ok: false }`; o turno nunca quebra por causa disso.
 *  - Resultado nunca traz tempo de deslocamento (regra permanente: tempo só se o hóspede insistir, e o
 *    sistema não tem como estimá-lo com segurança).
 */
import type { LlmToolSpec } from "@/lib/guest-ai/llm/contracts";

/** Origem e localidade do imóvel do turno (derivadas do turno validado, nunca do modelo). */
export interface GuestToolContext {
  /** Coordenadas do imóvel (cadastro). `null` ⇒ sem origem: rotas indisponíveis. */
  origin: { lat: number; lng: number } | null;
  city: string | null;
  region: string | null;
  country: string | null;
  /** Canal do turno (o Airbnb não recebe links). */
  surface: "airbnb" | "whatsapp" | "guide_chat";
}

/** Transporte HTTP injetável (produção: gateway do Google Maps; testes: falso, sem rede). */
export type MapsHttp = (
  path: string,
  init: {
    method: "GET" | "POST";
    body?: string;
    headers?: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface ToolExecDeps {
  http: MapsHttp;
  signal: AbortSignal;
}

/** Resultado de uma ferramenta: JSON serializável. `ok: false` traz só um código fixo. */
export type ToolResult = { ok: true; [k: string]: unknown } | { ok: false; erro: ToolErrorCode };

export const TOOL_ERROR_CODES = [
  "argumentos_invalidos",
  "ferramenta_desconhecida",
  "sem_origem",
  "sem_resultado",
  "sem_rota",
  "indisponivel",
  "tempo_esgotado",
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export interface GuestTool<A> {
  readonly spec: LlmToolSpec;
  /** Valida os argumentos crus do modelo. `null` ⇒ `argumentos_invalidos`. */
  parse(raw: unknown): A | null;
  execute(args: A, ctx: GuestToolContext, deps: ToolExecDeps): Promise<ToolResult>;
}

/** Prazo máximo de cada ferramenta (diretriz: 6 s). */
export const TOOL_TIMEOUT_MS = 6_000;
/** Teto do JSON de cada resultado levado de volta ao modelo (protege o orçamento do turno). */
export const TOOL_RESULT_MAX_CHARS = 3_000;
