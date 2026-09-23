/**
 * Cache curto em memória para chamadas de IA repetidas (21/09/2026).
 *
 * POR QUE EXISTE
 *
 * As perguntas mais frequentes do hóspede se repetem palavra por palavra entre
 * pessoas diferentes ("qual a senha do wi-fi", "que horas é o checkout",
 * "qual o endereço"). Cada repetição refazia o mesmo trabalho pago: gerar o
 * embedding da frase e buscar os mesmos trechos.
 *
 * O que entra aqui é APENAS trabalho determinístico e impessoal — embedding de
 * um texto e trechos de conhecimento do imóvel. Resposta ao hóspede NUNCA é
 * guardada: ela depende da reserva, do nome e do momento da estadia.
 *
 * Vive no processo do servidor, com validade curta e teto de tamanho — some
 * sozinho e nunca vira fonte de verdade desatualizada.
 */

type Entry<T> = { value: T; expires: number };

const store = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 800;

function prune(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expires <= now) store.delete(key);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Normaliza a chave textual: caixa, acento e espaço não criam entradas novas. */
export function cacheKeyOf(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Executa `fn` só quando não houver valor válido em cache.
 *
 * Falha nunca é guardada: se `fn` lançar, o erro sobe e nada fica no cache.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;

  const value = await fn();
  store.set(key, { value, expires: now + ttlMs });
  if (store.size > MAX_ENTRIES) prune();
  return value;
}
