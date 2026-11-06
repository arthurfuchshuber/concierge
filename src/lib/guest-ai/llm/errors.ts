/** F2-A — mapeamento determinístico de falhas para códigos fixos (sem texto do provedor). */
import type { LlmErrorCode } from "./contracts";

export interface ClassifiedError {
  code: LlmErrorCode;
  retryable: boolean;
  httpStatus: number | null;
}

/** Status HTTP → código. O corpo da resposta de erro NUNCA é lido para log nem devolvido. */
export function classifyHttpStatus(status: number): ClassifiedError {
  if (status === 429) return { code: "rate_limited", retryable: true, httpStatus: status };
  if (status === 402) return { code: "billing", retryable: false, httpStatus: status };
  if (status === 401 || status === 403) return { code: "auth", retryable: false, httpStatus: status };
  if (status === 404) return { code: "model_unavailable", retryable: false, httpStatus: status };
  if (status === 400 || status === 422) return { code: "bad_request", retryable: false, httpStatus: status };
  if (status >= 500) return { code: "provider_unavailable", retryable: true, httpStatus: status };
  return { code: "invalid_response", retryable: false, httpStatus: status };
}

/** Só falhas transitórias do lado do provedor justificam nova tentativa DENTRO do prazo. */
export function isTransient(code: LlmErrorCode): boolean {
  return code === "provider_unavailable" || code === "network";
}

export function failure(code: LlmErrorCode, httpStatus: number | null = null): ClassifiedError {
  const retryable = code === "timeout" || code === "rate_limited" || code === "provider_unavailable" || code === "network";
  return { code, retryable, httpStatus };
}
