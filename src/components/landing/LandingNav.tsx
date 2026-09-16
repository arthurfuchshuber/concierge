import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import conciergeLogo from "@/assets/concierge-logo.png";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#produto", label: "Como funciona" },
  { href: "#para-quem", label: "Para quem é" },
  { href: "#planos", label: "Planos" },
  { href: "#contato", label: "Contato" },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 rounded-none border-b border-transparent bg-background/80 backdrop-blur-xl",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <a href="#topo" className="flex shrink-0 items-center gap-2.5">
          <img src={conciergeLogo} alt="ConciergeIA" className="size-7 object-contain" />
          <span className="font-display text-[15px] tracking-tight">ConciergeIA</span>
        </a>

        <nav className="hidden items-center gap-7 lg:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href="#contato"
            className="hidden h-9 items-center rounded-full bg-foreground px-4 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 sm:inline-flex"
          >
            Conhecer o ConciergeIA
          </a>
          <Link
            to="/auth"
            search={{ next: undefined }}
            className="hidden h-9 items-center rounded-full border border-border px-4 text-[13px] text-muted-foreground transition-colors hover:text-foreground lg:inline-flex"
          >
            Entrar
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            className="grid size-9 place-items-center rounded-full border border-border text-foreground lg:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border bg-background/95 backdrop-blur-xl lg:hidden">
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
              className="mt-2 inline-flex h-10 items-center justify-center rounded-full bg-foreground px-4 text-[13px] font-semibold text-background"
            >
              Conhecer o ConciergeIA
            </a>
            <Link
              to="/auth"
              search={{ next: undefined }}
              onClick={() => setOpen(false)}
              className="mt-1 inline-flex h-10 items-center justify-center rounded-full border border-border px-4 text-[13px] text-muted-foreground"
            >
              Entrar
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
