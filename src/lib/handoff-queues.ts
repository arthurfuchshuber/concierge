import { Headphones, User, Bot, CircleCheck } from "lucide-react";

export type Queue = "needs_human" | "assigned_to_me" | "all_active" | "ai_only" | "all" | "resolved";

// Ordem OBRIGATÓRIA (23/11/2026), em todo lugar onde as filas aparecem: Meus · Precisa Humano · Com a IA ·
// Resolvidas (celular: Meus · Humano · IA · Resolvidas). "Meus" é a aba padrão ao abrir a página.
// "Precisa Humano" usa "all_active" (needs_human + assigned) de propósito: mostra TODA conversa com humano, mesmo
// já assumida por outro atendente — senão ela some da visão do resto da equipe.
export const QUEUES: Array<{ key: Queue; label: string; short: string; icon: typeof Headphones }> = [
  { key: "assigned_to_me", label: "Meus", short: "Meus", icon: User },
  { key: "all_active", label: "Precisa Humano", short: "Humano", icon: Headphones },
  { key: "ai_only", label: "Com a IA", short: "IA", icon: Bot },
  { key: "resolved", label: "Resolvidas", short: "Resolvidas", icon: CircleCheck },
];

export const DEFAULT_QUEUE: Queue = "assigned_to_me";

/** Estado vazio de cada fila (mockup ATD-D01/M01). */
export const QUEUE_EMPTY: Record<Queue, { title: string; sub: string }> = {
  assigned_to_me: { title: "Nenhuma conversa com você agora.", sub: "Quando você assumir uma conversa, ela aparece aqui." },
  all_active: { title: "Nenhuma conversa precisa da equipe agora.", sub: "Quando a IA chamar a equipe, a conversa aparece aqui." },
  needs_human: { title: "Nenhuma conversa precisa da equipe agora.", sub: "Quando a IA chamar a equipe, a conversa aparece aqui." },
  ai_only: { title: "Nenhuma conversa com a IA agora.", sub: "As conversas que a IA está conduzindo aparecem aqui." },
  all: { title: "Nenhuma conversa.", sub: "As conversas com os hóspedes aparecem aqui." },
  resolved: { title: "Nenhuma conversa resolvida.", sub: "As conversas encerradas aparecem aqui." },
};
