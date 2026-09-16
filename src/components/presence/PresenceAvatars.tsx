import type { PresenceUser } from "@/hooks/usePresence";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Pilha de avatares de quem mais está nesta mesma tela agora. */
export function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null;
  const shown = users.slice(0, 4);
  const extra = users.length - shown.length;
  return (
    <div className="flex items-center -space-x-2" title={users.map((u) => u.name).join(", ") + " também estão vendo esta tela"}>
      {shown.map((u) => (
        <div
          key={u.userId}
          className="size-7 rounded-full grid place-items-center text-[10.5px] font-semibold text-white ring-2 ring-background shrink-0"
          style={{ backgroundColor: u.color }}
        >
          {initialsOf(u.name)}
        </div>
      ))}
      {extra > 0 && (
        <div className="size-7 rounded-full grid place-items-center text-[10px] font-semibold bg-muted text-muted-foreground ring-2 ring-background shrink-0">
          +{extra}
        </div>
      )}
    </div>
  );
}
