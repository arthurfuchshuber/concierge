/**
 * Vocabulário compartilhado dos REGISTROS (categorias, etapa de origem e o
 * rótulo de dia), fora do componente porque duas telas o consomem: a linha
 * do tempo dentro da reserva (ReservationRecords) e a aba "Registros"
 * (RecordsWorkspace). Mesmo motivo de `card-colors.ts` existir separado.
 */
import { Package, AlertTriangle, Sparkles, Wrench, StickyNote } from "lucide-react";
import type { RecordCategory } from "@/lib/reservation-records.functions";

// "Registros da reserva" (pedido explícito, 07/09/2026): mesmo ícone em
// QUALQUER status do card abrindo uma linha do tempo ÚNICA por reserva.
// A etiqueta de cada registro é a CATEGORIA (o que é), não mais a coluna de
// origem (onde nasceu) — essa desceu pro rodapé, como dado secundário.
export type CardMode = "checkin" | "checkout" | "stay" | "cleaning" | "done" | "no_show";

export const MODE_LABEL: Record<CardMode, string> = {
  checkin: "Check-in",
  checkout: "Checkout",
  stay: "Estadia",
  cleaning: "Fila de Limpeza",
  done: "Concluído",
  no_show: "Não Compareceu",
};

export type CategoryMeta = {
  key: RecordCategory;
  label: string;
  short: string;
  hint: string;
  icon: typeof Package;
  /** Classes da etiqueta na linha do tempo e do item no seletor. */
  tone: string;
  dot: string;
  /** Abre pendência no Kanban (ver TASK_RULES em reservation-records.functions.ts). */
  createsTask: boolean;
};

/**
 * ORDEM definida pelo cliente (07/09/2026) — é exatamente esta a ordem em
 * que aparecem no seletor e nos filtros.
 */
export const CATEGORIES: CategoryMeta[] = [
  {
    key: "forgotten",
    label: "Objetos Esquecidos",
    short: "Esquecidos",
    hint: "Achados e perdidos",
    icon: Package,
    tone: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
    dot: "bg-orange-500",
    createsTask: true,
  },
  {
    key: "damage",
    label: "Danos ou Incidentes",
    short: "Danos",
    hint: "Prova pra cobrança",
    icon: AlertTriangle,
    tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
    dot: "bg-rose-500",
    createsTask: true,
  },
  {
    key: "cleaning_audit",
    label: "Auditoria de Limpeza",
    short: "Limpeza",
    hint: "Pronto pro próximo hóspede",
    icon: Sparkles,
    tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30",
    dot: "bg-violet-500",
    createsTask: false,
  },
  {
    key: "maintenance",
    label: "Manutenção",
    short: "Manutenção",
    hint: "Reparo necessário ou feito",
    icon: Wrench,
    tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
    dot: "bg-sky-500",
    createsTask: true,
  },
  {
    key: "other",
    label: "Observação / Outros",
    short: "Outros",
    hint: "Registro comum",
    icon: StickyNote,
    tone: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
    dot: "bg-zinc-500",
    createsTask: false,
  },
];

export const CATEGORY_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

/** "Hoje" / "Ontem" / "04 set" — cabeçalho de cada bloco de dia. */
export function fmtDayLabel(iso: string): string {
  const d = new Date(iso);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((t0.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
