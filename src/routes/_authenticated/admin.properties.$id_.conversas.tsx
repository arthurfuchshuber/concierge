import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, MessageSquare, User, Bot, Loader2 } from "lucide-react";
import { listPropertyConversations, getConversationMessages } from "@/lib/chat-admin.functions";
import { PageHeader } from "@/components/ds/PageHeader";

export const Route = createFileRoute("/_authenticated/admin/properties/$id_/conversas")({
  component: ConversationsPage,
});

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function ConversationsPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const listFn = useServerFn(listPropertyConversations);
  const msgsFn = useServerFn(getConversationMessages);
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-conversations", id],
    queryFn: () => listFn({ data: { propertyId: id } }),
  });

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ["admin-conversation", selected],
    queryFn: () => msgsFn({ data: { conversationId: selected! } }),
    enabled: !!selected,
  });

  return (
    <div className="px-6 lg:px-10 py-8 lg:py-10 max-w-[1440px] mx-auto w-full">
      <button
        onClick={() => navigate({ to: "/admin/properties/$id", params: { id } })}
        className="inline-flex items-center gap-1.5 ds-meta hover:text-foreground mb-5 transition-colors"
      >
        <ArrowLeft className="size-3.5" /> Voltar para o guia
      </button>

      <PageHeader
        title={data?.property.name ?? "Carregando…"}
        subtitle="Conversas dos hóspedes · perguntas e respostas trocadas com o assistente do guia."
      />

      <div className="mt-10">

      {isLoading ? (
        <div className="flex items-center gap-2 ds-body"><Loader2 className="size-4 animate-spin" /> Carregando…</div>
      ) : !data || data.conversations.length === 0 ? (
        <div className="ds-surface border border-border bg-surface p-8 text-center">
          <MessageSquare className="size-8 mx-auto text-muted-foreground mb-3" />
          <p className="ds-body">Nenhuma conversa ainda.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-[280px_1fr] gap-4">
          <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
            {data.conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`w-full text-left px-3 py-2.5 ds-surface border transition-colors ${
                  selected === c.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-secondary/60"
                }`}
              >
                <div className="ds-card-title truncate">
                  {c.guest_name || `Hóspede ${c.guest_session_id.slice(0, 6)}`}
                </div>
                <div className="ds-meta mt-0.5">{formatDate(c.last_message_at)}</div>
              </button>
            ))}
          </div>

          <div className="ds-surface border border-border bg-surface p-4 sm:p-5 min-h-[300px]">
            {!selected ? (
              <div className="ds-body text-center py-10">
                Selecione uma conversa para ver as mensagens.
              </div>
            ) : loadingDetail || !detail ? (
              <div className="flex items-center gap-2 ds-body">
                <Loader2 className="size-4 animate-spin" /> Carregando mensagens…
              </div>
            ) : (
              <div className="space-y-3">
                <div className="pb-3 border-b border-border/60">
                  <div className="ds-card-title">
                    {detail.conversation.guest_name || `Hóspede ${detail.conversation.guest_session_id.slice(0, 6)}`}
                  </div>
                  <div className="ds-meta mt-0.5">
                    Iniciada em {formatDate(detail.conversation.created_at)}
                  </div>
                </div>
                <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                  {detail.messages.map((m) => (
                    <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      {m.role !== "user" && (
                        <div className="size-7 shrink-0 rounded-full bg-primary/10 grid place-items-center">
                          <Bot className="size-3.5 text-primary" />
                        </div>
                      )}
                      <div className={`max-w-[80%] ds-surface px-3.5 py-2 ds-body whitespace-pre-wrap ${
                        m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                      }`}>
                        {m.content}
                        <div className={`text-[10px] mt-1 ${m.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {formatDate(m.created_at)}
                        </div>
                      </div>
                      {m.role === "user" && (
                        <div className="size-7 shrink-0 rounded-full bg-accent grid place-items-center">
                          <User className="size-3.5 text-accent-foreground" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

