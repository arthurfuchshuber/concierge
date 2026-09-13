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
      <h2 className="mt-4 font-display text-[27px] leading-[1.12] tracking-tight text-balance sm:text-[42px]">
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
        "relative rounded-2xl border border-border bg-card/60 backdrop-blur-sm",
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
