import { Headphones, User, Bot, CheckCircle2 } from "lucide-react";

export type Queue = "needs_human" | "assigned_to_me" | "all_active" | "ai_only" | "all" | "resolved";

// "Humano" usa "all_active" (needs_human + assigned) de propósito: precisa
// mostrar TODA conversa com humano, mesmo já assumida por outro atendente —
// senão, assim que alguém puxa uma conversa pra si, ela some da visão de
// qualquer outra pessoa da equipe, e ninguém mais consegue vê-la pra, se for
// o caso, puxar de volta.
export const QUEUES: Array<{ key: Queue; label: string; short: string; icon: typeof Headphones }> = [
  { key: "all_active", label: "Precisa humano", short: "Humano", icon: Headphones },
  { key: "assigned_to_me", label: "Meus", short: "Meus", icon: User },
  { key: "ai_only", label: "Com a IA", short: "IA", icon: Bot },
  { key: "resolved", label: "Resolvidas", short: "Resolvidas", icon: CheckCircle2 },
];
