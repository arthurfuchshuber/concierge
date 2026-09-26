/**
 * TRADUTOR ÚNICO DE ERROS (25/09/2026 — pedido do cliente: "absolutamente
 * todos os erros do sistema em uma frase clara em português").
 *
 * Qualquer erro (Supabase, Postgres, rede, validação, HTML de servidor fora do
 * ar, mensagens em inglês de bibliotecas) vira uma frase curta, orientativa e
 * sem termos técnicos. Mensagens já escritas em português claro passam intactas.
 *
 * Usado em três camadas globais: servidor (middleware), toasts (sonner) e
 * telas de erro. Assim nenhuma mensagem crua chega ao usuário.
 */

const PT_HINT =
  /[ãõçáéíóúâêôà]|\b(não|nao|você|voce|tente|erro|falha|salvar|registro|imóvel|reserva|preencha|informe|aguarde|sessão|permissão|conseguimos|consegui|precisa|escreva|falta|está|esta|nenhum|nenhuma|inválid|obrigatóri|encontrad|agora|novamente|de novo)\b/i;

const TECH = /[{}<>]|\b(null|undefined|uuid|jwt|pgrst|sqlstate|stack|fetch|column|relation|constraint|schema|payload|zod|token|supabase|postgres|rpc)\b|[a-z]+_[a-z_]+/i;

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error_description === "string") return o.error_description;
    if (typeof o.error === "string") return o.error;
  }
  return "";
}

const EN_HINT =
  /\b(the|is|are|was|not|no|failed|failure|error|invalid|cannot|can't|could|unable|unexpected|missing|of|to|with|for|and|or|request|response|server|denied|exceeded|already|must|should|please)\b/i;

function isClearPortuguese(msg: string): boolean {
  if (msg.length > 320 || TECH.test(msg)) return false;
  // Frases do próprio app sem acento (ex.: "Selecione uma imagem") também passam,
  // desde que não pareçam inglês.
  return PT_HINT.test(msg) || !EN_HINT.test(msg);
}

export function friendlyErrorMessage(
  err: unknown,
  fallback = "Não foi possível concluir esta ação. Tente novamente em alguns segundos.",
): string {
  let msg = rawMessage(err).trim();
  if (!msg) return fallback;

  // Erros de validação (Zod) chegam como JSON: pega a primeira mensagem.
  if (msg.startsWith("[") || msg.startsWith("{")) {
    try {
      const parsed = JSON.parse(msg);
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      const inner = first && typeof first.message === "string" ? first.message : "";
      if (inner && isClearPortuguese(inner)) return inner;
      if (inner) msg = inner;
      else return "Verifique os campos preenchidos e tente novamente.";
    } catch {
      /* segue */
    }
  }

  if (isClearPortuguese(msg)) return msg;

  // "Frase em português: detalhe técnico em inglês" → fica só a frase.
  const colon = msg.indexOf(": ");
  if (colon > 0) {
    const head = msg.slice(0, colon).trim();
    if (isClearPortuguese(head)) return head.endsWith(".") ? head : `${head}.`;
  }

  const lower = msg.toLowerCase();

  if (lower.includes("<!doctype") || lower.includes("<html") || /\b(502|503|504|521|522|523|524)\b/.test(lower) || lower.includes("web server is down") || lower.includes("bad gateway") || lower.includes("service unavailable")) {
    return "O servidor está reiniciando. Nada foi perdido — aguarde alguns segundos e tente de novo.";
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("upstream") || lower.includes("57014") || lower.includes("statement timeout")) {
    return "O sistema demorou demais para responder. Nada foi perdido — tente de novo.";
  }
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("load failed") || lower.includes("offline") || lower.includes("aborted")) {
    return "Sem conexão com a internet no momento. Verifique sua rede e tente de novo.";
  }
  if (lower.includes("duplicate key") || lower.includes("already exists") || lower.includes("unique constraint") || lower.includes("23505") || lower.includes("already registered")) {
    return "Este item já está cadastrado.";
  }
  if (lower.includes("foreign key") || lower.includes("23503")) {
    return "Não foi possível vincular este item a um registro relacionado.";
  }
  if (lower.includes("null value") || lower.includes("23502") || lower.includes("required")) {
    return "Preencha todos os campos obrigatórios antes de salvar.";
  }
  if (lower.includes("check constraint") || lower.includes("23514") || lower.includes("invalid input") || lower.includes("invalid format")) {
    return "Um dos valores informados não é válido. Confira e tente de novo.";
  }
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "E-mail ou senha incorretos.";
  }
  if (lower.includes("email not confirmed")) {
    return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
  }
  if (lower.includes("password") && (lower.includes("weak") || lower.includes("at least") || lower.includes("short"))) {
    return "A senha é fraca. Use pelo menos 8 caracteres, misturando letras e números.";
  }
  if (lower.includes("rate limit") || lower.includes("too many") || lower.includes("429")) {
    return "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.";
  }
  if (lower.includes("payment required") || lower.includes("402") || lower.includes("credits")) {
    return "Os créditos de IA acabaram. Recarregue os créditos para continuar usando.";
  }
  if (lower.includes("permission") || lower.includes("not authorized") || lower.includes("forbidden") || lower.includes("row-level security") || lower.includes("42501") || lower.includes("403")) {
    return "Você não tem permissão para esta ação.";
  }
  if (lower.includes("unauthorized") || lower.includes("jwt") || lower.includes("invalid token") || lower.includes("session") || lower.includes("401")) {
    return "Sua sessão expirou. Entre novamente para continuar.";
  }
  if (lower.includes("not found") || lower.includes("pgrst116") || lower.includes("404")) {
    return "Não encontramos este registro. Ele pode ter sido excluído.";
  }
  if (lower.includes("too large") || lower.includes("payload") || lower.includes("413") || lower.includes("file size")) {
    return "O arquivo é grande demais. Tente um arquivo menor.";
  }
  if (lower.includes("42703") || lower.includes("column")) {
    return "Uma atualização do sistema ainda está sendo aplicada. Tente de novo em alguns minutos.";
  }
  if (lower.includes("zoderror") || lower.includes("expected ") || lower.includes("invalid")) {
    return "Verifique os campos preenchidos e tente novamente.";
  }
  return fallback;
}
