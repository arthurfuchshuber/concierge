import type { FocusHttpResult, QueryResult, ResponseClass } from "../types";

export const FOCUS_BASE_URL = {
  homologation: "https://homologacao.focusnfe.com.br",
  production: "https://api.focusnfe.com.br",
} as const;

export type FocusEnvironment = keyof typeof FOCUS_BASE_URL;
export type FocusDocumentPath = "nfe" | "nfse" | "nfsen" | "cte";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

/** Erro de transporte: o pedido PODE ter chegado ao provedor. Nunca é tratado como falha definitiva. */
export class FocusTransportError extends Error {
  constructor(readonly reason: "timeout" | "connection_lost", message: string) {
    super(message);
    this.name = "FocusTransportError";
  }
}

export interface FocusClientOptions {
  environment: FocusEnvironment;
  token: string;
  fetch: FetchLike;
  timeoutMs?: number;
}

/** Cabeçalho Basic: token como usuário, senha vazia (documentação pública da Focus). */
export function basicAuth(token: string): string {
  return `Basic ${Buffer.from(`${token}:`).toString("base64")}`;
}

/** Remove qualquer ocorrência do token de mensagens/erros antes de logar ou persistir. */
export function redactSecret(text: string, token: string): string {
  if (!token) return text;
  return text.split(token).join("[redacted]").split(Buffer.from(`${token}:`).toString("base64")).join("[redacted]");
}

/**
 * Classifica a resposta de ENVIO. Lista de 4xx definitivos começa vazia (v4.4 AR-09):
 * 2xx = accepted (handoff; NÃO autoriza o documento), 5xx/429 = inconclusive (o servidor pode ter processado),
 * demais = unsupported até mapeamento confirmado na homologação real.
 */
export function classifySend(status: number): ResponseClass {
  if (status >= 200 && status < 300) return "accepted";
  if (status === 429 || status >= 500) return "inconclusive";
  return "unsupported";
}

/** Mapeia `status` da consulta (valores a confirmar na homologação). Desconhecido => "unmapped" (nunca autoriza). */
export function mapQueryStatus(httpStatus: number, body: unknown): { result: QueryResult; providerStatus: string | null; protocol: string | null; accessKey: string | null } {
  if (httpStatus === 404) return { result: "absent", providerStatus: null, protocol: null, accessKey: null };
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const st = typeof b.status === "string" ? b.status : null;
  const protocol = typeof b.protocolo === "string" && b.protocolo ? b.protocolo : typeof b.numero_protocolo === "string" && b.numero_protocolo ? b.numero_protocolo : null;
  const accessKey = typeof b.chave_nfe === "string" ? b.chave_nfe : typeof b.chave === "string" ? b.chave : null;
  if (httpStatus < 200 || httpStatus >= 300 || !st) return { result: "unmapped", providerStatus: st, protocol: null, accessKey: null };
  switch (st) {
    case "autorizado": return protocol ? { result: "authorized", providerStatus: st, protocol, accessKey } : { result: "unmapped", providerStatus: st, protocol: null, accessKey };
    case "erro_autorizacao": case "rejeitado": return { result: "rejected", providerStatus: st, protocol: null, accessKey: null };
    case "processando_autorizacao": return { result: "processing", providerStatus: st, protocol: null, accessKey: null };
    case "cancelado": return { result: "cancelled", providerStatus: st, protocol, accessKey };
    default: return { result: "unmapped", providerStatus: st, protocol: null, accessKey: null };
  }
}

export class FocusClient {
  private readonly base: string;
  constructor(private readonly opts: FocusClientOptions) {
    if (!opts.token) throw new Error("focus_token_required");
    this.base = FOCUS_BASE_URL[opts.environment];
  }

  private async call(method: string, pathAndQuery: string, body?: unknown): Promise<FocusHttpResult> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 30_000);
    try {
      const res = await this.opts.fetch(`${this.base}${pathAndQuery}`, {
        method,
        headers: { Authorization: basicAuth(this.opts.token), Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* corpo não-JSON preservado como texto */ }
      return { status: res.status, body: parsed };
    } catch (e) {
      const aborted = (e as { name?: string })?.name === "AbortError";
      throw new FocusTransportError(aborted ? "timeout" : "connection_lost", redactSecret(String((e as Error)?.message ?? e), this.opts.token));
    } finally {
      clearTimeout(timer);
    }
  }

  /** S3: envio da emissão. A ref vai na query string (documentação pública). */
  issue(kind: FocusDocumentPath, ref: string, payload: unknown) { return this.call("POST", `/v2/${kind}?ref=${encodeURIComponent(ref)}`, payload); }
  /** Consulta: a única fonte que muda o estado fiscal do documento. */
  query(kind: FocusDocumentPath, ref: string) { return this.call("GET", `/v2/${kind}/${encodeURIComponent(ref)}`); }
  /**
   * Empresas API (POST /v2/empresas). O corpo carrega o certificado A1 em memória e SÓ aqui: nada é persistido.
   * Documentação pública: a API de Empresas opera apenas em produção; `dry_run=1` simula sem criar a empresa.
   */
  registerCompany(body: Record<string, unknown>, opts: { dryRun: boolean }) {
    return this.call("POST", `/v2/empresas${opts.dryRun ? "?dry_run=1" : ""}`, body);
  }
  cancel(kind: FocusDocumentPath, ref: string, justificativa: string) {
    if (justificativa.length < 15 || justificativa.length > 255) throw new Error("focus_cancel_reason_length");
    return this.call("DELETE", `/v2/${kind}/${encodeURIComponent(ref)}`, { justificativa });
  }
}
