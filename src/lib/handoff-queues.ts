import { Inbox, User, Bot, CheckCircle2 } from "lucide-react";

export type Queue = "needs_human" | "assigned_to_me" | "all_active" | "ai_only" | "all" | "resolved";

export const QUEUES: Array<{ key: Queue; label: string; short: string; icon: typeof Inbox }> = [
  { key: "needs_human", label: "Precisa humano", short: "Humano", icon: Inbox },
  { key: "assigned_to_me", label: "Meus", short: "Meus", icon: User },
  { key: "ai_only", label: "Com a IA", short: "IA", icon: Bot },
  { key: "resolved", label: "Resolvidas", short: "Resolvidas", icon: CheckCircle2 },
];
