import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Peer = { id: string; name: string };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Presença ao vivo (estilo Miro/Figma): mostra quem está com este guia aberto
 * neste momento. Usa Realtime Presence — nada é gravado no banco.
 */
export function EditorPresence({ roomId }: { roomId: string }) {
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    if (!roomId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user || cancelled) return;
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const name =
        (meta["full_name"] as string) || (meta["name"] as string) || user.email?.split("@")[0] || "Alguém";

      channel = supabase.channel(`editor:${roomId}`, { config: { presence: { key: user.id } } });
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel!.presenceState() as Record<string, Array<{ name?: string }>>;
          const list: Peer[] = Object.entries(state)
            .filter(([id]) => id !== user.id)
            .map(([id, entries]) => ({ id, name: entries[0]?.name ?? "Alguém" }));
          setPeers(list);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void channel!.track({ name });
        });
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [roomId]);

  if (!peers.length) return null;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground hidden sm:inline">Editando agora:</span>
      <div className="flex -space-x-1.5">
        {peers.slice(0, 4).map((p) => (
          <Tooltip key={p.id}>
            <TooltipTrigger asChild>
              <span className="size-6 rounded-full grid place-items-center text-[10px] font-semibold bg-primary/15 text-primary border border-background">
                {initials(p.name)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{p.name}</TooltipContent>
          </Tooltip>
        ))}
        {peers.length > 4 && (
          <span className="size-6 rounded-full grid place-items-center text-[10px] bg-muted text-muted-foreground border border-background">
            +{peers.length - 4}
          </span>
        )}
      </div>
    </div>
  );
}
