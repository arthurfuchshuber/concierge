import type { FieldTyping } from "@/hooks/usePresence";

/**
 * Mostra "Fulano está digitando: ..." junto de um campo, com o texto exato
 * que a outra pessoa está digitando naquele campo agora. Só leitura — nunca
 * mescla com o que você mesmo está digitando ali.
 */
export function FieldTypingBadge({ typing }: { typing: FieldTyping | undefined }) {
  if (!typing) return null;
  return (
    <div
      className="mt-1.5 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] animate-in fade-in-0 slide-in-from-top-1 duration-150"
      style={{ borderColor: typing.color + "55", backgroundColor: typing.color + "14" }}
    >
      <span className="size-1.5 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: typing.color }} />
      <span className="font-medium shrink-0" style={{ color: typing.color }}>
        {typing.name}:
      </span>
      <span className="truncate text-foreground/80">{typing.value || <em className="text-muted-foreground">digitando…</em>}</span>
    </div>
  );
}
