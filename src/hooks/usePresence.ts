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

export type RemoteEvent = {
  kind: "typing" | "state";
  fieldId: string;
  value: unknown;
  userId: string;
};

export type Presence = ReturnType<typeof usePresence>;

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
  const listenersRef = useRef(new Set<(ev: RemoteEvent) => void>());
  const stateTimersRef = useRef(new Map<string, { timer: ReturnType<typeof setTimeout> | null; value: unknown }>());

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
    // Canal PRIVADO: o servidor valida (via RLS em realtime.messages) se a
    // pessoa realmente tem acesso ao imóvel/cadastro deste tópico antes de
    // entregar presença ou broadcasts.
    const channel = supabase.channel(`presence:${roomKey}`, {
      config: { private: true, presence: { key: me.userId } },
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
        for (const l of listenersRef.current) l({ kind: "typing", fieldId: p.fieldId, value: p.value, userId: p.userId });
      })
      .on("broadcast", { event: "state" }, ({ payload }) => {
        const p = payload as { scope: string; value: unknown; userId: string };
        if (p.userId === me.userId) return;
        for (const l of listenersRef.current) l({ kind: "state", fieldId: p.scope, value: p.value, userId: p.userId });
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

  /**
   * Transmite o estado de uma seção inteira (ex.: lista de FAQs) para quem
   * está na mesma tela — chega na hora, antes mesmo de gravar no banco.
   * Agrupa rajadas de digitação em no máximo 1 envio a cada ~80ms.
   */
  const broadcastState = useCallback(
    (scope: string, value: unknown) => {
      if (!me) return;
      const map = stateTimersRef.current;
      const entry = map.get(scope) ?? { timer: null, value };
      entry.value = value;
      map.set(scope, entry);
      if (entry.timer) return;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        channelRef.current?.send({
          type: "broadcast",
          event: "state",
          payload: { scope, value: entry.value, userId: me.userId },
        });
      }, 80);
    },
    [me],
  );

  const subscribe = useCallback((cb: (ev: RemoteEvent) => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  return { me, users, typing, broadcastTyping, broadcastFieldBlur, broadcastState, subscribe };
}

/**
 * Aplica na hora, no campo local, o que outra pessoa está digitando no mesmo
 * campo (via broadcastTyping já existente) — estilo Miro. O salvamento no
 * banco continua sendo feito por quem digitou; quem recebe só exibe.
 */
export function useLiveField(
  presence: Pick<Presence, "subscribe"> | null | undefined,
  fieldId: string,
  apply: (value: string) => void,
) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!presence) return;
    return presence.subscribe((ev) => {
      if (ev.kind === "typing" && ev.fieldId === fieldId && typeof ev.value === "string") applyRef.current(ev.value);
    });
  }, [presence?.subscribe, fieldId]);
}

/**
 * Sincroniza um pedaço de estado (objeto/lista) entre todos com a tela aberta:
 * alterações locais são transmitidas na hora; alterações remotas são
 * aplicadas localmente sem serem re-transmitidas (evita eco).
 * `onRemote` é chamado com o valor recebido — use-o para aplicar no estado e
 * marcar que esse valor já está salvo por quem o enviou.
 */
export function useLiveState<T>(
  presence: Pick<Presence, "subscribe" | "broadcastState"> | null | undefined,
  scope: string,
  value: T,
  onRemote: (value: T) => void,
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true;
  const serialized = JSON.stringify(value);
  const lastRef = useRef<string | null>(null);
  const onRemoteRef = useRef(onRemote);
  onRemoteRef.current = onRemote;

  useEffect(() => {
    if (!presence || !enabled) return;
    return presence.subscribe((ev) => {
      if (ev.kind !== "state" || ev.fieldId !== scope) return;
      lastRef.current = JSON.stringify(ev.value);
      onRemoteRef.current(ev.value as T);
    });
  }, [presence?.subscribe, scope, enabled]);

  useEffect(() => {
    if (!presence || !enabled) return;
    if (lastRef.current === null) {
      // primeira renderização: só registra, não transmite dados recém-carregados
      lastRef.current = serialized;
      return;
    }
    if (lastRef.current === serialized) return;
    lastRef.current = serialized;
    presence.broadcastState(scope, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, enabled, scope]);
}
