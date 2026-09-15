import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { submitLandingLead } from "@/lib/landing-leads.functions";
import { Reveal, Section, SectionHeading, Surface } from "./primitives";

const PROPERTY_RANGES = ["1 a 5", "6 a 10", "11 a 30", "31 a 100", "Mais de 100"];
const CHALLENGES = [
  "Organização da operação",
  "Atendimento ao hóspede",
  "Gestão de informações",
  "Padronização",
  "Gestão de múltiplos imóveis",
  "Outro",
];

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-background/60 px-3.5 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent/60";

/** Telefone brasileiro: (00) 0000-0000 e (00) 00000-0000. */
function maskPhone(input: string): string {
  const d = input.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Nome: só letras, espaços e acentos; cada palavra com inicial maiúscula. */
function maskName(input: string): string {
  return input
    .replace(/[^\p{L}\s'.-]/gu, "")
    .replace(/\s{2,}/g, " ")
    .replace(/(^|\s)(\p{L})/gu, (_m, sep: string, letter: string) => sep + letter.toUpperCase())
    .slice(0, 120);
}

function maskEmail(input: string): string {
  return input.replace(/\s/g, "").toLowerCase().slice(0, 160);
}

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

export function LeadForm() {
  const send = useServerFn(submitLandingLead);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [erros, setErros] = useState<{ name?: string; email?: string; whatsapp?: string }>({});
  const [form, setForm] = useState({
    name: "",
    company: "",
    propertiesCount: "",
    whatsapp: "",
    email: "",
    challenge: "",
  });

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "sending") return;

    const digitos = form.whatsapp.replace(/\D/g, "");
    const novosErros: typeof erros = {};
    if (form.name.trim().length < 2) novosErros.name = "Informe seu nome.";
    if (!EMAIL_RE.test(form.email.trim())) novosErros.email = "Informe um e-mail válido.";
    if (digitos && (digitos.length < 10 || digitos.length > 11))
      novosErros.whatsapp = "Informe o DDD e o número completo.";
    setErros(novosErros);
    if (Object.keys(novosErros).length > 0) return;

    setStatus("sending");
    try {
      await send({ data: { ...form, name: form.name.trim(), email: form.email.trim() } });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <Section id="contato">
      <Reveal>
        <SectionHeading
          eyebrow="Contato"
          title="Conheça o ConciergeIA de perto."
          description="Conte um pouco sobre sua operação. Retornamos com uma apresentação alinhada ao seu contexto."
        />
      </Reveal>

      <Reveal delay={0.08}>
        <Surface className="mx-auto mt-12 max-w-2xl p-6 sm:p-8">
          {status === "done" ? (
            <div className="py-10 text-center">
              <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent/12">
                <Check className="size-5 text-accent" />
              </span>
              <p className="mt-5 font-display text-[19px] tracking-tight">
                Recebemos seus dados. Em breve, entraremos em contato.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 sm:col-span-1">
                <span className="text-[11.5px] text-muted-foreground">Nome</span>
                <input
                  required
                  value={form.name}
                  onChange={(e) => set("name")(maskName(e.target.value))}
                  className={inputClass}
                  placeholder="Seu nome"
                  autoComplete="name"
                />
                {erros.name ? (
                  <span className="text-[11px] text-destructive">{erros.name}</span>
                ) : null}
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11.5px] text-muted-foreground">Empresa / Operação</span>
                <input
                  value={form.company}
                  onChange={(e) => set("company")(e.target.value)}
                  className={inputClass}
                  placeholder="Nome da operação"
                  autoComplete="organization"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11.5px] text-muted-foreground">Quantidade de imóveis</span>
                <select
                  value={form.propertiesCount}
                  onChange={(e) => set("propertiesCount")(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Selecione</option>
                  {PROPERTY_RANGES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5">
                <span className="text-[11.5px] text-muted-foreground">WhatsApp</span>
                <input
                  value={form.whatsapp}
                  onChange={(e) => set("whatsapp")(e.target.value)}
                  className={inputClass}
                  placeholder="(00) 00000-0000"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </label>

              <label className="grid gap-1.5 sm:col-span-2">
                <span className="text-[11.5px] text-muted-foreground">E-mail</span>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email")(e.target.value)}
                  className={inputClass}
                  placeholder="voce@empresa.com.br"
                  autoComplete="email"
                />
              </label>

              <label className="grid gap-1.5 sm:col-span-2">
                <span className="text-[11.5px] text-muted-foreground">
                  Qual é o seu principal desafio hoje? (opcional)
                </span>
                <select
                  value={form.challenge}
                  onChange={(e) => set("challenge")(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Selecione</option>
                  {CHALLENGES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              {status === "error" ? (
                <p className="text-[12.5px] text-destructive sm:col-span-2">
                  Não foi possível enviar agora. Tente novamente em instantes.
                </p>
              ) : null}

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={status === "sending"}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[14px] font-semibold text-background transition-transform duration-200 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60 sm:w-auto"
                >
                  {status === "sending" ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Enviando…
                    </>
                  ) : (
                    <>
                      Quero conhecer o ConciergeIA <ArrowRight className="size-4" />
                    </>
                  )}
                </button>
                <p className="mt-3 text-[11px] text-muted-foreground/70">
                  Seus dados são usados apenas para este contato. Nada de mensagens em massa.
                </p>
              </div>
            </form>
          )}
        </Surface>
      </Reveal>
    </Section>
  );
}
