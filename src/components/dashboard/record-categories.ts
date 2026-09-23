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
/* PADRÃO "PRESENÇA" (18/09/2026): as cinco categorias tinham cinco matizes
   saturados (laranja, rosa, violeta, azul-céu, zinco) — eram a última coisa
   que ainda fazia a tela de Registros parecer um carnaval ao lado das outras
   abas. Agora usam os MESMOS três tons contidos do resto do sistema, pelo
   significado e não pela variedade: rosa terroso = problema (dano,
   manutenção), âmbar = atenção (esquecidos), verde sálvia = rotina em ordem
   (auditoria de limpeza), neutro = o resto. É exatamente o mapa que
   `CARD_TOP_LINE` já usava nos cartões de contagem. */
export const CATEGORIES: CategoryMeta[] = [
  {
    key: "forgotten",
    label: "Objetos Esquecidos",
    short: "Esquecidos",
    hint: "Achados e perdidos",
    icon: Package,
    tone: "bg-[#c9a962]/10 text-[#c9a962] border-[#c9a962]/30",
    dot: "bg-[#c9a962]",
    createsTask: true,
  },
  {
    key: "damage",
    label: "Danos ou Incidentes",
    short: "Danos",
    hint: "Prova pra cobrança",
    icon: AlertTriangle,
    tone: "bg-[#c98c8c]/10 text-[#c98c8c] border-[#c98c8c]/30",
    dot: "bg-[#c98c8c]",
    createsTask: true,
  },
  {
    key: "cleaning_audit",
    label: "Auditoria de Limpeza",
    short: "Limpeza",
    hint: "Pronto pro próximo hóspede",
    icon: Sparkles,
    tone: "bg-[#7fb79a]/10 text-[#7fb79a] border-[#7fb79a]/30",
    dot: "bg-[#7fb79a]",
    createsTask: false,
  },
  {
    key: "maintenance",
    label: "Manutenção",
    short: "Manutenção",
    hint: "Reparo necessário ou feito",
    icon: Wrench,
    tone: "bg-[#c98c8c]/10 text-[#c98c8c] border-[#c98c8c]/30",
    dot: "bg-[#c98c8c]",
    createsTask: true,
  },
  {
    key: "other",
    label: "Observação / Outros",
    short: "Outros",
    hint: "Registro comum",
    icon: StickyNote,
    tone: "bg-foreground/[0.06] text-muted-foreground border-border",
    dot: "bg-muted-foreground/60",
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
