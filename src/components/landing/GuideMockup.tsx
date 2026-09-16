import { Wifi, DoorOpen, LogOut, Sparkles, MapPin, Phone } from "lucide-react";

const CATEGORIAS = [
  "Bem-vindo",
  "Sobre o imóvel",
  "Check-in",
  "Check-out",
  "Regras",
  "Wi-Fi",
  "Equipamentos",
  "Recomendações",
  "Restaurantes",
  "Experiências",
  "Contatos importantes",
];

const DESTAQUES = [
  { icon: DoorOpen, label: "Check-in", value: "a partir das 15h" },
  { icon: LogOut, label: "Check-out", value: "até 11h" },
  { icon: Wifi, label: "Wi-Fi", value: "rede e senha no guia" },
];

export function GuideMockup() {
  return (
    <div className="relative mx-auto w-full max-w-[320px]">
      <div className="overflow-hidden rounded-[2rem] border border-border bg-card/80 p-2 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.95)] backdrop-blur">
        <div className="overflow-hidden rounded-[1.6rem] border border-border bg-background">
          {/* Capa */}
          <div className="relative px-5 pb-5 pt-7">
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.22]"
              style={{ background: "linear-gradient(160deg, #7c1ad8 0%, transparent 62%)" }}
            />
            <div className="relative">
              <p className="text-[9.5px] font-bold uppercase tracking-[0.26em] text-accent">Guia do hóspede</p>
              <p className="mt-2 font-display text-[19px] leading-tight">Cobertura Beira-Mar</p>
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                <MapPin className="size-3 shrink-0" /> Balneário Camboriú · SC
              </p>
            </div>
          </div>

          <div className="space-y-2 px-4 pb-4">
            {DESTAQUES.map((d) => (
              <div
                key={d.label}
                className="flex items-center gap-2.5 rounded-xl border border-border bg-card/60 px-3 py-2.5"
              >
                <d.icon className="size-3.5 shrink-0 text-accent" />
                <p className="min-w-0 text-[11.5px]">
                  <span className="text-foreground">{d.label}</span>{" "}
                  <span className="text-muted-foreground">— {d.value}</span>
                </p>
              </div>
            ))}

            <div className="rounded-xl border border-border bg-card/60 px-3 py-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
                <Sparkles className="size-3" /> Seções
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {CATEGORIAS.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-border px-2.5 py-1 text-[10.5px] text-muted-foreground"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2.5 rounded-xl border border-accent/25 bg-accent/8 px-3 py-2.5">
              <Phone className="size-3.5 shrink-0 text-accent" />
              <p className="min-w-0 text-[11px] leading-snug text-muted-foreground">
                Contatos importantes sempre à mão, do zelador ao suporte da operação.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
