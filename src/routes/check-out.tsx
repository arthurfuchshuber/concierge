import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Star } from "lucide-react";
import { property } from "@/lib/property";

export const Route = createFileRoute("/check-out")({
  head: () => ({ meta: [{ title: "Check-out — SigmaGuide" }] }),
  component: CheckOutPage,
});

function CheckOutPage() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [completed, setCompleted] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const toggle = (id: string) => setChecked((c) => ({ ...c, [id]: !c[id] }));
  const allDone = property.checkOut.checklist.every((i) => checked[i.id]);

  return (
    <div>
      <div className="px-4 pt-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
      </div>

      <header className="px-6 pt-6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">Partida</p>
        <h1 className="font-serif text-4xl leading-none">Check-out</h1>
        <p className="mt-3 text-sm text-muted-foreground">Saída até <span className="font-mono">{property.checkOut.time}</span>. Marque cada item para finalizar.</p>
      </header>

      <section className="px-4 mt-6 space-y-2">
        {property.checkOut.checklist.map((item, i) => {
          const isChecked = !!checked[item.id];
          return (
            <motion.button
              key={item.id}
              onClick={() => toggle(item.id)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className={`w-full text-left flex items-center gap-3 p-4 rounded-2xl border transition-colors ${
                isChecked ? "bg-accent/10 border-accent/30" : "bg-card border-border"
              }`}
            >
              <div className={`size-6 rounded-full grid place-items-center shrink-0 transition-colors ${
                isChecked ? "bg-accent text-accent-foreground" : "bg-secondary"
              }`}>
                {isChecked && <Check className="size-3.5" strokeWidth={3} />}
              </div>
              <span className={`text-sm flex-1 ${isChecked ? "line-through text-muted-foreground" : ""}`}>{item.label}</span>
            </motion.button>
          );
        })}
      </section>

      <section className="px-4 mt-6">
        <button
          onClick={() => setCompleted(true)}
          disabled={!allDone || completed}
          className="w-full bg-primary text-primary-foreground rounded-full py-4 text-sm font-medium disabled:opacity-40 transition-all active:scale-[0.98]"
        >
          {completed ? "Check-out concluído ✓" : allDone ? "Concluir check-out" : `Marque os ${property.checkOut.checklist.length} itens`}
        </button>
      </section>

      {completed && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 mt-8"
        >
          <div className="bg-card border border-border rounded-2xl p-6 text-center">
            <h2 className="font-serif text-2xl leading-tight mb-2">Como foi sua estadia?</h2>
            <p className="text-sm text-muted-foreground mb-5">Sua opinião ajuda o anfitrião a melhorar.</p>
            <div className="flex items-center justify-center gap-2 mb-4">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setRating(n)} className="p-1">
                  <Star
                    className={`size-8 transition-all ${
                      rating && n <= rating ? "fill-accent text-accent scale-110" : "text-muted-foreground"
                    }`}
                    strokeWidth={1.5}
                  />
                </button>
              ))}
            </div>
            {rating !== null && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-muted-foreground"
              >
                {rating >= 4
                  ? "Obrigado! Você será direcionado para deixar sua avaliação no Airbnb."
                  : "Sentimos muito. Vamos abrir um formulário para você nos contar mais."}
              </motion.p>
            )}
          </div>
        </motion.section>
      )}
    </div>
  );
}
