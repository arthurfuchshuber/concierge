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

/**
 * Espaçamento vertical padrão das seções da landing.
 *
 * Grade única (17/09/2026): conteúdo em 1200 px e a MESMA distância entre
 * todas as seções (88 px no celular, 136 px no computador). Antes cada seção
 * tinha `py-32` em cima e embaixo, o que deixava ~256 px vazios entre blocos.
 */
export function Section({
  id,
  children,
  className,
  innerClassName,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <section
      id={id}
      className={cn("relative scroll-mt-16 pt-[88px] lg:scroll-mt-20 lg:pt-[136px]", className)}
    >
      <div
        className={cn(
          "relative mx-auto w-full max-w-[1200px] px-5 sm:px-8 xl:px-0",
          innerClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "text-[11px] font-bold uppercase tracking-[0.24em] text-[#e97bd6] lg:text-[12px]",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Título de seção. Escala única: 32 px no celular e 48 px no computador, com
 * altura de linha 1.1 — antes era 1.5, e o título de duas linhas ficava
 * "solto". (17/09/2026: o cliente voltou o celular de 24 para 32 px.)
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="relative mx-auto max-w-[820px] text-center">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="mt-4 font-display text-[32px] font-bold leading-[1.12] tracking-[-0.025em] text-balance lg:mt-5 lg:text-[48px] lg:leading-[1.1] lg:tracking-[-0.03em]">
        {title}
      </h2>
      {description ? (
        <p className="mx-auto mt-3.5 max-w-[600px] text-[15px] leading-relaxed text-[#a9a39b] text-pretty lg:mt-5 lg:text-[18px]">
          {description}
        </p>
      ) : null}
    </div>
  );
}
