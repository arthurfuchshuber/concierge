/**
 * O QUE CONTA COMO "PENDÊNCIA" NA ABA REGISTROS — uma definição só.
 *
 * Servidor e tela liam listas diferentes: a tela subia para "a resolver" só
 * DANO e MANUTENÇÃO, enquanto os cartões de contagem mostravam também
 * INCIDENTES. Resultado (03/10/2026): faixa dizendo "13 pendências" ao lado de
 * cartões que somavam 8 + 14 + 1. Agora o servidor conta com esta lista e a
 * tela exibe o número que ele devolve — faixa e filtros não têm como divergir.
 *
 * Pedido explícito (03/10/2026): a faixa soma TODAS as pendências — também as
 * de OBJETO ESQUECIDO, que abrem tarefa no Kanban. Auditoria de limpeza e
 * "outros" nunca geram tarefa: são prova, não trabalho.
 */
export const PENDING_CATEGORIES = ["damage", "maintenance", "incident", "forgotten"] as const;
export type PendingCategory = (typeof PENDING_CATEGORIES)[number];

export function isPendingCategory(c: string): c is PendingCategory {
  return (PENDING_CATEGORIES as readonly string[]).includes(c);
}
