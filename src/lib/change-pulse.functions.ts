/**
 * PULSO DE MUDANÇAS — rede de segurança do "instantâneo para todos".
 *
 * O tempo real (Postgres Changes) é o caminho principal. Mas ele pode perder um
 * evento sem avisar: celular em segundo plano, token vencendo, rede oscilando,
 * canal "conectado" que a RLS esvaziou. Antes disso valia o polling de 5 min
 * (com o canal "saudável"), e foi assim que um check-in concluído por outra
 * pessoa continuou "pendente" na tela de quem não fez a ação (17/10/2026).
 *
 * Esta função devolve uma impressão digital barata (contagem + última mudança
 * de cada tabela de operação, já filtradas pela RLS de quem pergunta). O
 * cliente pergunta a cada poucos segundos e só relê a tela se a impressão
 * mudou — então o pior caso de atraso cai de minutos para segundos, sem custo
 * de recarregar nada quando nada mudou.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const WATCH: Array<[table: string, col: string]> = [
  ["guest_arrival_status", "updated_at"],
  ["guide_access_logs", "created_at"],
  ["property_reservations", "updated_at"],
  ["tasks", "updated_at"],
  ["task_completions", "completed_at"],
  ["reservation_records", "created_at"],
  ["property_chat_conversations", "updated_at"],
  ["property_chat_messages", "created_at"],
  ["properties", "updated_at"],
];

export const getChangePulse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const parts = await Promise.all(
      WATCH.map(async ([table, col]) => {
        try {
          const [{ count }, { data }] = await Promise.all([
            sb.from(table).select("id", { count: "exact", head: true }),
            sb.from(table).select(col).order(col, { ascending: false, nullsFirst: false }).limit(1),
          ]);
          const last = (data?.[0]?.[col] as string | undefined) ?? "";
          return `${table}:${count ?? 0}:${last}`;
        } catch {
          return `${table}:err`;
        }
      }),
    );
    return { pulse: parts.join("|") };
  });
