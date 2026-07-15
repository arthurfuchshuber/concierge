import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { TeachAiDialog } from "@/components/admin/TeachAiDialog";
import { getConversationMessages } from "@/lib/chat-admin.functions";
import { toast } from "sonner";
import { AlertCircle, GraduationCap, Loader2 } from "lucide-react";

type Item = {
  message_id: string;
  conversation_id: string;
  property_id: string;
  reason: string | null;
  created_at: string;
};

type Property = { id: string; name: string };

export function FeedbackList({ items, properties }: { items: Item[]; properties: Property[] }) {
  const propMap = new Map(properties.map((p) => [p.id, p.name] as const));
  const getMsgs = useServerFn(getConversationMessages);
  const qc = useQueryClient();
  const [teach, setTeach] = useState<{ messageId: string; q: string; a: string } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function openTeach(item: Item) {
    setLoadingId(item.message_id);
    try {
      const msgs = await getMsgs({ data: { conversationId: item.conversation_id } });
      const list = Array.isArray(msgs) ? msgs : [];
      const idx = list.findIndex((m) => m.id === item.message_id);
      const a = idx >= 0 ? (list[idx].content as string) : "";
      let q = "";
      for (let i = idx - 1; i >= 0; i--) {
        if (list[i].role === "user") { q = list[i].content as string; break; }
      }
      setTeach({ messageId: item.message_id, q, a });
    } catch {
      toast.error("Não foi possível abrir a conversa.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between pr-14">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <AlertCircle className="size-4 text-amber-500" />
            Respostas da IA marcadas como não úteis
          </h3>
          <p className="text-xs text-muted-foreground">Ensine a IA a partir delas para não repetir o erro</p>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-8 text-center">Nada pendente. Ótimo sinal.</div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((f) => (
            <li key={f.message_id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate font-medium">{propMap.get(f.property_id) ?? "—"}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {f.reason || "Sem detalhe"} · {new Date(f.created_at).toLocaleDateString("pt-BR")}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => openTeach(f)}
                disabled={loadingId === f.message_id}
              >
                {loadingId === f.message_id
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <><GraduationCap className="size-3.5 mr-1" /> Ensinar</>}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {teach && (
        <TeachAiDialog
          open
          onOpenChange={(o) => { if (!o) setTeach(null); }}
          messageId={teach.messageId}
          userQuestion={teach.q}
          aiAnswer={teach.a}
          onTaught={() => {
            setTeach(null);
            qc.invalidateQueries({ queryKey: ["engagement-analytics"] });
            toast.success("IA aprendeu. Feedback resolvido.");
          }}
        />
      )}
    </div>
  );
}
