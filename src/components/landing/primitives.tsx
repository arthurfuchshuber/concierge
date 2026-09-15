import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/** Animação de entrada ao rolar — discreta, e desligada quando o sistema pede menos movimento. */
export function Reveal({
  children,
  delay = 0,
  className,
  as: _as,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: never;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Espaçamento vertical padrão das seções da landing. */
export function Section({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("py-24 sm:py-32", className)}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">{children}</div>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10.5px] font-bold uppercase tracking-[0.28em] text-accent">{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
}) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center")}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="mt-4 font-display text-[27px] leading-[1.5] tracking-tight text-balance sm:text-[42px]">
        {title}
      </h2>
      {description ? (
        <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground text-pretty sm:text-[17px]">
          {description}
        </p>
      ) : null}
    </div>
  );
}

/** Superfície de card padrão: borda delicada, profundidade sutil. */
export function Surface({
  children,
  className,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative rounded-3xl border border-border bg-card/60 backdrop-blur-sm",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_18px_40px_-28px_rgba(0,0,0,0.9)]",
        hover &&
          "transition-[transform,border-color,background-color] duration-300 hover:-translate-y-0.5 hover:border-accent/35 hover:bg-card/85",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Texto em degradê da marca (roxo → magenta), com reflexo opcional em movimento. */
export function GradientText({
  children,
  className,
  shine = false,
}: {
  children: ReactNode;
  className?: string;
  shine?: boolean;
}) {
  const gradiente = (
    <span
      className={cn("bg-clip-text text-transparent", className)}
      style={{ backgroundImage: "linear-gradient(100deg,#7c1ad8 0%,#e82dae 52%,#7c1ad8 100%)" }}
    >
      {children}
    </span>
  );
  if (!shine) return gradiente;
  return (
    <span className="relative inline-block">
      {gradiente}
      <span
        aria-hidden
        className={cn(
          "text-shine-overlay pointer-events-none absolute inset-0 bg-clip-text text-transparent",
          className,
        )}
      >
        {children}
      </span>
    </span>
  );
}



/**
 * Cartão da grade bento: borda delicada, brilho suave no canto e realce
 * discreto no hover. Usa `min-w-0` para nunca estourar a margem direita.
 */
export function BentoCard({
  children,
  className,
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col overflow-hidden rounded-3xl border border-border bg-card/60 p-6 backdrop-blur-sm sm:p-8",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_28px_60px_-40px_rgba(0,0,0,0.95)]",
        "transition-[border-color,background-color,transform] duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-card/85",
        className,
      )}
    >
      {glow ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full opacity-25 blur-3xl transition-opacity duration-500 group-hover:opacity-45"
          style={{ background: "linear-gradient(135deg,#7c1ad8 0%,#e82dae 100%)" }}
        />
      ) : null}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/** Brilho de marca extremamente discreto usado como fundo de seção. */
export function Glow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute -z-10 rounded-full blur-[120px] opacity-[0.18]",
        className,
      )}
      style={{ background: "linear-gradient(135deg, #7c1ad8 0%, #e82dae 100%)" }}
    />
  );
}

/**
 * Painel de vidro: borda clara, desfoque de fundo e contorno em degradê
 * opcional. `min-w-0` + `overflow-hidden` garantem que nada corte na margem.
 */
export function GlassCard({
  children,
  className,
  edge = false,
}: {
  children: ReactNode;
  className?: string;
  edge?: boolean;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      {edge ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-px rounded-[26px] opacity-40 blur-[6px]"
          style={{ background: "linear-gradient(120deg,#7c1ad8 0%,#e82dae 100%)" }}
        />
      ) : null}
      <div
        className={cn(
          "relative flex h-full min-w-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.035] p-5 backdrop-blur-xl sm:p-6",
          "shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_30px_70px_-45px_rgba(0,0,0,0.95)]",
          "transition-[border-color,background-color,transform] duration-300 hover:-translate-y-0.5 hover:border-accent/35 hover:bg-white/[0.06]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

