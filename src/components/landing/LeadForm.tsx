import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Loader2, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import { submitLandingLead } from "@/lib/landing-leads.functions";
import { Reveal, Section, GradientText } from "./primitives";
import cena from "@/assets/landing/scene-apto.jpg.asset.json";

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
  "h-14 w-full min-w-0 rounded-[10px] border border-white/10 bg-white/[0.05] px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-accent/60 focus:bg-white/[0.09]";

const labelClass = "text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80";


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
        <div className="relative min-w-0 overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.03] shadow-[0_40px_100px_-55px_rgba(0,0,0,1)] backdrop-blur-xl">
          <div className="grid min-w-0 lg:grid-cols-12">
            {/* Lado visual */}
            <div className="relative min-w-0 overflow-hidden p-7 sm:p-10 lg:col-span-5">
              <img
                src={cena.url}
                alt=""
                aria-hidden
                loading="lazy"
                className="absolute inset-0 size-full object-cover"
              />
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(150deg, rgba(10,10,15,0.92) 0%, rgba(10,10,15,0.78) 45%, rgba(124,26,216,0.35) 100%)",
                }}
              />
              <div className="relative min-w-0">
                <span
                  aria-hidden
                  className="block h-1 w-10 rounded-full"
                  style={{ background: "linear-gradient(90deg,#7c1ad8 0%,#e82dae 100%)" }}
                />
                <p className="mt-4 text-[10.5px] font-bold uppercase tracking-[0.28em] text-accent">Contato</p>
                <p className="mt-3 font-display text-[26px] font-extrabold leading-[1.1] tracking-tight text-balance sm:text-[32px]">
                  Leve o ConciergeIA <GradientText>para sua operação.</GradientText>
                </p>

                <p className="mt-4 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground text-pretty">
                  Conte um pouco sobre sua operação. Retornamos com uma apresentação alinhada ao seu
                  contexto.
                </p>

                <div className="mt-8 space-y-3">
                  <a
                    href="mailto:sigma@anfitriaosigma.com.br"
                    className="flex min-w-0 items-center gap-3 rounded-[10px] border border-white/10 bg-white/[0.05] p-3 transition-colors hover:border-accent/40"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05]">
                      <Mail className="size-4 text-accent" />
                    </span>
                    <span className="min-w-0 break-words text-[13px] text-muted-foreground">
                      sigma@anfitriaosigma.com.br
                    </span>
                  </a>
                  <a
                    href="https://wa.me/5545991070707"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 items-center gap-3 rounded-[10px] border border-white/10 bg-white/[0.05] p-3 transition-colors hover:border-accent/40"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05]">
                      <MessageCircle className="size-4 text-accent" />
                    </span>
                    <span className="min-w-0 text-[13px] text-muted-foreground">Falar pelo WhatsApp</span>
                  </a>
                </div>

                <p className="mt-8 flex min-w-0 items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground/70">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  <span className="min-w-0">
                    Seus dados são usados apenas para este contato. Nada de mensagens em massa.
                  </span>
                </p>
              </div>
            </div>

            {/* Formulário */}
            <div className="min-w-0 border-t border-white/10 p-7 sm:p-10 lg:col-span-7 lg:border-l lg:border-t-0">
              {status === "done" ? (
                <div className="py-14 text-center">
                  <span className="mx-auto grid size-12 place-items-center rounded-full bg-accent/12">
                    <Check className="size-5 text-accent" />
                  </span>
                  <p className="mt-5 font-display text-[19px] tracking-tight">
                    Recebemos seus dados. Em breve, entraremos em contato.
                  </p>
                </div>
              ) : (
                <form onSubmit={onSubmit} className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <label className="grid min-w-0 gap-2 sm:col-span-2">
                    <span className={labelClass}>Nome</span>
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

                  <label className="grid min-w-0 gap-2">
                    <span className={labelClass}>E-mail</span>
                    <input
                      required
                      type="email"
                      value={form.email}
                      onChange={(e) => set("email")(maskEmail(e.target.value))}
                      className={inputClass}
                      placeholder="voce@empresa.com.br"
                      autoComplete="email"
                      inputMode="email"
                    />
                    {erros.email ? (
                      <span className="text-[11px] text-destructive">{erros.email}</span>
                    ) : null}
                  </label>

                  <label className="grid min-w-0 gap-2">
                    <span className={labelClass}>WhatsApp</span>
                    <input
                      value={form.whatsapp}
                      onChange={(e) => set("whatsapp")(maskPhone(e.target.value))}
                      className={inputClass}
                      placeholder="(00) 00000-0000"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={15}
                    />
                    {erros.whatsapp ? (
                      <span className="text-[11px] text-destructive">{erros.whatsapp}</span>
                    ) : null}
                  </label>

                  <label className="grid min-w-0 gap-2">
                    <span className={labelClass}>Empresa / Operação</span>
                    <input
                      value={form.company}
                      onChange={(e) => set("company")(e.target.value)}
                      className={inputClass}
                      placeholder="Nome da operação"
                      autoComplete="organization"
                    />
                  </label>

                  <label className="grid min-w-0 gap-2">
                    <span className={labelClass}>Quantidade de imóveis</span>
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

                  <label className="grid min-w-0 gap-2 sm:col-span-2">
                    <span className={labelClass}>Principal desafio hoje (opcional)</span>
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
                      style={{ background: "linear-gradient(135deg,#e82dae 0%,#7c1ad8 100%)" }}
                      className="btn-shine inline-flex h-14 w-full min-w-0 items-center justify-center gap-2 rounded-[3px] px-6 text-[14.5px] font-bold uppercase tracking-[0.12em] text-accent-foreground shadow-[0_10px_34px_-10px_var(--accent)] transition-transform duration-200 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"

                    >
                      {status === "sending" ? (
                        <>
                          <Loader2 className="size-4 animate-spin" /> Enviando…
                        </>
                      ) : (
                        <>
                          Quero conhecer o ConciergeIA <ArrowRight className="size-4 shrink-0" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
