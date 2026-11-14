// Etapas do onboarding da conexão com o Airbnb (mockups abnbx-onb1/2/3), usadas na janela
// de conexão e no cartão do Dashboard.
import { Check } from "lucide-react";

export const ONB_TITLES = [
  "Autorizar a conta do Airbnb",
  "Escolher os anúncios",
  "Vincular proprietários",
  "Importar e sincronizar",
  "Finalizar a ativação",
] as const;

export const ONB_SUBS = [
  "",
  "",
  "Cada anúncio recebe um proprietário",
  "Cria os imóveis e liga o chat",
  "Só no modo Full: código na ferramenta de preços",
];

/** "N de 5 etapas" + porcentagem + barra de 5px. */
export function OnbProgress({ doneCount }: { doneCount: number }) {
  const pct = Math.round((100 * doneCount) / ONB_TITLES.length);
  return (
    <div className="grid gap-1.5">
      <div className="flex justify-between text-[11.5px] font-bold">
        <span className="text-muted-foreground">
          {doneCount} de {ONB_TITLES.length} etapas
        </span>
        <span className={pct === 100 ? "text-[#7fb79a]" : "text-foreground"}>{pct}%</span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-full bg-foreground/[0.08]">
        <div
          className="h-full bg-gradient-to-r from-brand-purple to-brand-magenta transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Uma etapa: feita (círculo verde com check), atual (número no degradê) ou futura (apagada). */
export function OnbStepRow({
  n,
  title,
  sub,
  state,
}: {
  n: number;
  title: string;
  sub: string;
  state: "done" | "current" | "todo";
}) {
  return (
    <div
      className={`flex items-center gap-[11px] rounded-md px-3 py-[11px] ${
        state === "current"
          ? "bg-foreground/[0.06] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_20%,transparent)]"
          : "bg-foreground/[0.03] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]"
      } ${state === "todo" ? "opacity-60" : ""}`}
    >
      <span
        aria-hidden
        className={`grid size-[22px] shrink-0 place-items-center rounded-full text-[11px] font-extrabold ${
          state === "done"
            ? "bg-[#7fb79a] text-white"
            : state === "current"
              ? "bg-gradient-to-br from-brand-purple to-brand-magenta text-white"
              : "text-muted-foreground shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_25%,transparent)]"
        }`}
      >
        {state === "done" ? <Check className="size-[11px]" strokeWidth={2.6} /> : n}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <b className="truncate text-[13px] font-bold">{title}</b>
        {sub ? <span className="truncate text-[11px] text-muted-foreground">{sub}</span> : null}
      </span>
    </div>
  );
}

export function OnbSteps({ done, subs }: { done: boolean[]; subs: string[] }) {
  const current = done.findIndex((d) => !d);
  return (
    <div className="grid gap-[7px]">
      {ONB_TITLES.map((t, i) => (
        <OnbStepRow
          key={t}
          n={i + 1}
          title={t}
          sub={subs[i] || ONB_SUBS[i]}
          state={done[i] ? "done" : i === current ? "current" : "todo"}
        />
      ))}
    </div>
  );
}
