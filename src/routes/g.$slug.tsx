import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getPublicGuide, submitPin } from "@/lib/guide.functions";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  Lock, MapPin, Wifi, Phone, KeyRound, Compass, ListChecks, LifeBuoy, HelpCircle,
  Copy, Check, ArrowLeft, ArrowRight, ScrollText, Home,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/g/$slug")({
  loader: async ({ params }) => {
    const r = await getPublicGuide({ data: { slug: params.slug } });
    if (r.status === "not_found") throw notFound();
    return r;
  },
  head: ({ loaderData }) => {
    if (!loaderData || loaderData.status !== "ok") {
      return { meta: [{ title: "Guia — SigmaGuide" }, { name: "robots", content: "noindex" }] };
    }
    const p = loaderData.property as Record<string, unknown>;
    const title = `${p.name as string} — Guia`;
    const desc = (p.tagline as string) || `Guia digital de ${p.name as string}`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        ...(p.hero_image_url ? [{ property: "og:image", content: p.hero_image_url as string }] : []),
      ],
    };
  },
  component: GuidePage,
});

function GuidePage() {
  const r = Route.useLoaderData();
  if (r.status === "locked" || r.status === "expired") {
    return <PinGate slug={Route.useParams().slug} status={r.status} name={r.propertyName ?? ""} />;
  }
  return <Guide data={r} />;
}

