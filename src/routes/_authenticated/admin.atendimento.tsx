import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { z } from "zod";
import {
  listHandoffConversations,
  getAtendimentoAccess,
} from "@/lib/handoff.functions";
import { ConversationList, ConversationView, useMyUserId } from "@/components/handoff/ConversationView";
import { Headphones, Inbox, User, CheckCircle2, Bot, MessagesSquare, Search } from "lucide-react";
import { Input } from "@/components/ui/input";


const searchSchema = z.object({
  conv: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/admin/atendimento")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AtendimentoPage,
});

type Queue = "needs_human" | "assigned_to_me" | "all_active" | "ai_only" | "all" | "resolved";

const QUEUES: Array<{ key: Queue; label: string; icon: typeof Inbox }> = [
  { key: "needs_human", label: "Precisa humano", icon: Inbox },
  { key: "assigned_to_me", label: "Meus", icon: User },
  { key: "ai_only", label: "Com a IA", icon: Bot },
  { key: "resolved", label: "Resolvidas", icon: CheckCircle2 },
];

function AtendimentoPage() {
  const { conv } = useSearch({ from: "/_authenticated/admin/atendimento" });
  const accessFn = useServerFn(getAtendimentoAccess);
  const listFn = useServerFn(listHandoffConversations);
  const myUserId = useMyUserId();

  const access = useQuery({
    queryKey: ["handoff-access"],
    queryFn: async () => {
      try { return await accessFn(); } catch { return { allowed: false as const, as: null, plan: null }; }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const [queue, setQueue] = useState<Queue>("needs_human");
  const [activeId, setActiveId] = useState<string | null>(conv ?? null);
  const [search, setSearch] = useState("");


  useEffect(() => { if (conv) setActiveId(conv); }, [conv]);

  const list = useQuery({
    queryKey: ["handoff-list", queue],
    queryFn: async () => {
      try {
        return await listFn({ data: { queue, limit: 100 } });
      }
      catch { return { conversations: [], details: {} }; }
    },
    enabled: access.data?.allowed === true,
    refetchInterval: 15_000,
    retry: false,
  });


  if (access.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando…</div>;
  }

  if (access.data?.allowed !== true) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="glass rounded-2xl p-8 border border-border">
          <div className="inline-flex items-center gap-2 mb-3">
            <Headphones className="size-5 text-primary" />
            <h1 className="font-display text-2xl">Central de atendimento</h1>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            A Central de Atendimento humano com handoff da IA está disponível nos planos <strong>Business</strong> e <strong>Enterprise</strong>.
          </p>
          <a href="/admin/assinatura" className="inline-flex items-center rounded-xl px-4 py-2 bg-primary text-primary-foreground font-medium">
            Fazer upgrade
          </a>
        </div>
      </div>
    );
  }

  const conversations = list.data?.conversations ?? [];
  const details = list.data?.details ?? {};

  const filteredConversations = (() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    const digits = term.replace(/\D+/g, "");
    return conversations.filter((c) => {
      const d = details[c.id];
      const prop = Array.isArray(c.properties) ? c.properties[0] : c.properties;
      const checkin = d?.checkinDate ?? null;
      const hay = [
        d?.name ?? c.guest_name ?? "",
        prop?.name ?? "",
        d?.reservationCode ?? "",
        c.handoff_reason ?? "",
        checkin ?? "",
        checkin ? new Date(checkin).toLocaleDateString("pt-BR") : "",
      ].join(" ").toLowerCase();
      if (hay.includes(term)) return true;
      if (digits && d?.phone && d.phone.replace(/\D+/g, "").includes(digits)) return true;
      return false;
    });
  })();


  return (
    <div className="h-[calc(100vh-0px)] lg:h-screen flex flex-col">
      <header className="border-b border-border px-4 lg:px-6 py-3 flex items-center gap-3 shrink-0">
        <Headphones className="size-5 text-primary" />
        <h1 className="font-display text-lg lg:text-xl flex-1 min-w-0 truncate">Central de atendimento</h1>
      </header>
      <div className="flex-1 min-h-0 flex">
        {/* Filas */}
        <aside className="w-56 border-r border-border shrink-0 hidden md:flex flex-col">
          <nav className="p-2 space-y-1">
            {QUEUES.map((q) => {
              const active = queue === q.key;
              const Icon = q.icon;
              return (
                <button
                  key={q.key}
                  onClick={() => setQueue(q.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${active ? "bg-primary text-primary-foreground font-medium" : "hover:bg-secondary"}`}
                >
                  <Icon className="size-4" />
                  {q.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Lista */}
        <div className="w-full md:w-80 border-r border-border overflow-y-auto shrink-0">
          <div className="md:hidden p-2 flex gap-1 overflow-x-auto border-b border-border">
            {QUEUES.map((q) => (
              <button
                key={q.key}
                onClick={() => setQueue(q.key)}
                className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full ${queue === q.key ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nome, guia, telefone, check-in, mensagem…"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
          <ConversationList
            conversations={filteredConversations as any}
            details={details}
            assignedNames={list.data?.assignedNames ?? {}}
            activeId={activeId}
            onSelect={setActiveId}
          />


        </div>

        {/* Chat */}
        <div className="flex-1 min-w-0 hidden md:block">
          {activeId ? (
            <ConversationView conversationId={activeId} myUserId={myUserId} />
          ) : (
            <div className="h-full grid place-items-center text-sm text-muted-foreground p-8 text-center">
              Selecione uma conversa à esquerda.
            </div>
          )}
        </div>

        {/* Mobile chat overlay */}
        {activeId && (
          <div className="md:hidden fixed inset-0 z-30 bg-background flex flex-col">
            <div className="border-b border-border p-2 flex items-center gap-2">
              <button onClick={() => setActiveId(null)} className="text-sm px-3 py-1.5 rounded-md border border-border">← Voltar</button>
            </div>
            <div className="flex-1 min-h-0">
              <ConversationView conversationId={activeId} myUserId={myUserId} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
