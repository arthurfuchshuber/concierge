// Server-only helper to map Supabase/Postgres errors to safe, generic messages.
// Logs the raw error for debugging without leaking schema details to clients.

type PgErrorLike = { code?: string; message?: string; details?: string | null; hint?: string | null } | null | undefined;

export function isTemporaryDbError(error: PgErrorLike): boolean {
  const message = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
  return (
    error?.code === "57014" ||
    error?.code === "PGRST002" ||
    /schema cache|connection pool|connection timeout|connect error|disconnect|reset before headers|timed? out|timeout|temporarily unavailable|upstream/i.test(message)
  );
}

export async function retryDbResult<T extends { error: PgErrorLike }>(
  operation: () => PromiseLike<T>,
  attempts = 5,
): Promise<T> {
  let result = await operation();
  for (let attempt = 1; result.error && isTemporaryDbError(result.error) && attempt < attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** (attempt - 1), 4_000)));
    result = await operation();
  }
  return result;
}

export function safeDbError(scope: string, error: PgErrorLike): Error {
  // Always log the raw error server-side for operators.
  console.error(`[db:${scope}]`, error);

  if (isTemporaryDbError(error)) {
    return new Error("O sistema de dados está se reconectando. Nada foi perdido — aguarde alguns segundos e tente de novo.");
  }

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
    // "undefined_column" — o código tenta gravar uma coluna que ainda não
    // existe no banco (normalmente uma migration nova que ainda não foi
    // aplicada no projeto Supabase). Sem isto, esse erro caía no "default"
    // abaixo e ficava indistinguível de qualquer outra falha — impossível
    // de diagnosticar num fluxo onde não há acesso ao banco/logs ao vivo.
    // Não expõe qual coluna é (evita vazar detalhe de schema), mas dá uma
    // pista específica o bastante pra saber que é isso, não outra coisa.
    case "42703":
      return new Error(
        "Uma atualização recente do sistema ainda não foi aplicada neste banco de dados. Peça pra quem administra o Supabase aplicar as migrations pendentes e tente salvar de novo.",
      );
    // statement_timeout — o banco cortou a operação por demora.
    case "57014":
      return new Error("O sistema demorou demais para salvar. Nada foi perdido — toque em salvar de novo.");
    case "PGRST002":
      return new Error("O sistema de dados está se reconectando. Nada foi perdido — aguarde alguns segundos e salve de novo.");
    case "42501":
    case "PGRST301":
      return new Error("Você não tem permissão para esta ação.");
    case "PGRST116":
      return new Error("Registro não encontrado.");
    default:
      return new Error("Não foi possível concluir a operação. Tente novamente.");
  }
}
