import { motion, useReducedMotion } from "framer-motion";
import {
  Building2,
  Users,
  Wrench,
  Boxes,
  FileText,
  Bot,
  BookOpen,
  Search,
} from "lucide-react";

const NAV = [
  { icon: Building2, label: "Imóveis" },
  { icon: Users, label: "Proprietários" },
  { icon: Wrench, label: "Fornecedores" },
  { icon: Boxes, label: "Inventário" },
  { icon: FileText, label: "Registros" },
  { icon: Bot, label: "Atendimento IA" },
  { icon: BookOpen, label: "Guia do hóspede" },
];

const ROWS = [
  { name: "Cobertura Beira-Mar", meta: "Proprietário: Ana R.", tag: "Instruções completas" },
  { name: "Apto 402 — Centro", meta: "Proprietário: Carlos M.", tag: "Inventário atualizado" },
  { name: "Casa Jardim Sul", meta: "Proprietário: Helena T.", tag: "Manutenção agendada" },
  { name: "Studio Estação", meta: "Proprietário: Rafael D.", tag: "Guia publicado" },
];

/** Simulação do painel — estática, apenas ilustrativa. */
export function DashboardMockup() {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-card/80 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.95)] backdrop-blur">
        {/* Barra superior */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex gap-1.5" aria-hidden>
            <span className="size-2 rounded-full bg-muted-foreground/30" />
            <span className="size-2 rounded-full bg-muted-foreground/30" />
            <span className="size-2 rounded-full bg-muted-foreground/30" />
          </div>
          <div className="ml-1 flex h-7 flex-1 items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5">
            <Search className="size-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">Buscar imóvel, proprietário, fornecedor…</span>
          </div>
        </div>

        <div className="grid grid-cols-[auto_minmax(0,1fr)]">
          {/* Menu lateral */}
          <nav className="hidden w-[188px] shrink-0 border-r border-border p-3 sm:block">
            {NAV.map((item, i) => (
              <div
                key={item.label}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] ${
                  i === 0 ? "bg-accent/12 text-foreground" : "text-muted-foreground"
                }`}
              >
                <item.icon className={`size-3.5 ${i === 0 ? "text-accent" : ""}`} />
                <span className="truncate">{item.label}</span>
              </div>
            ))}
          </nav>

          {/* Conteúdo */}
          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-accent">Operação</p>
                <p className="mt-1 truncate font-display text-[15px]">Imóveis</p>
              </div>
              <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[10.5px] text-muted-foreground">
                12 ativos
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { k: "Fornecedores", v: "18" },
                { k: "Itens no inventário", v: "437" },
                { k: "Registros no mês", v: "96" },
              ].map((s) => (
                <div key={s.k} className="rounded-xl border border-border bg-background/50 p-2.5">
                  <p className="font-display text-[16px] leading-none">{s.v}</p>
                  <p className="mt-1.5 text-[10px] leading-tight text-muted-foreground">{s.k}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 space-y-1.5">
              {ROWS.map((r, i) => (
                <motion.div
                  key={r.name}
                  initial={reduce ? false : { opacity: 0, x: 12 }}
                  animate={reduce ? undefined : { opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: 0.4 + i * 0.09 }}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium">{r.name}</p>
                    <p className="truncate text-[10.5px] text-muted-foreground">{r.meta}</p>
                  </div>
                  <span className="hidden shrink-0 rounded-full bg-accent/12 px-2 py-0.5 text-[10px] text-accent sm:inline">
                    {r.tag}
                  </span>
                </motion.div>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-border bg-background/40 px-3 py-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/12">
                <Bot className="size-3.5 text-accent" />
              </span>
              <p className="min-w-0 text-[11px] leading-snug text-muted-foreground">
                <span className="text-foreground">Atendimento IA</span> respondeu 14 dúvidas de hóspedes com base
                no conhecimento cadastrado.
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
