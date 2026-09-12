/**
 * Converte erros (Supabase, Postgres, validação) em mensagens curtas,
 * orientativas e sem termos técnicos, para serem usadas em toasts.
 */
export function friendlyErrorMessage(err: unknown, fallback = "Não foi possível concluir esta ação. Tente novamente."): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : "");

  const msg = raw.trim();
  if (!msg) return fallback;

  const lower = msg.toLowerCase();

  // Duplicações / unicidade
  if (lower.includes("duplicate key") || lower.includes("already exists") || lower.includes("unique constraint") || lower.includes("23505")) {
    return "Este item já está cadastrado aqui.";
  }
  // FK
  if (lower.includes("foreign key") || lower.includes("23503")) {
    return "Não conseguimos vincular este item a um registro relacionado.";
  }
  // Not null
  if (lower.includes("null value") || lower.includes("23502")) {
    return "Preencha todos os campos obrigatórios antes de salvar.";
  }
  // Check / valor inválido
  if (lower.includes("check constraint") || lower.includes("23514") || lower.includes("invalid input")) {
    return "Um dos valores informados não é válido.";
  }
  // Permissão / RLS
  if (lower.includes("permission") || lower.includes("not authorized") || lower.includes("rls") || lower.includes("42501") || lower.includes("sem permissão")) {
    return "Você não tem permissão para esta ação.";
  }
  // Auth
  if (lower.includes("unauthorized") || lower.includes("401")) {
    return "Sua sessão expirou. Entre novamente para continuar.";
  }
  // Rede
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("timeout")) {
    return "Falha de conexão. Verifique sua internet e tente novamente.";
  }
  // Não encontrado
  if (lower.includes("not found") || lower.includes("pgrst116")) {
    return "Não encontramos este registro.";
  }
  // Validação Zod
  if (lower.includes("zoderror") || lower.includes("expected ") || lower.includes("required")) {
    return "Verifique os campos preenchidos e tente novamente.";
  }
  // Mensagens já em português curtas (sem códigos técnicos) — repassa
  if (msg.length <= 140 && !/[{}<>]/.test(msg) && !/[a-z_]+_[a-z_]+/i.test(msg)) {
    return msg;
  }
  return fallback;
}
