import { Badge } from "@/components/ui/badge";
import { AlertCircle, MessageSquare } from "lucide-react";
import type { ConversationRow } from "@/lib/engagement-guests.functions";

export function ConversationsTable({
  conversations, onSelect,
}: {
  conversations: ConversationRow[];
  onSelect: (guestKey: string | null, conversationId: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="p-4 border-b border-border">
        <h3 className="text-sm font-semibold">Conversas com a IA</h3>
        <p className="text-xs text-muted-foreground">
          Todas as threads do período. Clique para abrir a conversa completa do hóspede.
        </p>
      </header>
      {conversations.length === 0 ? (
        <div className="p-10 text-center text-xs text-muted-foreground">Nenhuma conversa no período.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Hóspede</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Imóvel</th>
                <th className="text-left px-4 py-2 font-medium">Primeira pergunta</th>
                <th className="text-right px-4 py-2 font-medium"><MessageSquare className="size-3 inline" /></th>
                <th className="text-right px-4 py-2 font-medium hidden sm:table-cell">Última msg</th>
              </tr>
            </thead>
            <tbody>
              {conversations.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => onSelect(c.guestKey, c.id)}
                  className="border-t border-border cursor-pointer hover:bg-muted/40 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium truncate max-w-[160px]" title={c.guestName}>{c.guestName}</div>
                    {c.phone && <div className="text-[11px] text-muted-foreground tabular-nums">{c.phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[160px] hidden md:table-cell" title={c.propertyName}>
                    {c.propertyName}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="line-clamp-2 max-w-[380px]" title={c.firstMessage}>
                      {c.firstMessage || <span className="text-muted-foreground italic">sem mensagem do hóspede</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <div className="flex items-center justify-end gap-1.5">
                      {c.hasUnresolvedFeedback && <AlertCircle className="size-3 text-rose-500" />}
                      <Badge variant="secondary" className="text-[10px]">{c.messagesCount}</Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground hidden sm:table-cell">
                    {new Date(c.lastMessageAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
