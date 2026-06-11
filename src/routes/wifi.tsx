import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Copy, Check, Wifi } from "lucide-react";
import { property } from "@/lib/property";

export const Route = createFileRoute("/wifi")({
  head: () => ({ meta: [{ title: "Wi-Fi — SigmaGuide" }] }),
  component: WifiPage,
});

function WifiPage() {
  const [copied, setCopied] = useState<"ssid" | "pwd" | null>(null);
  const copy = async (val: string, kind: "ssid" | "pwd") => {
    try {
      await navigator.clipboard.writeText(val);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  };

  return (
    <div>
      <div className="px-4 pt-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
      </div>

      <header className="px-6 pt-6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">Conectividade</p>
        <h1 className="font-serif text-4xl leading-none">Wi-Fi</h1>
      </header>

      <section className="px-4 mt-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden bg-card border border-border rounded-3xl p-6 shadow-elevated"
        >
          <div className="absolute -top-12 -right-12 size-40 rounded-full bg-accent/15 blur-3xl pointer-events-none" />

          <div className="relative flex items-center gap-3 mb-6">
            <div className="size-10 rounded-xl bg-accent/15 grid place-items-center">
              <Wifi className="size-5 text-accent" strokeWidth={2} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-accent font-semibold">Ativo</p>
              <p className="text-sm text-muted-foreground">Sinal forte em toda a casa</p>
            </div>
          </div>

          <div className="relative space-y-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Rede</p>
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-base truncate">{property.wifi.ssid}</p>
                <button
                  onClick={() => copy(property.wifi.ssid, "ssid")}
                  className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium bg-secondary px-3 py-1.5 rounded-full"
                >
                  {copied === "ssid" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied === "ssid" ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>

            <div className="h-px bg-border" />

            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Senha</p>
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-base text-accent truncate">{property.wifi.password}</p>
                <button
                  onClick={() => copy(property.wifi.password, "pwd")}
                  className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium bg-accent text-accent-foreground px-3 py-1.5 rounded-full"
                >
                  {copied === "pwd" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied === "pwd" ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        <p className="mt-6 text-xs text-muted-foreground text-center">
          Problemas para conectar? Fale com o anfitrião na aba <Link to="/emergency" className="underline">Suporte</Link>.
        </p>
      </section>
    </div>
  );
}
