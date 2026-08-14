import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PresenceUser = {
  userId: string;
  name: string;
  color: string;
};

export type FieldTyping = {
  fieldId: string;
  value: string;
  userId: string;
  name: string;
  color: string;
  at: number;
};

const PALETTE = ["#e82dae", "#7c1ad8", "#1D9E75", "#378ADD", "#EF9F27", "#E24B4A"];

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** "maria.silva@empresa.com" → "Maria Silva". Só usado quando não há nome de exibição salvo. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Presença em tempo real + "está digitando", estilo Miro/Figma/Google Docs —
 * mas deliberadamente mais simples: mostra o que a outra pessoa está
 * digitando como um preview ao lado do campo (nunca mescla com o que VOCÊ
 * está digitando). Edição simultânea de verdade no mesmo campo exigiria um
 * CRDT (Yjs/Automerge) — fora de escopo aqui; isto cobre o caso real de
 * "duas pessoas na mesma tela, uma vê o que a outra está fazendo".
 *
 * `roomKey` identifica a tela/registro (ex.: `property:{id}`). Duas pessoas
 * só se enxergam se estiverem na MESMA roomKey.
 */
export function usePresence(roomKey: string | null) {
  const [me, setMe] = useState<{ userId: string; name: string } | null>(null);
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [typing, setTyping] = useState<Record<string, FieldTyping>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      const displayName =
        (data.user.user_metadata?.full_name as string | undefined)?.trim() ||
        (data.user.email ? nameFromEmail(data.user.email) : "Alguém");
      setMe({ userId: data.user.id, name: displayName });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!roomKey || !me) return;
    const channel = supabase.channel(`presence:${roomKey}`, {
      config: { presence: { key: me.userId } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string; color: string }>();
        const list: PresenceUser[] = [];
        for (const key of Object.keys(state)) {
          if (key === me.userId) continue;
          const meta = state[key]?.[0];
          if (meta) list.push({ userId: key, name: meta.name, color: meta.color });
        }
        setUsers(list);
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const p = payload as FieldTyping;
        if (p.userId === me.userId) return;
        setTyping((prev) => ({ ...prev, [p.fieldId]: p }));
      })
      .on("broadcast", { event: "field-blur" }, ({ payload }) => {
        const p = payload as { fieldId: string; userId: string };
        if (p.userId === me.userId) return;
        setTyping((prev) => {
          if (prev[p.fieldId]?.userId !== p.userId) return prev;
          const next = { ...prev };
          delete next[p.fieldId];
          return next;
        });
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ name: me.name, color: colorForUser(me.userId) });
        }
      });

    // Expira indicadores "digitando" órfãos (ex.: a pessoa fechou a aba sem
    // disparar o blur) depois de alguns segundos sem novo evento.
    const expireTimer = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        let changed = false;
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (now - next[k].at > 4000) {
            delete next[k];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);

    return () => {
      clearInterval(expireTimer);
      supabase.removeChannel(channel);
      channelRef.current = null;
      setUsers([]);
      setTyping({});
    };
  }, [roomKey, me]);

  const broadcastTyping = useCallback(
    (fieldId: string, value: string) => {
      if (!me) return;
      channelRef.current?.send({
        type: "broadcast",
        event: "typing",
        payload: {
          fieldId,
          value,
          userId: me.userId,
          name: me.name,
          color: colorForUser(me.userId),
          at: Date.now(),
        },
      });
    },
    [me],
  );

  const broadcastFieldBlur = useCallback(
    (fieldId: string) => {
      if (!me) return;
      channelRef.current?.send({
        type: "broadcast",
        event: "field-blur",
        payload: { fieldId, userId: me.userId },
      });
    },
    [me],
  );

  return { me, users, typing, broadcastTyping, broadcastFieldBlur };
}
