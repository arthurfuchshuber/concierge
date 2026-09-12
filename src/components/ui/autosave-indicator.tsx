import { Check, Loader2, AlertTriangle } from "lucide-react";
import type { AutosaveStatus } from "@/hooks/useAutosave";

export function AutosaveIndicator({ status, errorMessage }: { status: AutosaveStatus; errorMessage?: string | null }) {
  if (status === "idle") return null;
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Salvando…
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] text-destructive"
        // Passe o mouse por cima pra ver o motivo real — sem isso, "Falha ao
        // salvar" sozinho não dava nenhuma pista do que travou o autosave.
        title={errorMessage || "Motivo não identificado — veja o console do navegador."}
      >
        <AlertTriangle className="size-3" /> Falha ao salvar
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-500 animate-in fade-in-0 duration-200">
      <Check className="size-3" /> Salvo
    </span>
  );
}
