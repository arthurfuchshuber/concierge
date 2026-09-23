import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2 } from "lucide-react";
import { submitLandingLead } from "@/lib/landing-leads.functions";
import { Reveal, Section } from "./primitives";

const PROPERTY_RANGES = ["1 a 5", "6 a 10", "11 a 30", "31 a 100", "Mais de 100"];
const CHALLENGES = [
  "Organização da operação",
  "Atendimento ao hóspede",
  "Gestão de informações",
  "Padronização",
  "Gestão de múltiplos imóveis",
  "Outro",
];

// 16 px no celular: abaixo disso o Safari do iPhone dá zoom ao focar o campo.
// `[&>option]` evita texto branco em fundo branco na lista nativa (Windows/Android).
const inputClass =
  "h-[52px] w-full min-w-0 rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 text-[16px] text-[#f6f3ef] outline-none transition-colors placeholder:text-[#f6f3ef]/45 focus:border-[#e82dae]/60 focus:bg-white/[0.07] lg:text-[15px] [&>option]:bg-[#15110f] [&>option]:text-[#f6f3ef]";

const labelClass = "text-[13px] font-semibold text-[#cfc9c2]";

const PROXIMOS_PASSOS = [
  "Apresentação com a sua operação real",
  "Tire dúvidas direto com o time",
  "Sem compromisso",
];

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
    <Section id="contato" className="!pt-6">
      <Reveal>
        <div className="grid min-w-0 overflow-hidden rounded-[28px] border border-white/10 lg:grid-cols-2 lg:rounded-[32px]">
          {/* Painel da marca: círculos finos e uma luz que se move devagar */}
          <div className="relative flex min-w-0 flex-col justify-center overflow-hidden bg-[linear-gradient(150deg,#1c1024_0%,#2a0f33_55%,#4a1150_100%)] px-6 py-8 lg:p-14">
            <div
              aria-hidden
              className="lp-drift pointer-events-none absolute -right-[100px] -bottom-[120px] size-[280px] rounded-full lg:-right-[120px] lg:-bottom-[140px] lg:size-[420px]"
              style={{
                background:
                  "radial-gradient(closest-side, rgba(232,45,174,0.55), rgba(232,45,174,0))",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -top-[90px] -right-[90px] size-[240px] rounded-full border border-white/10 lg:-top-[160px] lg:-right-[160px] lg:size-[440px]"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -top-[50px] -right-[50px] size-[160px] rounded-full border border-white/[0.07] lg:-top-[100px] lg:-right-[100px] lg:size-[320px]"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -top-[40px] -right-[40px] hidden size-[200px] rounded-full border border-white/[0.06] lg:block"
            />

            <p className="relative text-[11px] font-bold uppercase tracking-[0.24em] text-[#f0a6e4] lg:text-[12px]">
              Demonstração
            </p>
            <h2 className="relative mt-3.5 font-display text-[30px] font-bold leading-[1.12] tracking-[-0.025em] lg:mt-5 lg:text-[44px] lg:leading-[1.1] lg:tracking-[-0.03em]">
              Veja o ConciergeIA <br className="hidden lg:block" />
              com os seus imóveis.
            </h2>
            <ul className="relative mt-5 flex flex-col gap-2.5 text-[14.5px] text-[#e6dde8] lg:mt-9 lg:gap-[18px] lg:text-[16px]">
              {PROXIMOS_PASSOS.map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/12 lg:size-7">
                    <Check className="size-3.5 text-white" strokeWidth={3} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Formulário */}
          <div className="flex min-w-0 flex-col justify-center bg-[#15110f] px-6 pt-7 pb-8 lg:p-14">
            {status === "done" ? (
              <div className="py-14 text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-full bg-accent/12">
                  <Check className="size-5 text-accent" />
                </span>
                <p className="mt-5 font-display text-[19px] leading-[1.5] tracking-tight">
                  Recebemos seus dados. Em breve, entraremos em contato.
                </p>
              </div>
            ) : (
              <form
                onSubmit={onSubmit}
                className="grid min-w-0 gap-4 lg:grid-cols-2 lg:gap-x-4 lg:gap-y-5"
              >
                <label className="grid min-w-0 gap-2 lg:col-span-2">
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
                  <span className={labelClass}>Empresa</span>
                  <input
                    value={form.company}
                    onChange={(e) => set("company")(e.target.value)}
                    className={inputClass}
                    placeholder="Nome da operação"
                    autoComplete="organization"
                  />
                </label>

                <label className="grid min-w-0 gap-2">
                  <span className={labelClass}>Imóveis</span>
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

                <label className="grid min-w-0 gap-2 lg:col-span-2">
                  <span className={labelClass}>Principal desafio (opcional)</span>
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
                  <p className="text-[12.5px] text-destructive lg:col-span-2">
                    Não foi possível enviar agora. Tente novamente em instantes.
                  </p>
                ) : null}

                <div className="lg:col-span-2">
                  <button
                    type="submit"
                    disabled={status === "sending"}
                    className="mt-2 flex h-14 w-full min-w-0 items-center justify-center gap-2 rounded-[14px] bg-[linear-gradient(100deg,#8b2be2,#e82dae)] px-7 text-[16px] font-bold whitespace-nowrap text-white shadow-[0_12px_40px_-12px_rgba(232,45,174,0.7)] transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:translate-y-0 disabled:opacity-60"
                  >
                    {status === "sending" ? (
                      <>
                        <Loader2 className="size-4 animate-spin" /> Enviando…
                      </>
                    ) : (
                      "Agendar demonstração"
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
