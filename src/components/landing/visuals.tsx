import { Bot, CheckCircle2, Wrench, BookOpen, Building2, Users } from "lucide-react";

/**
 * Peças visuais do produto usadas na landing.
 * São componentes React (não imagens), para ficarem nítidos em qualquer tela
 * e nunca estourarem a margem direita (`min-w-0` + larguras fluidas).
 */

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-background/60 p-3 backdrop-blur">
      {children}
    </div>
  );
}

/** Conversa da IA com o hóspede. */
export function ChatVisual() {
  return (
    <Frame>
      <div className="flex items-center gap-2 border-b border-white/5 pb-2.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-accent/15">
          <Bot className="size-3.5 text-accent" />
        </span>
        <p className="min-w-0 truncate text-[11px] font-semibold">Atendimento IA</p>
        <span className="ml-auto shrink-0 rounded-full bg-accent/12 px-2 py-0.5 text-[9.5px] text-accent">
          ao vivo
        </span>
      </div>
      <div className="mt-3 space-y-2">
        <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-sm bg-white/8 px-3 py-2 text-[11px] text-muted-foreground">
          Qual é a senha do wi-fi?
        </p>
        <p className="w-fit max-w-[88%] rounded-2xl rounded-bl-sm border border-accent/25 bg-accent/10 px-3 py-2 text-[11px] text-foreground">
          A rede é <span className="font-semibold">Beira-Mar 201</span> e a senha está no guia da casa.
        </p>
        <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-sm bg-white/8 px-3 py-2 text-[11px] text-muted-foreground">
          Posso fazer o check-in mais cedo?
        </p>
        <div className="flex items-center gap-1.5 pl-1 pt-0.5">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          <span className="size-1.5 animate-pulse rounded-full bg-accent/60" />
          <span className="size-1.5 animate-pulse rounded-full bg-accent/30" />
        </div>
      </div>
    </Frame>
  );
}

/** Rotinas do dia. */
export function TasksVisual() {
  const rows = [
    { t: "Limpeza — Apto 402", d: "Concluída 11:20", done: true },
    { t: "Check-in — Cobertura Beira-Mar", d: "Hoje, 15:00", done: true },
    { t: "Troca de enxoval — Casa Jardim Sul", d: "Pendente", done: false },
  ];
  return (
    <Frame>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.t}
            className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5"
          >
            <CheckCircle2
              className={`size-4 shrink-0 ${r.done ? "text-accent" : "text-muted-foreground/40"}`}
            />
            <div className="min-w-0">
              <p className="truncate text-[11.5px] font-medium">{r.t}</p>
              <p className="truncate text-[10px] text-muted-foreground">{r.d}</p>
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Guia do hóspede em formato de celular. */
export function GuideVisual() {
  return (
    <div className="mx-auto w-[150px] min-w-0 rounded-[22px] border border-white/12 bg-background/70 p-2 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.95)] backdrop-blur">
      <div className="overflow-hidden rounded-[16px] border border-white/8">
        <div
          className="h-14 w-full"
          style={{ background: "linear-gradient(135deg,#7c1ad8 0%,#e82dae 100%)", opacity: 0.6 }}
        />
        <div className="space-y-2 p-2.5">
          <p className="text-[10px] font-semibold">Cobertura Beira-Mar</p>
          <div className="h-1.5 w-full rounded-full bg-white/10" />
          <div className="h-1.5 w-4/5 rounded-full bg-white/10" />
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            {["Wi-fi", "Acesso", "Regras", "Dicas"].map((k) => (
              <div
                key={k}
                className="rounded-lg border border-white/8 bg-white/[0.03] px-1.5 py-2 text-center text-[8.5px] text-muted-foreground"
              >
                {k}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Imóveis e proprietários. */
export function PortfolioVisual() {
  const rows = [
    { n: "Cobertura Beira-Mar", o: "Ana R." },
    { n: "Apto 402 — Centro", o: "Carlos M." },
    { n: "Casa Jardim Sul", o: "Helena T." },
  ];
  return (
    <Frame>
      <div className="grid grid-cols-3 gap-2">
        {[
          { k: "Imóveis", v: "12", i: Building2 },
          { k: "Proprietários", v: "9", i: Users },
          { k: "Fornecedores", v: "18", i: Wrench },
        ].map((s) => (
          <div key={s.k} className="min-w-0 rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
            <s.i className="size-3.5 text-accent" />
            <p className="mt-2 font-display text-[15px] leading-none">{s.v}</p>
            <p className="mt-1 truncate text-[9.5px] text-muted-foreground">{s.k}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.n}
            className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2"
          >
            <p className="min-w-0 truncate text-[11px]">{r.n}</p>
            <p className="shrink-0 text-[9.5px] text-muted-foreground">{r.o}</p>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Registro de manutenção. */
export function MaintenanceVisual() {
  return (
    <Frame>
      <div className="flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-accent/15">
          <Wrench className="size-3.5 text-accent" />
        </span>
        <p className="min-w-0 truncate text-[11px] font-semibold">Manutenção — Studio Estação</p>
      </div>
      <div className="mt-3 space-y-2">
        {["Chamado aberto", "Fornecedor acionado", "Serviço concluído"].map((s, i) => (
          <div key={s} className="flex items-center gap-2.5">
            <span
              className={`size-2 shrink-0 rounded-full ${i < 2 ? "bg-accent" : "bg-muted-foreground/30"}`}
            />
            <p className="min-w-0 truncate text-[10.5px] text-muted-foreground">{s}</p>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Conhecimento centralizado. */
export function KnowledgeVisual() {
  return (
    <Frame>
      <div className="flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-accent/15">
          <BookOpen className="size-3.5 text-accent" />
        </span>
        <p className="min-w-0 truncate text-[11px] font-semibold">Base de conhecimento</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["Acessos", "Wi-fi", "Estacionamento", "Regras", "Enxoval", "Contatos", "Recomendações"].map(
          (t) => (
            <span
              key={t}
              className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[9.5px] text-muted-foreground"
            >
              {t}
            </span>
          ),
        )}
      </div>
    </Frame>
  );
}
