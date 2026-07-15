import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  getHandoffConversation,
  sendHandoffMessage,
  claimHandoffConversation,
  releaseHandoffConversation,
  resolveHandoffConversation,
} from "@/lib/handoff.functions";
import { Send, UserCheck, RotateCcw, CheckCircle2, Loader2, StickyNote } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Props = { conversationId: string; compact?: boolean; myUserId: string | null };

export function ConversationView({ conversationId, compact, myUserId }: Props) {
  const getFn = useServerFn(getHandoffConversation);
  const sendFn = useServerFn(sendHandoffMessage);
  const claimFn = useServerFn(claimHandoffConversation);
  const releaseFn = useServerFn(releaseHandoffConversation);
  const resolveFn = useServerFn(resolveHandoffConversation);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["handoff-conv", conversationId],
    queryFn: () => getFn({ data: { conversationId } }),
    refetchInterval: 8000,
  });

  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [q.data?.messages?.length]);

  // Realtime: assina alterações desta conversa
  useEffect(() => {
    const ch = supabase
      .channel(`conv-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "property_chat_messages", filter: `conversation_id=eq.${conversationId}` }, () => {
        qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "property_chat_conversations", filter: `id=eq.${conversationId}` }, () => {
        qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, qc]);

  const send = useMutation({
    mutationFn: async () => sendFn({ data: { conversationId, content: text.trim(), internalNote: note } }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
      qc.invalidateQueries({ queryKey: ["handoff-list"] });
      qc.invalidateQueries({ queryKey: ["handoff-pending-count"] });
    },
  });

  const claim = useMutation({
    mutationFn: async () => claimFn({ data: { conversationId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
      qc.invalidateQueries({ queryKey: ["handoff-list"] });
      qc.invalidateQueries({ queryKey: ["handoff-pending-count"] });
    },
  });
  const release = useMutation({
    mutationFn: async () => releaseFn({ data: { conversationId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
      qc.invalidateQueries({ queryKey: ["handoff-list"] });
    },
  });
  const resolve = useMutation({
    mutationFn: async () => resolveFn({ data: { conversationId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handoff-conv", conversationId] });
      qc.invalidateQueries({ queryKey: ["handoff-list"] });
    },
  });

  const conv = q.data?.conversation;
  const msgs = q.data?.messages ?? [];
  const propertyName = (conv?.properties as { name?: string } | null)?.name ?? "Guia";
  const isMine = conv?.assigned_to && myUserId && conv.assigned_to === myUserId;
  const status = conv?.status;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="border-b border-border p-3 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{conv?.guest_name || "Hóspede anônimo"}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {propertyName}
            {conv?.handoff_at ? ` · ${formatDistanceToNow(new Date(conv.handoff_at), { locale: ptBR, addSuffix: true })}` : ""}
          </div>
          {conv?.handoff_reason && (
            <div className="text-[11px] mt-1 px-2 py-1 rounded bg-amber-500/10 text-amber-700 border border-amber-500/30 line-clamp-2">
              {conv.handoff_reason}
            </div>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {status === "needs_human" && (
            <button onClick={() => claim.mutate()} disabled={claim.isPending} className="text-xs px-2 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-1">
              <UserCheck className="size-3" /> Assumir
            </button>
          )}
          {status === "assigned" && isMine && (
            <button onClick={() => release.mutate()} disabled={release.isPending} className="text-xs px-2 py-1.5 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1" title="Devolver à IA">
              <RotateCcw className="size-3" /> IA
            </button>
          )}
          {status !== "resolved" && (
            <button onClick={() => resolve.mutate()} disabled={resolve.isPending} className="text-xs px-2 py-1.5 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Resolver
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0 bg-background/40">
        {q.isLoading && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="size-3 animate-spin" /> Carregando…</div>}
        {msgs.map((m) => {
          const isGuest = m.sender_type === "guest";
          const isNote = m.is_internal_note;
          return (
            <div key={m.id} className={`flex ${isGuest ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                  isNote
                    ? "bg-yellow-500/15 border border-yellow-500/30 text-foreground"
                    : isGuest
                    ? "bg-secondary text-foreground"
                    : m.sender_type === "human"
                    ? "bg-primary text-primary-foreground"
                    : "bg-accent text-accent-foreground"
                }`}
              >
                {isNote && <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1 flex items-center gap-1"><StickyNote className="size-3" /> Nota interna</div>}
                {!isNote && !isGuest && (
                  <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">
                    {m.sender_type === "human" ? "Atendente" : "IA"}
                  </div>
                )}
                {m.content}
                <div className="text-[10px] opacity-60 mt-1">
                  {formatDistanceToNow(new Date(m.created_at), { locale: ptBR, addSuffix: true })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {status !== "resolved" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim() || send.isPending) return;
            send.mutate();
          }}
          className="shrink-0 border-t border-border p-2 flex items-end gap-2 bg-surface"
        >
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0 select-none">
            <input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} className="size-3" />
            nota
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (text.trim()) send.mutate();
              }
            }}
            placeholder={note ? "Nota interna (não visível ao hóspede)…" : "Escrever para o hóspede…"}
            rows={compact ? 1 : 2}
            className="flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="submit"
            disabled={!text.trim() || send.isPending}
            className="size-9 grid place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
          >
            {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </form>
      )}
    </div>
  );
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
}: {
  conversations: Array<{
    id: string; guest_name: string | null; status: string; handoff_at: string | null; last_message_at: string; handoff_urgency: string | null; handoff_reason: string | null;
    properties: { name: string | null } | { name: string | null }[] | null;
  }>;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col divide-y divide-border">
      {conversations.length === 0 && (
        <div className="p-4 text-xs text-muted-foreground text-center">Nenhuma conversa.</div>
      )}
      {conversations.map((c) => {
        const prop = Array.isArray(c.properties) ? c.properties[0] : c.properties;
        const isActive = c.id === activeId;
        const urgent = c.handoff_urgency === "high";
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`text-left px-3 py-2.5 hover:bg-secondary transition-colors ${isActive ? "bg-secondary" : ""}`}
          >
            <div className="flex items-center gap-2">
              {urgent && <span className="size-2 rounded-full bg-red-500 shrink-0" />}
              <div className="text-sm font-medium truncate flex-1">{c.guest_name || "Hóspede anônimo"}</div>
              <span className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(c.handoff_at ?? c.last_message_at), { locale: ptBR, addSuffix: false })}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{prop?.name ?? "—"}</div>
            {c.handoff_reason && <div className="text-[11px] text-foreground/70 truncate mt-0.5">{c.handoff_reason}</div>}
          </button>
        );
      })}
    </div>
  );
}

export function useMyUserId() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setId(data.user?.id ?? null));
  }, []);
  return id;
}
