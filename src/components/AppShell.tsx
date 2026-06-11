import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Compass, Sparkles, LifeBuoy } from "lucide-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

const navItems = [
  { to: "/", label: "Início", icon: Home, match: (p: string) => p === "/" },
  { to: "/concierge", label: "Guia", icon: Compass, match: (p: string) => p.startsWith("/concierge") || p.startsWith("/manual") || p.startsWith("/wifi") || p.startsWith("/check") },
  { to: "/chat", label: "Concierge IA", icon: Sparkles, match: (p: string) => p.startsWith("/chat") },
  { to: "/emergency", label: "Suporte", icon: LifeBuoy, match: (p: string) => p.startsWith("/emergency") || p.startsWith("/faq") },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md min-h-screen pb-28 relative">
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.main>
      </div>

      <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
        <div className="glass rounded-full border border-border shadow-elevated px-2 py-2 flex items-center justify-between">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.match(pathname);
            return (
              <Link
                key={item.to}
                to={item.to}
                className="relative flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-full"
              >
                {active && (
                  <motion.div
                    layoutId="nav-active"
                    className="absolute inset-0 bg-primary rounded-full"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <div className="relative flex flex-col items-center gap-0.5">
                  <Icon className={`size-[18px] ${active ? "text-primary-foreground" : "text-muted-foreground"}`} strokeWidth={1.75} />
                  <span className={`text-[9px] tracking-wide font-medium ${active ? "text-primary-foreground" : "text-muted-foreground"}`}>
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <header className="px-6 pt-10 pb-6">
      {eyebrow && (
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">{eyebrow}</p>
      )}
      <h1 className="font-serif text-4xl leading-none text-balance">{title}</h1>
      {subtitle && <p className="mt-3 text-sm text-muted-foreground text-pretty leading-relaxed">{subtitle}</p>}
    </header>
  );
}
