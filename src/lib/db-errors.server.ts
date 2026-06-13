// Server-only helper to map Supabase/Postgres errors to safe, generic messages.
// Logs the raw error for debugging without leaking schema details to clients.

type PgErrorLike = { code?: string; message?: string; details?: string | null; hint?: string | null } | null | undefined;

export function safeDbError(scope: string, error: PgErrorLike): Error {
  // Always log the raw error server-side for operators.
  console.error(`[db:${scope}]`, error);

  const code = error?.code;
  switch (code) {
    case "23505":
      return new Error("Esse valor já está em uso.");
    case "23503":
      return new Error("Registro relacionado não encontrado.");
    case "23502":
      return new Error("Preencha os campos obrigatórios.");
    case "23514":
      return new Error("Valor inválido para um dos campos.");
    case "42501":
    case "PGRST301":
      return new Error("Você não tem permissão para esta ação.");
    case "PGRST116":
      return new Error("Registro não encontrado.");
    default:
      return new Error("Não foi possível concluir a operação. Tente novamente.");
  }
}
