import { createFileRoute, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getPublicGuide, submitPin } from "@/lib/guide.functions";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Lock, MapPin, Wifi, Phone, KeyRound, BookOpen, Compass, ListChecks, LifeBuoy, HelpCircle, ExternalLink, Copy, Check, ArrowLeft, ChevronRight } from "lucide-react";
import useEmblaCarousel from "embla-carousel-react";
import { useEffect } from "react";
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
      if (r.ok) {
        window.location.reload();
      } else {
        toast.error(t("pin.error"));
      }
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

type Section = "home" | "checkin" | "house" | "explore" | "info";

function Guide({ data }: { data: GuideOk }) {
  const p = data.property as Record<string, any>;
  const { lang, setLang } = useI18n();
  const [section, setSection] = useState<Section>("home");
  const nearby = data.recommendations.filter((r: any) => r.scope === "nearby");
  const city = data.recommendations.filter((r: any) => r.scope === "city");
  const monogram = (p.name as string)?.trim()?.[0]?.toUpperCase() ?? "S";


  const galleryRaw: string[] = Array.isArray(p.gallery_images) ? p.gallery_images : [];
  const photos: string[] = (galleryRaw.length ? galleryRaw : p.hero_image_url ? [p.hero_image_url] : []).slice(0, 4);

  return (
    <div className="guide-ambient min-h-screen bg-background text-foreground pb-20">
      <div className="mx-auto w-full max-w-md">
        {/* Editorial Hero — photo framed, title below */}
        <HeroEditorial
          photos={photos}
          name={p.name}
          tagline={p.tagline}
          monogram={monogram}
          lang={lang}
          onToggleLang={() => setLang(lang === "pt" ? "en" : "pt")}
        />

        {/* Wi-Fi — discreet utility row */}
        {p.wifi_ssid && <WifiStripe ssid={p.wifi_ssid} password={p.wifi_password ?? ""} />}

        {/* Sections */}
        <Tabs value={section} onValueChange={(v) => setSection(v as Section)} className="px-5 mt-8">
          {section !== "home" && (
            <button
              onClick={() => setSection("home")}
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] font-semibold text-muted-foreground hover:text-foreground transition-colors mb-5"
            >
              <ArrowLeft className="size-3" /> Voltar ao índice
            </button>
          )}

          {section === "home" && (
            <div>
              <div className="flex items-center gap-3 mb-5">
                <span className="h-px flex-1 bg-border" />
                <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground font-semibold">Índice</p>
                <span className="h-px flex-1 bg-border" />
              </div>
              <ul className="divide-y divide-border">
                <ChapterRow num="01" eyebrow="Estadia" title="Chegada & Saída" desc="Endereço, códigos e horários" icon={<KeyRound className="size-4" strokeWidth={1.5} />} onClick={() => setSection("checkin")} />
                <ChapterRow num="02" eyebrow="A casa" title="Manual & Regras" desc="Como funciona cada detalhe" icon={<BookOpen className="size-4" strokeWidth={1.5} />} onClick={() => setSection("house")} />
                <ChapterRow num="03" eyebrow="Concierge" title="Explorar a Região" desc="Onde comer, o que visitar" icon={<Compass className="size-4" strokeWidth={1.5} />} onClick={() => setSection("explore")} />
                <ChapterRow num="04" eyebrow="Suporte" title="Informações & FAQ" desc="Anfitrião, emergências, dúvidas" icon={<HelpCircle className="size-4" strokeWidth={1.5} />} onClick={() => setSection("info")} />
              </ul>
            </div>
          )}




          <TabsContent value="checkin" className="mt-2 space-y-4">
            <SectionTitle eyebrow="Chegada" title="Sua entrada" intro="Tudo o que você precisa para chegar e se acomodar." />

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
                  <a
                    href={p.maps_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 flex items-center justify-center gap-2 w-full rounded-xl bg-foreground text-background h-11 text-[12px] uppercase tracking-[0.18em] font-semibold active:scale-[0.98] transition-transform"
                  >
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


          <TabsContent value="house" className="mt-5 space-y-4">
            <SectionTitle eyebrow="A casa" title="Manual" />
            {data.manual.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem informações adicionais.</p>
            ) : (
              <Accordion type="single" collapsible className="space-y-2">
                {data.manual.map((m: any) => (
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
                <div className="mt-8 mb-3 flex items-center gap-2">
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
          </TabsContent>

          <TabsContent value="explore" className="mt-5 space-y-6">
            <SectionTitle eyebrow="Concierge" title="Descubra a região" />
            {nearby.length > 0 && (
              <RecBlock title="Aqui pertinho" desc="A poucos minutos a pé da casa" items={nearby} />
            )}
            {city.length > 0 && (
              <RecBlock title="Pela cidade" desc="Vale a visita — alguns minutos de carro" items={city} />
            )}
            {nearby.length === 0 && city.length === 0 && (
              <p className="text-sm text-muted-foreground">Sem recomendações ainda.</p>
            )}
          </TabsContent>

          <TabsContent value="info" className="mt-5 space-y-5">
            <SectionTitle eyebrow="Suporte" title="Informações" />
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
          </TabsContent>
        </Tabs>

        <footer className="mt-12 px-6 text-center">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">SigmaGuide</p>
        </footer>
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

function InfoRow({ icon, label, value, action }: { icon: React.ReactNode; label: string; value: string; action?: React.ReactNode }) {
  return (
    <div className="relative bg-card border border-border rounded-2xl p-5 overflow-hidden">
      <div className="absolute left-0 top-5 bottom-5 w-[3px] rounded-r-full bg-accent/70" />
      <div className="flex items-start gap-4">
        <div className="size-10 rounded-xl bg-accent/10 text-accent grid place-items-center shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-semibold">{label}</p>
          <p className="text-[15px] mt-1 leading-snug">{value}</p>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
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


function RecBlock({ title, desc, items }: { title: string; desc: string; items: any[] }) {
  const grouped = items.reduce<Record<string, any[]>>((acc, r) => {
    const k = r.category || r.type;
    (acc[k] ??= []).push(r);
    return acc;
  }, {});
  return (
    <div>
      <div className="mb-4">
        <h3 className="font-serif text-[1.7rem] leading-tight">{title}</h3>
        <p className="text-[12px] text-muted-foreground mt-1">{desc}</p>
      </div>
      <div className="space-y-6">
        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-3">
              <span className="h-px flex-1 bg-border" />
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-semibold">{cat}</p>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-3">
              {list.map((r) => (
                <a key={r.id} href={r.maps_url ?? "#"} target="_blank" rel="noreferrer"
                  className="group flex items-stretch gap-3.5 bg-card border border-border rounded-2xl p-3 active:scale-[0.99] transition-all hover:border-accent/40 hover:shadow-soft">
                  {r.image_url ? (
                    <img src={r.image_url} alt={r.name} className="size-20 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="size-20 rounded-xl bg-gradient-to-br from-accent/20 to-accent/5 grid place-items-center shrink-0">
                      <Compass className="size-6 text-accent/70" strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 py-0.5 flex flex-col justify-center">
                    <p className="text-[15px] font-medium truncate leading-tight">{r.name}</p>
                    <p className="text-[12px] text-muted-foreground truncate mt-1">
                      {r.distance_text}{r.rating ? ` · ★ ${r.rating}` : ""}
                    </p>
                    {r.note && <p className="text-[12px] text-muted-foreground/80 mt-1 italic line-clamp-2 leading-snug">{r.note}</p>}
                  </div>
                  <ExternalLink className="size-3.5 text-muted-foreground/60 shrink-0 mt-1 group-hover:text-accent transition-colors" />
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}



function WifiStripe({ ssid, password }: { ssid: string; password: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    if (!password) return;
    navigator.clipboard.writeText(password);
    setCopied(true);
    toast.success("Senha copiada!");
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <section className="px-4 mt-5">
      <button
        onClick={copy}
        className="w-full relative overflow-hidden rounded-2xl border border-accent/20 bg-gradient-to-r from-accent/20 via-accent/5 to-transparent p-5 flex items-center gap-4 text-left active:scale-[0.99] transition-transform"
      >
        <div className="size-12 rounded-2xl bg-gradient-to-br from-accent to-accent/70 text-accent-foreground grid place-items-center shrink-0 shadow-soft">
          <Wifi className="size-5" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.28em] text-accent font-semibold">Wi-Fi</p>
          <p className="text-[15px] font-medium truncate mt-1">{ssid}</p>
          {password && (
            <p className="text-[12px] font-mono text-muted-foreground truncate mt-0.5">{password}</p>
          )}
        </div>
        {password && (
          <div className="size-9 rounded-full bg-card border border-border grid place-items-center shrink-0">
            {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4 text-muted-foreground" />}
          </div>
        )}
      </button>
    </section>
  );
}


function ChapterRow({
  num,
  eyebrow,
  title,
  desc,
  icon,
  onClick,
}: {
  num: string;
  eyebrow: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className="group w-full text-left flex items-center gap-5 py-5 active:opacity-70 transition-opacity"
      >
        <span className="font-serif text-[1.4rem] text-muted-foreground/60 w-8 shrink-0 tabular-nums tracking-tight">{num}</span>
        <span className="size-9 rounded-full border border-border grid place-items-center text-muted-foreground shrink-0 group-hover:border-accent/40 group-hover:text-accent transition-colors">
          {icon}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[9.5px] uppercase tracking-[0.26em] text-accent font-semibold mb-0.5">{eyebrow}</span>
          <span className="block font-serif text-[1.35rem] leading-[1.1] text-foreground">{title}</span>
          <span className="block text-[11.5px] text-muted-foreground mt-1 leading-snug">{desc}</span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground/50 shrink-0 group-hover:text-accent group-hover:translate-x-0.5 transition-all" strokeWidth={1.5} />
      </button>
    </li>
  );
}

function HeroEditorial({
  photos,
  name,
  tagline,
  monogram,
  lang,
  onToggleLang,
}: {
  photos: string[];
  name: string;
  tagline?: string;
  monogram: string;
  lang: string;
  onToggleLang: () => void;
}) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: photos.length > 1, align: "start" });
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelected(emblaApi.selectedScrollSnap());
    emblaApi.on("select", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  const hasPhotos = photos.length > 0;

  return (
    <section className="px-5 pt-5">
      {/* Top chrome — outside the image */}
      <div className="flex items-center justify-between mb-5">
        <span className="text-[9.5px] uppercase tracking-[0.32em] font-semibold text-muted-foreground">SigmaGuide</span>
        <button
          onClick={onToggleLang}
          className="rounded-full border border-border px-3 py-1 text-[10px] uppercase tracking-[0.22em] font-medium text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors"
        >
          {lang === "pt" ? "EN" : "PT"}
        </button>
      </div>

      {/* Photo plate */}
      <div className="relative overflow-hidden rounded-2xl border border-border" style={{ boxShadow: "var(--shadow-soft)" }}>
        {hasPhotos ? (
          <div ref={emblaRef} className="overflow-hidden">
            <div className="flex">
              {photos.map((src, i) => (
                <div key={i} className="relative shrink-0 grow-0 basis-full">
                  <img src={src} alt={`${name} — foto ${i + 1}`} className="w-full aspect-[4/5] object-cover" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="relative w-full aspect-[4/5] overflow-hidden bg-secondary">
            <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_20%_15%,oklch(from_var(--accent)_l_c_h/0.25),transparent_60%)]" />
            <span className="absolute inset-0 grid place-items-center font-serif text-[14rem] leading-none text-accent/15 select-none">{monogram}</span>
          </div>
        )}

        {/* Subtle bottom scrim for dots */}
        {photos.length > 1 && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent" />
            <div className="absolute bottom-3 left-0 right-0 z-10 flex items-center justify-center gap-1.5">
              {photos.map((_, i) => (
                <button
                  key={i}
                  aria-label={`Foto ${i + 1}`}
                  onClick={() => emblaApi?.scrollTo(i)}
                  className={`h-1 rounded-full transition-all ${i === selected ? "w-5 bg-white" : "w-1 bg-white/50"}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Title block — BELOW photo, editorial */}
      <div className="mt-7 px-1">
        <div className="flex items-center gap-2 mb-3">
          <span className="h-px w-6 bg-accent/70" />
          <p className="text-[9.5px] uppercase tracking-[0.32em] text-accent font-semibold">Bem-vindo</p>
        </div>
        <h1 className="font-serif text-[2rem] leading-[1.05] text-balance tracking-tight text-foreground">
          {name}
        </h1>
        {tagline && (
          <p className="text-[13px] mt-3 leading-relaxed text-muted-foreground max-w-[32ch]">{tagline}</p>
        )}
        <p className="mt-4 text-[10px] uppercase tracking-[0.28em] text-muted-foreground/70 font-medium">
          Seu guia digital
        </p>
      </div>
    </section>
  );
}

