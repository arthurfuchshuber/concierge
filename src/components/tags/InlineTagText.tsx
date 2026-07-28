import { Fragment, useCallback } from "react";
import {
  tokenizeAll,
  resolveInfoValue,
  isProtectedInfoKey,
  type GuideTagKey,
  type GuideInfoKey,
  type GuideInfoSnapshot,
} from "@/lib/guide-tags";
import { cn } from "@/lib/utils";
import { Lock } from "lucide-react";

type UnlockCtx = {
  snapshot?: GuideInfoSnapshot | null;
  unlocked?: boolean;
  hasAccessPin?: boolean;
  checkinLocked?: boolean;
  onRequestUnlock?: () => void;
};

type Props = {
  text: string;
  className?: string;
  onNavigate?: (key: GuideTagKey, param: string | null) => void;
  /** Contexto opcional — quando presente, `[[info:...]]` é expandido inline. */
  info?: UnlockCtx;
};

/** Renderiza texto com `[[tag:...]]` (link) e `[[info:...]]` (valor, possivelmente mascarado). */
export function InlineTagText({ text, className, onNavigate, info }: Props) {
  const tokens = tokenizeAll(text ?? "");
  const handleTag = useCallback(
    (key: GuideTagKey, param: string | null) => (e: React.MouseEvent) => {
      e.preventDefault();
      onNavigate?.(key, param);
    },
    [onNavigate],
  );

  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {tokens.map((t, i) => {
        if (t.kind === "text") return <Fragment key={i}>{t.value}</Fragment>;
        if (t.kind === "tag") {
          return (
            <a
              key={i}
              href="#"
              onClick={handleTag(t.key, t.param)}
              className="inline-flex items-baseline gap-0.5 rounded-md px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-900/30 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 font-medium no-underline"
            >
              {t.label}
            </a>
          );
        }
        // info token
        return <InfoInline key={i} tokenKey={t.key} param={t.param} label={t.label} ctx={info} />;
      })}
    </span>
  );
}

function InfoInline({
  tokenKey,
  param,
  label,
  ctx,
}: {
  tokenKey: GuideInfoKey;
  param: string | null;
  label: string | null;
  ctx?: UnlockCtx;
}) {
  const value = resolveInfoValue(tokenKey, param, ctx?.snapshot ?? null);
  const protectedKey = isProtectedInfoKey(tokenKey);
  const locked = protectedKey && (!!ctx?.checkinLocked || (!!ctx?.hasAccessPin && !ctx?.unlocked));

  if (!value && !locked) return null;

  if (locked) {
    const canUnlock = !ctx?.checkinLocked && !!ctx?.hasAccessPin && !!ctx?.onRequestUnlock;
    const title = ctx?.checkinLocked
      ? "Disponível a partir de 24h antes do check-in"
      : "Clique para desbloquear com o código de acesso";
    const content = (
      <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 bg-amber-100/80 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 font-mono tracking-wider">
        <Lock className="size-3" />
        ••••••
      </span>
    );
    if (canUnlock) {
      return (
        <button
          type="button"
          title={title}
          onClick={(e) => {
            e.preventDefault();
            ctx!.onRequestUnlock!();
          }}
          className="inline-flex align-baseline cursor-pointer hover:brightness-110"
        >
          {content}
        </button>
      );
    }
    return <span title={title}>{content}</span>;
  }

  const display = label ? `${label} (${value})` : value;
  return (
    <span className={cn(protectedKey && "font-mono tracking-wider")}>{display}</span>
  );
}
