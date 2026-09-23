import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import conciergeLogo from "@/assets/concierge-logo.png";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#como", label: "Como funciona" },
  { href: "#para-quem", label: "Para quem é" },
  { href: "#planos", label: "Planos" },
  { href: "#faq", label: "Dúvidas" },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 rounded-none border-b border-white/[0.07] bg-[#0e0b09]/85 backdrop-blur-xl",
      )}
    >
      {/* Computador: 3 colunas iguais, então os links ficam no centro exato da tela
          (antes o `justify-between` os deixava 76 px à esquerda). */}
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-8 lg:grid lg:h-[72px] lg:grid-cols-3 xl:px-0">
        <a href="#topo" className="flex shrink-0 items-center gap-2.5 justify-self-start">
          <img src={conciergeLogo} alt="ConciergeIA" className="size-7 object-contain" />
          <span className="font-display text-[16px] font-bold tracking-tight">ConciergeIA</span>
        </a>

        <nav className="hidden items-center justify-center gap-9 lg:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[14px] whitespace-nowrap text-[#a9a39b] transition-colors hover:text-white"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-3">
          <Link
            to="/auth"
            search={{ next: undefined }}
            className="hidden h-10 items-center rounded-full border border-white/[0.12] px-[18px] text-[14px] text-[#d9d4ce] transition-colors hover:text-white lg:inline-flex"
          >
            Entrar
          </Link>
          <a
            href="#contato"
            className="hidden h-10 items-center rounded-full bg-[#f6f3ef] px-5 text-[14px] font-bold whitespace-nowrap text-[#0e0b09] transition-opacity hover:opacity-90 sm:inline-flex"
          >
            Agendar demonstração
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            className="grid size-11 place-items-center rounded-full border border-white/[0.12] text-[#f6f3ef] lg:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-white/[0.07] bg-[#0e0b09]/95 backdrop-blur-xl lg:hidden">
          <nav className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-5 py-4 sm:px-8">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              >
                {l.label}
              </a>
            ))}
            <a
              href="#contato"
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex h-12 items-center justify-center rounded-[14px] bg-[linear-gradient(100deg,#8b2be2,#e82dae)] px-4 text-[15px] font-bold text-white"
            >
              Agendar demonstração
            </a>
            <Link
              to="/auth"
              search={{ next: undefined }}
              onClick={() => setOpen(false)}
              className="mt-1 inline-flex h-12 items-center justify-center rounded-[14px] border border-white/[0.14] px-4 text-[15px] text-[#d9d4ce]"
            >
              Entrar
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