function PinGate({ slug, status, name }: { slug: string; status: "locked" | "expired"; name: string }) {
  const submit = useServerFn(submitPin);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  if (status === "expired") {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-6">
        <div className="text-center max-w-sm">
          <Lock className="size-10 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-serif text-3xl">{name}</h1>
          <p className="text-sm text-muted-foreground mt-3">{t("pin.expired")}</p>
        </div>
      </div>
    );
  }

  async function handle(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await submit({ data: { slug, pin } });
      if (r.ok) window.location.reload();
      else toast.error(t("pin.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <form onSubmit={handle} className="w-full max-w-sm text-center">
        <Lock className="size-10 mx-auto text-muted-foreground mb-4" />
        <h1 className="font-serif text-3xl">{name}</h1>
        <p className="text-sm text-muted-foreground mt-3 mb-6">{t("pin.desc")}</p>
        <Input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder={t("pin.placeholder")}
          maxLength={20}
          autoFocus
          className="text-center text-lg tracking-widest h-12"
        />
        <Button type="submit" disabled={loading || !pin} className="w-full mt-4 rounded-full h-11">
          {t("pin.submit")}
        </Button>
      </form>
    </div>
  );
}

type GuideOk = Extract<Awaited<ReturnType<typeof getPublicGuide>>, { status: "ok" }>;
type Section = "home" | "checkin" | "wifi" | "residencia" | "regras" | "faq";

function isRule(item: { title: string; description?: string | null }) {
  const s = `${item.title} ${item.description ?? ""}`.toLowerCase();
  return /(regra|norma|polít|proibi|não\s+|no\s+smoking|rule|policy)/i.test(s);
}

function Guide({ data }: { data: GuideOk }) {
  const p = data.property as Record<string, any>;
  const { slug } = Route.useParams();
  const { lang, setLang } = useI18n();
  const [section, setSection] = useState<Section>("home");

  const galleryRaw: string[] = Array.isArray(p.gallery_images) ? p.gallery_images : [];
  const photos: string[] = (galleryRaw.length ? galleryRaw : p.hero_image_url ? [p.hero_image_url] : []);
  const heroImg = photos[0];

  const rules = data.manual.filter(isRule);
  const houseManual = data.manual.filter((m: any) => !isRule(m));

  // Pick images for cards (fall back to hero)
  const pick = (i: number) => photos[i % Math.max(photos.length, 1)] ?? heroImg;

  const cards: Array<{
    key: Exclude<Section, "home"> | "explore";
    eyebrow: string;
    title: string;
    desc: string;
    icon: React.ReactNode;
    image?: string;
    to?: { kind: "section"; value: Section } | { kind: "link"; to: string };
  }> = [
    {
      key: "checkin",
      eyebrow: "Estadia",
      title: "Chegada & Saída",
      desc: "Endereço, códigos de acesso e horários.",
      icon: <KeyRound className="size-5" strokeWidth={1.5} />,
      image: pick(0),
      to: { kind: "section", value: "checkin" },
    },
    {
      key: "wifi",
      eyebrow: "Conexão",
      title: "Wi-Fi",
      desc: "Rede e senha para você ficar conectado.",
      icon: <Wifi className="size-5" strokeWidth={1.5} />,
      image: pick(1),
      to: { kind: "section", value: "wifi" },
    },
    {
      key: "residencia",
      eyebrow: "A casa",
      title: "A Residência",
      desc: "Manual e como funciona cada detalhe.",
      icon: <Home className="size-5" strokeWidth={1.5} />,
      image: pick(2),
      to: { kind: "section", value: "residencia" },
    },
    {
      key: "regras",
      eyebrow: "Combinados",
      title: "Regras",
      desc: "Boas práticas durante sua estadia.",
      icon: <ScrollText className="size-5" strokeWidth={1.5} />,
      image: pick(3),
      to: { kind: "section", value: "regras" },
    },
    {
      key: "faq",
      eyebrow: "Suporte",
      title: "Dúvidas Frequentes",
      desc: "Anfitrião, emergências e respostas rápidas.",
      icon: <HelpCircle className="size-5" strokeWidth={1.5} />,
      image: pick(4),
      to: { kind: "section", value: "faq" },
    },
    {
      key: "explore",
      eyebrow: "Concierge",
      title: "Explore a Região",
      desc: "Restaurantes, atrações e experiências.",
      icon: <Compass className="size-5" strokeWidth={1.5} />,
      image: pick(5),
      to: { kind: "link", to: `/g/${slug}/explorar` },
    },
  ];

  return (
    <div className="guide-ambient min-h-screen bg-background text-foreground pb-16">
      <div className="mx-auto w-full max-w-md">
        {section === "home" ? (
          <>
            <HeroCompact
              name={p.name}
              tagline={p.tagline}
              city={p.city}
              image={heroImg}
              lang={lang}
              onToggleLang={() => setLang(lang === "pt" ? "en" : "pt")}
            />

            <section className="px-5 mt-9">
              <div className="flex items-center gap-3 mb-5">
                <p className="text-[10px] uppercase tracking-[0.28em] text-accent font-semibold">
                  O que você deseja acessar?
                </p>
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="space-y-3.5">
                {cards.map((c) =>
                  c.to?.kind === "link" ? (
                    <Link key={c.key} to={c.to.to as any}>
                      <ThemeCard {...c} />
                    </Link>
                  ) : (
                    <button
                      key={c.key}
                      onClick={() => c.to?.kind === "section" && setSection(c.to.value)}
                      className="w-full text-left"
                    >
                      <ThemeCard {...c} />
                    </button>
                  ),
                )}
              </div>
            </section>

            <footer className="mt-12 px-6 text-center">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground/60 font-semibold">
                Seu guia. Sua experiência.
              </p>
            </footer>
          </>
        ) : (
          <Tabs value={section} onValueChange={(v) => setSection(v as Section)} className="px-5 pt-6">
            <button
              onClick={() => setSection("home")}
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] font-semibold text-muted-foreground hover:text-foreground transition-colors mb-6"
            >
              <ArrowLeft className="size-3" /> Voltar ao guia
            </button>

            <TabsContent value="checkin" className="space-y-4">
              <SectionTitle eyebrow="Estadia" title="Chegada & Saída" intro="Tudo o que você precisa para chegar e se acomodar." />
              {p.address && (
                <div className="bg-card border border-border rounded-2xl p-5 relative overflow-hidden">
                  <div className="absolute left-0 top-5 bottom-5 w-[3px] rounded-r-full bg-accent/70" />
                  <div className="flex items-start gap-4">
                    <div className="size-11 rounded-xl bg-accent/10 text-accent grid place-items-center shrink-0">
                      <MapPin className="size-[18px]" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-semibold">Endereço</p>
                      <p className="text-[15px] mt-1 leading-snug">{p.address}</p>
                    </div>
                  </div>
                  {p.maps_url && (
                    <a href={p.maps_url} target="_blank" rel="noreferrer"
                      className="mt-4 flex items-center justify-center gap-2 w-full rounded-xl bg-foreground text-background h-11 text-[12px] uppercase tracking-[0.18em] font-semibold active:scale-[0.98] transition-transform">
                      <MapPin className="size-4" strokeWidth={2} /> Abrir no mapa
                    </a>
                  )}
                </div>
              )}
              {p.address_note && (
                <div className="border-l-2 border-accent/60 pl-4 py-1 mx-1">
                  <p className="text-sm text-muted-foreground leading-relaxed italic">{p.address_note}</p>
                </div>
              )}
              {(p.checkin_time || p.checkout_time) && (
                <div className="grid grid-cols-2 bg-card border border-border rounded-2xl overflow-hidden">
                  {p.checkin_time && <InfoTile label="Check-in" value={`a partir de ${p.checkin_time}`} />}
                  {p.checkout_time && <InfoTile label="Check-out" value={`até ${p.checkout_time}`} border />}
                </div>
              )}
              {p.gate_code && <CopyCard icon={<KeyRound className="size-5" strokeWidth={1.75} />} eyebrow="Portão" label="Toque para copiar" value={p.gate_code} />}
              {p.lock_code && <CopyCard icon={<Lock className="size-5" strokeWidth={1.75} />} eyebrow="Fechadura" label="Toque para copiar" value={p.lock_code} />}
            </TabsContent>

            <TabsContent value="wifi" className="space-y-4">
              <SectionTitle eyebrow="Conexão" title="Wi-Fi" intro="Conecte-se à rede da casa." />
              {p.wifi_ssid ? (
                <>
                  <CopyCard icon={<Wifi className="size-5" strokeWidth={1.75} />} eyebrow="Rede" label="Toque para copiar" value={p.wifi_ssid} />
                  {p.wifi_password && (
                    <CopyCard icon={<KeyRound className="size-5" strokeWidth={1.75} />} eyebrow="Senha" label="Toque para copiar" value={p.wifi_password} />
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Sem informações de Wi-Fi.</p>
              )}
            </TabsContent>

            <TabsContent value="residencia" className="space-y-4">
              <SectionTitle eyebrow="A casa" title="A Residência" intro="Manual e detalhes da casa." />
              {houseManual.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem informações adicionais.</p>
              ) : (
                <Accordion type="single" collapsible className="space-y-2">
                  {houseManual.map((m: any) => (
                    <AccordionItem key={m.id} value={m.id} className="border border-border rounded-xl px-4">
                      <AccordionTrigger className="text-sm font-medium">{m.title}</AccordionTrigger>
                      <AccordionContent>
                        {m.description && <p className="text-sm text-muted-foreground mb-2">{m.description}</p>}
                        {m.body && <p className="text-sm whitespace-pre-line leading-relaxed">{m.body}</p>}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </TabsContent>

            <TabsContent value="regras" className="space-y-4">
              <SectionTitle eyebrow="Combinados" title="Regras" intro="Para uma boa convivência." />
              {rules.length === 0 && data.checkout.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem regras cadastradas.</p>
              ) : (
                <>
                  {rules.length > 0 && (
                    <Accordion type="single" collapsible className="space-y-2">
                      {rules.map((m: any) => (
                        <AccordionItem key={m.id} value={m.id} className="border border-border rounded-xl px-4">
                          <AccordionTrigger className="text-sm font-medium">{m.title}</AccordionTrigger>
                          <AccordionContent>
                            {m.description && <p className="text-sm text-muted-foreground mb-2">{m.description}</p>}
                            {m.body && <p className="text-sm whitespace-pre-line leading-relaxed">{m.body}</p>}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  )}
                  {data.checkout.length > 0 && (
                    <>
                      <div className="mt-6 mb-3 flex items-center gap-2">
                        <ListChecks className="size-4 text-muted-foreground" />
                        <h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground">Antes de sair</h3>
                      </div>
                      <ul className="space-y-2">
                        {data.checkout.map((c: any) => (
                          <li key={c.id} className="flex items-start gap-3 bg-card border border-border rounded-xl p-3 text-sm">
                            <Check className="size-4 mt-0.5 text-accent shrink-0" />
                            <span>{c.label}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="faq" className="space-y-5">
              <SectionTitle eyebrow="Suporte" title="Dúvidas Frequentes" />
              {(p.host_name || p.host_phone) && (
                <div className="bg-card border border-border rounded-2xl p-4">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Anfitrião</p>
                  {p.host_name && <p className="text-sm font-medium">{p.host_name}</p>}
                  {p.host_phone && (
                    <a href={`tel:${p.host_phone}`} className="text-sm text-primary inline-flex items-center gap-1.5 mt-1">
                      <Phone className="size-3.5" /> {p.host_phone}
                    </a>
                  )}
                </div>
              )}
              {data.emergency.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <LifeBuoy className="size-4 text-muted-foreground" />
                    <h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground">Emergências</h3>
                  </div>
                  <div className="space-y-2">
                    {data.emergency.map((e: any) => (
                      <a key={e.id} href={`tel:${e.number}`} className="flex items-center justify-between bg-card border border-border rounded-xl p-3 active:scale-[0.98] transition-transform">
                        <span className="text-sm font-medium">{e.label}</span>
                        <span className="text-sm text-primary font-mono">{e.number}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {data.faqs.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <HelpCircle className="size-4 text-muted-foreground" />
                    <h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground">FAQ</h3>
                  </div>
                  <Accordion type="single" collapsible className="space-y-2">
                    {data.faqs.map((f: any) => (
                      <AccordionItem key={f.id} value={f.id} className="border border-border rounded-xl px-4">
                        <AccordionTrigger className="text-sm font-medium text-left">{f.question}</AccordionTrigger>
                        <AccordionContent className="text-sm whitespace-pre-line">{f.answer}</AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              )}
              {!p.host_name && !p.host_phone && data.emergency.length === 0 && data.faqs.length === 0 && (
                <p className="text-sm text-muted-foreground">Sem informações de suporte.</p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

function HeroCompact({
  name, tagline, city, image, lang, onToggleLang,
}: {
  name: string; tagline?: string; city?: string; image?: string;
  lang: string; onToggleLang: () => void;
}) {
  return (
    <section className="px-5 pt-5">
      <div className="flex items-center justify-between mb-5">
        <span className="text-[11px] uppercase tracking-[0.28em] font-semibold">
          <span className="text-accent">Sigma</span>
          <span className="text-foreground">Guide</span>
        </span>
        <button
          onClick={onToggleLang}
          className="rounded-full border border-border px-3 py-1 text-[10px] uppercase tracking-[0.22em] font-medium text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors"
        >
          {lang === "pt" ? "EN" : "PT"}
        </button>
      </div>

      <div
        className="relative overflow-hidden rounded-[26px] border border-border bg-card"
        style={{ boxShadow: "var(--shadow-soft)" }}
      >
        {image && (
          <img
            src={image}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-[0.14]"
          />
        )}
        <div className="absolute inset-0 bg-[radial-gradient(70%_55%_at_88%_8%,oklch(from_var(--accent)_l_c_h/0.28),transparent_60%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/30 to-card/80" />

        <div className="relative px-7 py-10 min-h-[440px] flex flex-col justify-center">
          <p className="text-[11px] uppercase tracking-[0.34em] text-accent font-semibold mb-5">
            Bem-vindo
          </p>
          <h1 className="font-serif text-[2.5rem] leading-[1.05] tracking-tight text-foreground text-balance">
            {name}
          </h1>
          {city && (
            <p className="mt-5 inline-flex items-center gap-2 text-[14px] text-foreground/90">
              <MapPin className="size-4 text-accent" strokeWidth={1.75} /> {city}
            </p>
          )}
          <span className="block h-px w-12 bg-accent/70 mt-4" />
          {tagline && (
            <p className="text-[13px] mt-5 leading-relaxed text-muted-foreground max-w-[32ch]">
              {tagline}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ThemeCard({
  eyebrow, title, desc, icon,
}: {
  eyebrow: string; title: string; desc: string; icon: React.ReactNode; image?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-card active:scale-[0.99] transition-all hover:border-accent/40">
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(80%_120%_at_100%_50%,oklch(from_var(--accent)_l_c_h/0.08),transparent_70%)] pointer-events-none" />
      <div className="relative flex items-center gap-4 px-5 py-5">
        <span className="size-[58px] rounded-full border border-accent/40 text-accent grid place-items-center shrink-0">
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.28em] text-accent font-semibold mb-1.5">{eyebrow}</p>
          <h3 className="font-serif text-[1.35rem] leading-[1.05] text-foreground truncate">{title}</h3>
          <p className="text-[12px] text-muted-foreground mt-1.5 leading-snug line-clamp-1">{desc}</p>
        </div>
        <span className="size-11 rounded-full border border-accent/40 text-accent grid place-items-center shrink-0 group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
          <ArrowRight className="size-4" strokeWidth={1.75} />
        </span>
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }) {
  return (
    <div className="pt-2 pb-1">
      <div className="flex items-center gap-2 mb-2">
        <span className="h-px w-6 bg-accent/70" />
        <p className="text-[10px] uppercase tracking-[0.28em] text-accent font-semibold">{eyebrow}</p>
      </div>
      <h2 className="font-serif text-[1.9rem] leading-[1.1] tracking-tight">{title}</h2>
      {intro && <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed max-w-[36ch]">{intro}</p>}
    </div>
  );
}

function InfoTile({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div className={`p-5 ${border ? "border-l border-border" : ""}`}>
      <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-semibold">{label}</p>
      <p className="text-[15px] mt-1.5 font-medium leading-tight">{value}</p>
    </div>
  );
}

function CopyCard({ icon, eyebrow, label, value }: { icon?: React.ReactNode; eyebrow?: string; label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success("Copiado!");
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <button onClick={copy} className="w-full bg-card border border-border rounded-2xl p-5 flex items-center justify-between gap-4 active:scale-[0.99] transition-transform hover:border-accent/40">
      <div className="flex items-center gap-4 min-w-0">
        {icon && <div className="size-12 rounded-xl bg-gradient-to-br from-accent/20 to-accent/5 text-accent grid place-items-center shrink-0">{icon}</div>}
        <div className="min-w-0 text-left">
          {eyebrow && <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-semibold">{eyebrow}</p>}
          <p className="text-[1.35rem] font-mono font-medium truncate tracking-wider mt-0.5">{value}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
        </div>
      </div>
      <div className="size-9 rounded-full bg-secondary grid place-items-center shrink-0">
        {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4 text-muted-foreground" />}
      </div>
    </button>
  );
}

