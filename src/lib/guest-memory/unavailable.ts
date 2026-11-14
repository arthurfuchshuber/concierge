/** Mesmo padrão conservador de schema cache/relação ausente usado nos registros de reserva. */
export function isGuestMemoryUnavailable(error: unknown): boolean {
  if (!error) return false;
  const value = typeof error === "object" ? error as { code?: unknown; message?: unknown } : null;
  const code = typeof value?.code === "string" ? value.code : "";
  const message = typeof error === "string" ? error : typeof value?.message === "string" ? value.message : "";
  return /^(42P01|42883|PGRST205|PGRST202)$/.test(code)
    || /schema cache|(?:relation|table|function).*does not exist|could not find (?:the )?(?:table|function)/i.test(message);
}

export function throwIfGuestMemoryUnavailable(error: unknown): void {
  if (isGuestMemoryUnavailable(error)) throw Object.assign(new Error("guest_memory_not_activated"), { code: "42P01" });
}