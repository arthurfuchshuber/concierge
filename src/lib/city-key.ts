// Normaliza nome de cidade em uma "chave" estável para agrupar referências.
// Ex.: "Florianópolis" -> "florianopolis", "São Paulo" -> "sao-paulo".
export function cityKey(city: string | null | undefined): string {
  if (!city) return "";
  return city
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// UF normalizada — sempre maiúscula, 2 letras. Retorna null se inválido.
export function normalizeState(state: string | null | undefined): string | null {
  if (!state) return null;
  const s = state.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(s)) return s;
  return null;
}
