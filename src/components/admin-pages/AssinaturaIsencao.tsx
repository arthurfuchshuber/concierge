import { Gift, Loader2, TriangleAlert } from "lucide-react";
import { Tag } from "@/components/admin-pages/admin-mobile-ui";
import { fmtDayMonth, type buildAssinatura } from "./assinatura-data";

/**
 * Conta isenta (mockups aprovados, 10/11/2026): a antiga caixa "Isento de pagamento" virou uma faixa
 * de destaque no topo, e o resto da tela segue normal. Todo cliente precisa de um cartão válido,
 * conferido todo dia 20 (cinco dias antes do vencimento do dia 25).
 */
const OK = "#efd27a";
const FAIL = "#f0a3a3";
const INK = "#2b2418";

type View = ReturnType<typeof buildAssinatura>;

/** Faixa de topo: aviso de isenção (cartão ok) ou alerta de cartão (recusado ou ausente). */
export function IsencaoBanner({ view, busy, onUpdateCard }: { view: View; busy: boolean; onUpdateCard: () => void }) {
  const status = view.cardCheck.status;
  const ok = status === "ok";
  const accent = ok ? OK : FAIL;
  const title = ok
    ? "Conta isenta de pagamento pelo ConciergeIA"
    : status === "failed"
      ? "Cartão obrigatório: a última verificação falhou"
      : "Cartão obrigatório: cadastre um cartão válido";
  const sub = ok
    ? `Você não paga mensalidade. Mantenha um cartão válido: conferimos todo dia 20 (próxima em ${fmtDayMonth(view.nextCardCheckAt)}).`
    : "Mesmo isenta, a conta precisa de um cartão válido. Atualize o cartão para regularizar.";
  return (
    <div
      role={ok ? "status" : "alert"}
      className="relative flex min-w-0 items-center gap-3 overflow-hidden rounded-[12px] py-3 pl-[20px] pr-[14px]"
      style={{
        background: `color-mix(in oklab, ${accent} 15%, var(--surface-elevated))`,
        boxShadow: `inset 0 0 0 1.5px ${accent}`,
      }}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0" style={{ width: 5, background: accent }} />
      <span className="grid shrink-0 place-items-center rounded-[10px]" style={{ width: 38, height: 38, background: accent, color: INK }}>
        {ok ? <Gift className="size-[18px]" strokeWidth={2.2} /> : <TriangleAlert className="size-[18px]" strokeWidth={2.2} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-bold leading-[1.3]">{title}</div>
        <p className="mt-0.5 text-[12.5px] font-medium leading-[1.4] text-muted-foreground">{sub}</p>
      </div>
      {ok ? (
        <span
          className="shrink-0 rounded-full text-[10.5px] font-extrabold tracking-[0.06em]"
          style={{ background: accent, color: INK, padding: "4px 11px" }}
        >
          ISENTA
        </span>
      ) : (
        <button
          type="button"
          onClick={onUpdateCard}
          disabled={busy}
          className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-gradient-to-br from-brand-purple to-brand-magenta text-[12.5px] font-bold text-white disabled:opacity-60"
          style={{ padding: "0 16px" }}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {status === "failed" ? "Atualizar cartão" : "Cadastrar cartão"}
        </button>
      )}
    </div>
  );
}

/** Etiqueta ao lado do cartão: Verificado (verde) ou Recusado (vermelho). Só para conta isenta. */
export function CardCheckTag({ view }: { view: View }) {
  if (!view.exempt || view.cardCheck.status === "missing") return null;
  return view.cardCheck.status === "ok" ? (
    <Tag tone="sage">Verificado</Tag>
  ) : (
    <Tag tone="rose" className="text-[color-mix(in_oklab,#c98c8c_45%,var(--foreground))]">
      Recusado
    </Tag>
  );
}

/** Selo das faturas isentas que já passaram. */
export function IsentaPill() {
  return (
    <span
      className="shrink-0 rounded-full text-[9.5px] font-extrabold tracking-[0.06em]"
      style={{ background: OK, color: INK, padding: "2px 8px" }}
    >
      ISENTA
    </span>
  );
}
