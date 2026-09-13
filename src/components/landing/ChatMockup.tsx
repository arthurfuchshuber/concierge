import { Bot, Database } from "lucide-react";
import { Surface } from "./primitives";

const CONVERSA: Array<{ de: "hospede" | "ia"; texto: string; fonte?: string }> = [
  { de: "hospede", texto: "Como faço o check-out?" },
  {
    de: "ia",
    texto:
      "Seu check-out é até 11h. Antes de sair, pedimos que deixe as chaves sobre a bancada da cozinha, feche as janelas e descarte o lixo no coletor da garagem.",
    fonte: "Instruções do imóvel · Check-out",
  },
  { de: "hospede", texto: "Tem mercado próximo?" },
  {
    de: "ia",
    texto:
      "Sim. O supermercado Beira-Mar fica a aproximadamente 400 metros, na mesma rua do prédio, e abre das 7h às 22h.",
    fonte: "Recomendações cadastradas · Mercados",
  },
];

export function ChatMockup() {
  return (
    <Surface className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="grid size-7 place-items-center rounded-lg bg-accent/12">
          <Bot className="size-3.5 text-accent" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold">ConciergeIA</p>
          <p className="truncate text-[10.5px] text-muted-foreground">
            Respondendo com o conhecimento da sua operação
          </p>
        </div>
      </div>

      <div className="space-y-3 p-4 sm:p-5">
        {CONVERSA.map((m, i) => (
          <div key={i} className={m.de === "hospede" ? "flex justify-end" : "flex justify-start"}>
            <div className="max-w-[85%]">
              <div
                className={
                  m.de === "hospede"
                    ? "rounded-2xl rounded-br-md border border-border bg-background/60 px-3.5 py-2.5 text-[13px] leading-relaxed"
                    : "rounded-2xl rounded-bl-md border border-accent/25 bg-accent/8 px-3.5 py-2.5 text-[13px] leading-relaxed"
                }
              >
                {m.texto}
              </div>
              {m.fonte ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  <Database className="size-3 shrink-0" />
                  <span className="min-w-0 truncate">{m.fonte}</span>
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}
