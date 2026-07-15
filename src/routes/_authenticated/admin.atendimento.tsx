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
import { Headphones, Inbox, User, CheckCircle2, ListChecks } from "lucide-react";

const searchSchema = z.object({ conv: z.string().uuid().optional() });

export const Route = createFileRoute("/_authenticated/admin/atendimento")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AtendimentoPage,
});

type Queue = "needs_human" | "assigned_to_me" | "all_active" | "resolved";

const QUEUES: Array<{ key: Queue; label: string; icon: typeof Inbox }> = [
  { key: "needs_human", label: "Precisa humano", icon: Inbox },
  { key: "assigned_to_me", label: "Meus", icon: User },
  { key: "all_active", label: "Todas ativas", icon: ListChecks },
  { key: "resolved", label: "Resolvidas", icon: CheckCircle2 },
];

function AtendimentoPage() {
  const { conv } = useSearch({ from: "/_authenticated/admin/atendimento" });
  const accessFn = useServerFn(getAtendimentoAccess);
  const listFn = useServerFn(listHandoffConversations);
  const myUserId = useMyUserId();

  const access = useQuery({ queryKey: ["handoff-access"], queryFn: () => accessFn(), staleTime: 5 * 60_000 });

  const [queue, setQueue] = useState<Queue>("needs_human");
  const [activeId, setActiveId] = useState<string | null>(conv ?? null);

  useEffect(() => { if (conv) setActiveId(conv); }, [conv]);

  const list = useQuery({
    queryKey: ["handoff-list", queue],
    queryFn: () => listFn({ data: { queue, limit: 100 } }),
    enabled: access.data?.allowed === true,
    refetchInterval: 15_000,
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

  return (
    <div className="h-[calc(100vh-0px)] lg:h-screen flex flex-col">
      <header className="border-b border-border px-4 lg:px-6 py-3 flex items-center gap-3 shrink-0">
        <Headphones className="size-5 text-primary" />
        <h1 className="font-display text-lg lg:text-xl">Central de atendimento</h1>
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
          <ConversationList
            conversations={conversations as any}
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
