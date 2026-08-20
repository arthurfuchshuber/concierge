import { useEffect, useState } from "react";
// @ts-expect-error módulo virtual gerado pelo Vite (vite.config.ts)
import buildInfo from "virtual:build-info";

type BuildInfo = { commit: string; builtAt: string };

/**
 * Selo de versão do build (hash do commit + horário da compilação).
 * Renderizado só após a hidratação para não gerar diferença entre servidor e cliente.
 */
export function BuildBadge() {
  const [info, setInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    setInfo(buildInfo as BuildInfo);
  }, []);

  if (!info?.commit) return null;

  const when = new Date(info.builtAt);
  const label = Number.isNaN(when.getTime())
    ? info.commit
    : `${info.commit} · ${when.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })}`;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999] flex justify-center pt-[max(env(safe-area-inset-top),2px)]">
      <span
        title={`Build ${info.commit} — ${info.builtAt}`}
        className="pointer-events-auto rounded-b-lg bg-foreground/80 px-2 py-0.5 font-mono text-[10px] leading-none tracking-tight text-background shadow-sm"
      >
        {label}
      </span>
    </div>
  );
}
