/**
 * Camada client-side de autorização (FASE 4.1).
 *
 * Regra inegociável: o frontend NUNCA decide permissão. Este módulo apenas
 * transporta, normaliza e cacheia as decisões produzidas pelo backend
 * (`permission.guard.server.ts` / `permission.enforce.server.ts`).
 */
import { toast } from "sonner";
import type { ClientAccessDecision } from "./permission.access.functions";

export type AccessScope = {
  propertyId?: string | null;
  clientId?: string | null;
  recordId?: string | null;
};

export type AccessLevelInput = "NONE" | "READ" | "WRITE";

export type AccessState = {
  allowed: boolean;
  loading: boolean;
  reason: string;
  scope: { type: string; id: string | null };
};

export const LOADING_REASON = "Verificando permissões…";
export const DENIED_REASON = "Você não tem permissão para acessar este recurso.";

/** Estado seguro: enquanto carrega ou em erro, nada é liberado. */
export function safeState(loading: boolean, reason = loading ? LOADING_REASON : DENIED_REASON): AccessState {
  return { allowed: false, loading, reason, scope: { type: "TENANT", id: null } };
}

export function toAccessState(
  decision: ClientAccessDecision | undefined,
  loading: boolean,
  errored = false,
): AccessState {
  if (loading) return safeState(true);
  if (errored || !decision) return safeState(false);
  return {
    allowed: decision.allowed,
    loading: false,
    reason: decision.reason,
    scope: decision.scope,
  };
}

/** Ações de leitura → READ; qualquer outra ação → WRITE. */
const READ_ACTIONS = new Set([
  "read",
  "view",
  "list",
  "get",
  "ver",
  "listar",
  "consultar",
  "abrir",
]);

export function requiredLevelFor(action: string): AccessLevelInput {
  return READ_ACTIONS.has(action.trim().toLowerCase()) ? "READ" : "WRITE";
}

/** Chave estável de cache por permissão + escopo + nível. */
export function accessQueryKey(
  permissions: string[],
  required: AccessLevelInput,
  scope: AccessScope = {},
) {
  return [
    "access",
    [...permissions].sort().join("|"),
    required,
    scope.propertyId ?? null,
    scope.clientId ?? null,
    scope.recordId ?? null,
  ] as const;
}

/* ------------------------------------------------- PERMISSION_DENIED global */

export type PermissionDeniedInfo = {
  code: "PERMISSION_DENIED";
  permission: string;
  reason: string;
  scope: { type: string; id: string | null };
};

/** Reconhece o erro padronizado emitido pela camada de enforcement. */
export function permissionDeniedFrom(error: unknown): PermissionDeniedInfo | null {
  if (!error) return null;
  const anyErr = error as Record<string, unknown>;
  const nested = (anyErr["body"] ?? anyErr["data"] ?? anyErr["error"]) as
    | Record<string, unknown>
    | undefined;
  const source = anyErr["code"] === "PERMISSION_DENIED" ? anyErr : nested;

  if (source && source["code"] === "PERMISSION_DENIED") {
    const scope = (source["scope"] as { type?: string; id?: string | null }) ?? {};
    return {
      code: "PERMISSION_DENIED",
      permission: String(source["permission"] ?? "desconhecida"),
      reason: String(source["reason"] ?? DENIED_REASON),
      scope: { type: scope.type ?? "TENANT", id: scope.id ?? null },
    };
  }

  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message.includes("PERMISSION_DENIED")) {
    return {
      code: "PERMISSION_DENIED",
      permission: "desconhecida",
      reason: DENIED_REASON,
      scope: { type: "TENANT", id: null },
    };
  }
  return null;
}

export function isPermissionDenied(error: unknown): boolean {
  return permissionDeniedFrom(error) !== null;
}

/** Mensagem amigável, sem termos técnicos. */
export function friendlyDeniedMessage(info: PermissionDeniedInfo): string {
  return info.reason && !/permission|scope|node/i.test(info.reason)
    ? info.reason
    : "Você não tem permissão para realizar esta ação. Fale com o responsável pela conta.";
}

/**
 * Tratamento global: nunca quebra a aplicação, avisa o usuário em português
 * e registra o diagnóstico no console para suporte.
 */
export function handlePermissionDenied(error: unknown, context?: { operation?: string }): boolean {
  const info = permissionDeniedFrom(error);
  if (!info) return false;
  console.warn(
    `[authz][ui] acesso negado — operação=${context?.operation ?? "-"} ` +
      `permissão=${info.permission} escopo=${info.scope.type}:${info.scope.id ?? "-"} · ${info.reason}`,
  );
  toast.error(friendlyDeniedMessage(info));
  return true;
}

/** Instala o interceptador global de rejeições não tratadas. */
export function installPermissionDeniedHandler(): () => void {
  if (typeof window === "undefined") return () => {};
  const onRejection = (event: PromiseRejectionEvent) => {
    if (handlePermissionDenied(event.reason, { operation: "promise" })) event.preventDefault();
  };
  window.addEventListener("unhandledrejection", onRejection);
  return () => window.removeEventListener("unhandledrejection", onRejection);
}

export const permissionClient = {
  accessQueryKey,
  requiredLevelFor,
  toAccessState,
  safeState,
  isPermissionDenied,
  permissionDeniedFrom,
  handlePermissionDenied,
  installPermissionDeniedHandler,
};
