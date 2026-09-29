import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getCleaningProviderBoard, setCleaningAssignment } from "@/lib/cleaning-assign.functions";
import { useImpersonation } from "@/hooks/useImpersonation";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const second = parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1];
  return ((parts[0]?.[0] ?? "") + (second ?? "")).toUpperCase();
}

export function useCleaningBoard() {
  const fn = useServerFn(getCleaningProviderBoard);
  // Sempre escopado à conta ativa: nunca mistura prestadores de outra conta.
  const ownerId = useImpersonation().impersonation?.userId ?? null;
  return useQuery({
    queryKey: ["cleaning-board", ownerId],
    queryFn: () => fn({ data: { ownerId } }),
    staleTime: 30_000,
  });
}

/** Vassoura + balde, no mesmo traço dos ícones lucide (24x24, stroke 2). */
function BroomBucket({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M17 2 13 11" />
      <path d="M10.5 10.5 15.5 12.5 14 17 8 15z" />
      <path d="M10 15.6 9 17M12.5 16.4l-.8 1.5" />
      <path d="M2 13h7l-1 9H3z" />
      <path d="M2.5 13a3 3 0 0 1 6 0" />
    </svg>
  );
}

/** Quadrado do perfil. Sem foto: fundo azul bebê com kit de limpeza. */
function Face({ name, url, size = 28 }: { name: string | null; url: string | null; size?: number }) {
  return url ? (
    <img src={url} alt={name ?? ""} className="rounded-[0.3rem] object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      title={name ?? undefined}
      className="inline-flex shrink-0 items-center justify-center rounded-[0.3rem] border border-border/50 bg-background/60"
      style={{ minWidth: size, height: size, paddingInline: name ? 5 : 0 }}
    >
      {name ? (
        <span className="block text-[14px] font-semibold leading-none tracking-[-0.02em] text-[var(--cleaning-soft)] [text-box:trim-both_cap_alphabetic]">{initials(name)}</span>
      ) : (
        <BroomBucket className="size-3.5 text-[var(--cleaning-soft)]" />
      )}
    </span>
  );
}
void initials;

/** Bolinha do responsável pela limpeza + troca pontual (só esta limpeza). */
export function CleaningProviderAvatar({
  propertyId,
  logId,
  reservationId,
  showName,
}: {
  propertyId: string;
  logId: string;
  reservationId: string | null;
  /** Mostra o nome ao lado da bolinha (janela de detalhes). */
  showName?: boolean;
}) {
  const board = useCleaningBoard();
  const qc = useQueryClient();
  const setFn = useServerFn(setCleaningAssignment);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const realLog = /^[0-9a-f-]{36}$/i.test(logId) ? logId : null;
  const resId = reservationId ?? (logId.startsWith("ical:") ? logId.slice(5) : null);

  const b = board.data;
  const assignedId = (resId && b?.assigned[`r:${resId}`]) || (realLog && b?.assigned[`l:${realLog}`]) || null;
  const defaultId = b?.defaults[propertyId] ?? null;
  const currentId = assignedId ?? defaultId;
  const current = b?.providers.find((p) => p.id === currentId) ?? null;

  const filtered = useMemo(() => {
    const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    return (b?.providers ?? []).filter((p) => norm(p.name).includes(norm(q)));
  }, [b, q]);

  const m = useMutation({
    mutationFn: (providerId: string | null) =>
      setFn({ data: { propertyId, logId: realLog, reservationId: resId, providerId } }),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["cleaning-board"] });
      toast.success("Responsável desta limpeza atualizado.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível direcionar."),
  });

  if (!realLog && !resId) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={current ? `Responsável: ${current.name}. Trocar` : "Atribuir prestador"}
          title={current ? `Responsável: ${current.name}` : "Atribuir prestador"}
          className={showName ? "inline-flex min-w-0 items-center gap-2 rounded-[0.3rem] py-0.5 pl-0.5 pr-2 transition hover:bg-secondary/60" : "relative shrink-0 rounded-[0.3rem] transition hover:opacity-85"}
        >
          <span className="relative shrink-0">
          <Face name={current?.name ?? null} url={current?.avatarUrl ?? null} size={showName ? 26 : 28} />
          {assignedId && (
            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-primary" />
          )}
          </span>
          {showName && (
            <span className="min-w-0 break-words text-[12.5px] font-semibold">
              {current ? current.name : "Atribuir prestador"}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 max-w-[calc(100vw-2rem)] p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-3 pb-2 pt-3">
          <p className="font-display text-[13px] font-bold">Responsável por esta limpeza</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Vale só para esta limpeza.</p>
          <div className="mt-2 flex h-8 items-center gap-1.5 rounded-[0.3rem] bg-secondary/60 px-2">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar prestador"
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
            />
          </div>
        </div>
        <ul className="sg-elegant-scroll max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <li className="px-2 py-4 text-center text-[12px] text-muted-foreground">Nenhum prestador encontrado.</li>
          )}
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={m.isPending}
                onClick={() => m.mutate(p.id === defaultId ? null : p.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-secondary/60"
              >
                <Face name={p.name} url={p.avatarUrl} size={24} />
                <span className="min-w-0 flex-1 break-words text-[12.5px] font-semibold">{p.name}</span>
                {p.id === defaultId && (
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-muted-foreground">
                    Padrão
                  </span>
                )}
                {p.id === currentId && <Check className="size-3.5 shrink-0 text-primary" />}
              </button>
            </li>
          ))}
        </ul>
        {assignedId && (
          <button
            type="button"
            disabled={m.isPending}
            onClick={() => m.mutate(null)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3.5" /> Restaurar prestador padrão
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
