import { Check, Loader2, LogIn, LogOut, Lock, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * BARRAS "JÁ ACESSEI O AIRBNB!" / "JÁ SAÍ DO AIRBNB!" — mockup aprovado em
 * 24/09/2026 (canvas "Guia — barras de check-in e check-out").
 *
 * Fica fixa logo ACIMA do menu inferior do guia, em qualquer aba. Um toque
 * só, sem pergunta extra. Depois do toque:
 *   "Avisando…" → confirmação ("Excelente estadia! :D" / "Obrigado e boa
 *   viagem!") com o botão "Desfazer" por 5 segundos → a barra some.
 * O "Desfazer" segue o mesmo desenho do painel (borda em gradiente da marca e
 * a linha que esvazia nos 5 s — `UndoActionBar`), pedido explícito do mesmo
 * dia: "lembre-se de colocar também aquele 'Desfazer' com 5 segundos".
 *
 * Esta peça só DESENHA; quem decide quando aparece, o que o toque faz e
 * quando some é a página do guia (a mesma regra vale no onboarding e no guia).
 *
 * "BLOQUEADA" (pedido explícito, 24/09/2026): antes do horário previsto de
 * chegada (o padrão do imóvel, ou um horário antecipado pela EQUIPE), a
 * faixa "Já acessei o Airbnb!" NÃO PODE sumir — ela continua visível, só
 * entra num visual "apagado" (cinza, sem o gradiente verde) e o toque não
 * confirma nada: quem decide o que acontece no toque é a página do guia
 * (`onTap`), que mostra o motivo (ex.: toast) em vez de marcar o check-in.
 * Aqui dentro `locked` só troca o visual e a legenda por `lockedReason` —
 * nunca desliga o `onClick`.
 */

export type StayBarKind = "checkin" | "checkout";
export type StayBarPhase = "idle" | "sending" | "confirmed";

/** Altura que a barra ocupa acima do menu — usada para afastar o conteúdo e
 * o botão flutuante do assistente. */
export const STAY_BAR_HEIGHT = 92;

const COPY: Record<StayBarKind, { caption: string; label: string; done: string }> = {
  checkin: {
    caption: "Já está dentro do imóvel? Avise com um toque.",
    label: "Já acessei o Airbnb!",
    done: "Excelente estadia! :D",
  },
  checkout: {
    caption: "Já deixou o imóvel? Avise com um toque.",
    label: "Já saí do Airbnb!",
    done: "Obrigado e boa viagem!",
  },
};

export function StayActionBar({
  kind,
  phase,
  theme,
  undoMs,
  onTap,
  onUndo,
  aboveNav = true,
  locked = false,
  lockedReason,
}: {
  kind: StayBarKind;
  phase: StayBarPhase;
  theme: "dark" | "light";
  /** Tempo restante do "Desfazer" (ms) — só na fase "confirmed". */
  undoMs?: number;
  onTap: () => void;
  onUndo?: () => void;
  /** false quando o guia não tem menu inferior (só "Início"): a barra encosta
   * no rodapé da tela. */
  aboveNav?: boolean;
  /** Ainda não chegou o horário previsto de chegada — a barra continua na
   * tela (nunca some), só troca pro visual "apagado" e a legenda passa a
   * ser `lockedReason`. O toque continua chamando `onTap` normalmente: quem
   * decide mostrar o motivo é a página do guia, não este componente. */
  locked?: boolean;
  lockedReason?: string;
}) {
  const copy = COPY[kind];
  const isDark = theme === "dark";
  const green = kind === "checkin" && !locked;
  const Icon = locked ? Lock : kind === "checkin" ? LogIn : LogOut;

  return (
    <div
      className={cn(
        "fixed inset-x-0 z-30 px-3 pb-2.5 pt-[22px]",
        aboveNav
          ? "bottom-[calc(70px+max(env(safe-area-inset-bottom),8px))]"
          : "bottom-[max(env(safe-area-inset-bottom),8px)]",
        isDark
          ? "bg-gradient-to-b from-[#080815]/0 via-[#080815]/[0.94] to-[#080815]/[0.94]"
          : "bg-gradient-to-b from-white/0 via-white/[0.94] to-white/[0.94]",
      )}
    >
      <div className="mx-auto flex max-w-[490px] flex-col gap-2">
        {phase !== "confirmed" && (
          <p
            className={cn(
              "text-center text-[11px] font-semibold",
              isDark ? "text-white/60" : "text-slate-700/70",
            )}
          >
            {locked && lockedReason ? lockedReason : copy.caption}
          </p>
        )}

        {phase === "confirmed" ? (
          <div
            role="status"
            className={cn(
              "flex h-[52px] items-center gap-2.5 rounded-[0.3rem] border pl-4 pr-1.5 text-[14.5px] font-extrabold",
              green
                ? isDark
                  ? "border-emerald-400/45 bg-emerald-500/[0.14] text-emerald-200"
                  : "border-emerald-500/40 bg-emerald-50 text-emerald-800"
                : isDark
                  ? "border-orange-400/45 bg-orange-500/[0.14] text-orange-200"
                  : "border-orange-500/40 bg-orange-50 text-orange-800",
            )}
          >
            <Check className="size-5 shrink-0" strokeWidth={2.6} />
            <span className="min-w-0 flex-1 truncate">{copy.done}</span>
            {onUndo && (
              <span className="shrink-0 rounded-[10px] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] p-px">
                <button
                  type="button"
                  onClick={onUndo}
                  className="relative flex h-10 items-center gap-1.5 overflow-hidden rounded-[9px] bg-[#1a1016] px-3.5 text-[13px] font-extrabold text-white transition-colors hover:bg-[#241420]"
                >
                  <Undo2 className="size-4 shrink-0" strokeWidth={2.4} />
                  Desfazer
                  <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-white/[0.06]">
                    <span
                      className="undo-drain block h-full origin-left bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE]"
                      style={{ animationDuration: `${Math.max(0, undoMs ?? 5000)}ms` }}
                    />
                  </span>
                </button>
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onTap}
            disabled={phase === "sending"}
            className={cn(
              "flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[0.3rem] text-[15px] font-extrabold tracking-[-0.01em] transition-all active:scale-[0.99] disabled:opacity-70",
              locked
                ? isDark
                  ? "bg-white/[0.06] text-white/50 border border-white/10"
                  : "bg-slate-900/[0.05] text-slate-500 border border-slate-900/10"
                : cn(
                    "text-white",
                    green
                      ? "bg-gradient-to-r from-emerald-400 to-emerald-500 shadow-[0_12px_30px_-10px_rgba(16,185,129,0.7)]"
                      : "bg-gradient-to-r from-orange-400 to-orange-500 shadow-[0_12px_30px_-10px_rgba(249,115,22,0.7)]",
                  ),
            )}
          >
            {phase === "sending" ? (
              <>
                <Loader2 className="size-[18px] shrink-0 animate-spin" strokeWidth={2.4} />
                Avisando…
              </>
            ) : (
              <>
                <Icon className="size-5 shrink-0" strokeWidth={2.2} />
                {copy.label}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/** Espaço reservado no fim do conteúdo para a barra não cobrir nada. */
export function StayActionBarSpacer() {
  return <div aria-hidden style={{ height: STAY_BAR_HEIGHT }} />;
}
