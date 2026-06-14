import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef } from "react";
import { getPublicGuide, submitPin } from "@/lib/guide.functions";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  Lock, MapPin, Wifi, Phone, KeyRound, Compass, ListChecks, LifeBuoy, HelpCircle,
  Copy, Check, ArrowLeft, ArrowRight, Home, Eye, EyeOff, Clock, ExternalLink, Car,
  Sun, Moon, UserRound, UtensilsCrossed, Wind, Tv, ShowerHead, PawPrint, WashingMachine, Waves, Refrigerator, Flame, Lightbulb, Trash2, Bath, BedDouble, ChevronRight, MessageCircle, LogIn, LogOut, PlayCircle, ListOrdered,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GuideAiChat } from "@/components/GuideAiChat";
import { toast } from "sonner";

export const Route = createFileRoute("/g/$slug/")({
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

function safeHttpsHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isRule(item: { title: string; description?: string | null }) {
  const s = `${item.title} ${item.description ?? ""}`.toLowerCase();
  return /(regra|norma|polít|proibi|não\s+|no\s+smoking|rule|policy)/i.test(s);
}

function Guide({ data }: { data: GuideOk }) {
  const p = data.property as Record<string, any>;
  const { slug } = Route.useParams();
  const [section, setSection] = useState<Section>("home");

  // Theme: admin default, override per-visitor via localStorage
  const adminTheme: "dark" | "light" = p.guide_theme === "light" ? "light" : "dark";
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return adminTheme;
    const stored = window.localStorage.getItem(`guide-theme:${slug}`);
    return stored === "dark" || stored === "light" ? stored : adminTheme;
  });
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { window.localStorage.setItem(`guide-theme:${slug}`, next); } catch {}
  }


  const galleryRaw: string[] = Array.isArray(p.gallery_images) ? p.gallery_images : [];
  const photos: string[] = galleryRaw.length ? galleryRaw : p.hero_image_url ? [p.hero_image_url] : [];
  const heroImg = photos[0];
  const heroTitle = cleanGuideTitle(p.name, p.city);

  const rules = data.manual.filter(isRule);
  const houseManual = data.manual.filter((m: any) => !isRule(m));

  // Category availability — hide a card entirely when no sub-item has content
  const hasCheckin = !!(p.checkin_time || p.checkout_time || p.address || p.maps_url || p.address_note || p.gate_code || p.lock_code || p.wifi_ssid);
  const hasResidencia = houseManual.length > 0;
  const hasFaq = !!(p.host_name || p.host_phone) || data.emergency.length > 0 || data.faqs.length > 0;
  const hasExplore = Array.isArray(data.recommendations) && data.recommendations.length > 0;

  // Pick images for cards: theme_images first, then gallery fallback, then hero
  const themeImages = (p.theme_images ?? {}) as Record<string, string | undefined>;
  const pick = (i: number) => photos[i % Math.max(photos.length, 1)] ?? heroImg;
  const themePick = (key: string, fallbackIdx: number) => themeImages[key] || pick(fallbackIdx);

  const allCards: Array<{
    key: Exclude<Section, "home"> | "explore";
    eyebrow: string;
    title: string;
    desc: string;
    icon: React.ReactNode;
    image?: string;
    visible: boolean;
    to?: { kind: "section"; value: Section } | { kind: "link"; to: string };
  }> = [
    {
      key: "checkin",
      eyebrow: "Estadia",
      title: "Chegada & Saída",
      desc: "Endereço, códigos de acesso e horários.",
      icon: <KeyRound className="size-5" strokeWidth={1.5} />,
      image: themePick("checkin", 1),
      visible: hasCheckin,
      to: { kind: "section", value: "checkin" },
    },
    {
      key: "residencia",
      eyebrow: "A casa",
      title: "A Residência",
      desc: "Manual, comodidades e detalhes da casa.",
      icon: <Home className="size-5" strokeWidth={1.5} />,
      image: themePick("residencia", 2),
      visible: hasResidencia,
      to: { kind: "section", value: "residencia" },
    },
    {
      key: "faq",
      eyebrow: "Suporte",
      title: "Dúvidas",
      desc: "Anfitrião, emergências e respostas rápidas.",
      icon: <HelpCircle className="size-5" strokeWidth={1.5} />,
      image: themePick("faq", 3),
      visible: hasFaq,
      to: { kind: "section", value: "faq" },
    },
    {
      key: "explore",
      eyebrow: "Concierge",
      title: "Explore a Região",
      desc: "Restaurantes, atrações e experiências.",
      icon: <Compass className="size-5" strokeWidth={1.5} />,
      image: themePick("explore", 4),
      visible: hasExplore,
      to: { kind: "link", to: `/g/${slug}/explorar` },
    },
  ];
  const cards = allCards.filter((c) => c.visible);

  return (
    <div className={`sigma-public-guide guide-ambient min-h-screen bg-background text-foreground pb-16 ${theme === "light" ? "theme-light" : ""}`}>
      <div className="mx-auto w-full max-w-md md:max-w-none">
        {section === "home" ? (
          <>
            <HeroCompact
              name={heroTitle}
              tagline={p.tagline}
              city={p.city}
              photos={photos}
              theme={theme}
              onToggleTheme={toggleTheme}
            />


            <div className="px-5 md:px-10 lg:px-16 -mt-20 md:-mt-24 relative z-10 mb-4 md:mb-6">
              <div className="md:max-w-md lg:max-w-lg">
                <WifiStrip ssid={p.wifi_ssid} password={p.wifi_password} theme={theme} />
              </div>
            </div>

            <section id="guide-actions" className="px-5 md:px-10 lg:px-16 relative z-10">
              <div className="flex items-center gap-3 mb-3 md:mb-5">
                <p className="shrink-0 text-[9px] uppercase tracking-[0.3em] text-accent font-semibold">
                  O que você deseja acessar?
                </p>
                <span className="h-px flex-1 bg-accent/40" />
              </div>

              <div className="space-y-2.5 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-4">
                {cards.map((c) =>
                  c.to?.kind === "link" ? (
                    <Link
                      key={c.key}
                      to="/g/$slug/explorar"
                      params={{ slug }}
                      className="block"
                    >
                      <ThemeCard title={c.title} desc={c.desc} icon={c.icon} image={c.image} theme={theme} />
                    </Link>
                  ) : (
                    <button
                      key={c.key}
                      onClick={() => c.to?.kind === "section" && setSection(c.to.value)}
                      className="w-full text-left"
                    >
                      <ThemeCard title={c.title} desc={c.desc} icon={c.icon} image={c.image} theme={theme} />
                    </button>
                  ),
                )}
              </div>
            </section>

            <footer className="mt-10 px-6 text-center flex items-center justify-center gap-2.5">
              {p.brand_logo_url ? (
                <img src={p.brand_logo_url} alt={p.brand_name || "Marca"} className="h-5 w-auto object-contain opacity-80" />
              ) : (
                <GuideMark className="size-3.5 text-accent" />
              )}
              <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/65 font-semibold">
                {p.brand_name || "Seu guia. Sua experiência."}
              </p>
            </footer>

          </>
        ) : (
          <Tabs value={section} onValueChange={(v) => setSection(v as Section)} className="px-5 md:px-10 lg:px-16 pt-6 md:pt-10 lg:max-w-3xl lg:mx-auto">
            <button
              onClick={() => setSection("home")}
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] font-semibold text-muted-foreground hover:text-foreground transition-colors mb-6 md:mb-8"
            >
              <ArrowLeft className="size-3" /> Voltar ao guia
            </button>

            <TabsContent value="checkin" className="space-y-5">
              <SectionTitle eyebrow="Estadia" title="Chegada & Saída" intro="Tudo o que você precisa para chegar e se acomodar." />

              {(() => {
                const hasHorario = !!(p.checkin_time || p.checkout_time);
                const hasChegada = !!(p.address || p.maps_url || p.address_note || p.checkin_instructions || (Array.isArray(p.checkin_media) && p.checkin_media.length > 0));
                const accessMedia = Array.isArray(p.access_media) ? (p.access_media as Array<{ url: string; type: "image" | "video" }>) : [];
                const hasAcesso = !!(p.gate_code || p.lock_code || p.access_instructions || p.access_video_url || accessMedia.length > 0);
                const hasWifi = !!p.wifi_ssid;
                if (!hasHorario && !hasChegada && !hasAcesso && !hasWifi) {
                  return <p className="text-sm text-muted-foreground">Sem informações cadastradas.</p>;
                }
                const hasCoords = p.lat != null && p.lng != null;
                // Prefer lat/lng-based search URL — reliable on any device and not blocked.
                // Use a stored maps_url only when it's a share short link (maps.app.goo.gl / goo.gl/maps).
                const safeStoredMapsUrl = safeHttpsHref(p.maps_url);
                const isShortMaps = typeof safeStoredMapsUrl === "string" && /(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(safeStoredMapsUrl);
                const mapsHref = hasCoords
                  ? `https://www.google.com/maps/search/?api=1&query=${p.lat}%2C${p.lng}`
                  : isShortMaps
                    ? safeStoredMapsUrl
                    : p.address
                      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`
                      : safeStoredMapsUrl;
                // Uber: the new "looking" deep link works without a client_id on desktop & mobile.
                const uberDrop = hasCoords
                  ? { latitude: Number(p.lat), longitude: Number(p.lng), ...(p.address ? { addressLine1: String(p.address) } : {}) }
                  : p.address ? { addressLine1: String(p.address) } : null;
                const uberUrl = uberDrop
                  ? `https://m.uber.com/looking?drop[0]=${encodeURIComponent(JSON.stringify(uberDrop))}`
                  : null;
                return (
                  <SubList>
                    {hasHorario && (
                      <SubItem
                        icon={<Clock className="size-[18px]" strokeWidth={1.6} />}
                        label="Horário"
                        hint={
                          p.checkin_time && p.checkout_time
                            ? `Check-in ${p.checkin_time} · Check-out ${p.checkout_time}`
                            : p.checkin_time
                              ? `Check-in ${p.checkin_time}`
                              : `Check-out ${p.checkout_time}`
                        }
                      >
                        <div className="rounded-xl bg-background/50 border border-border/50 overflow-hidden divide-y divide-border/50">
                          {p.checkin_time && (
                            <TimeRow
                              kind="in"
                              label="Check-in"
                              from={p.checkin_time}
                              to={p.checkin_time_max as string | undefined}
                              fallbackPrefix="A partir de"
                            />
                          )}
                          {p.checkout_time && (
                            <TimeRow
                              kind="out"
                              label="Check-out"
                              from={p.checkout_time_min as string | undefined}
                              to={p.checkout_time}
                              fallbackPrefix="Até"
                            />
                          )}
                        </div>
                      </SubItem>
                    )}

                    {hasChegada && (
                      <SubItem
                        icon={<MapPin className="size-[18px]" strokeWidth={1.6} />}
                        label="Chegada & Localização"
                        hint={p.city || (p.address ? "Como chegar" : undefined)}
                      >
                        <div className="space-y-4">
                          {p.address_note && (
                            <div className="space-y-3 text-[14px] leading-relaxed text-foreground/85">
                              {String(p.address_note)
                                .split(/\n\s*\n/)
                                .map((para: string, i: number) => (
                                  <p key={i} className="whitespace-pre-line">{para}</p>
                                ))}
                            </div>
                          )}
                          {(p.address || p.maps_url || uberUrl) && (
                            <div className="rounded-xl bg-background/50 border border-border/50 overflow-hidden divide-y divide-border/40">
                              {mapsHref && (
                                <a
                                  href={mapsHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-3 px-3.5 py-3 hover:bg-card/40 active:bg-card/60 transition-colors"
                                >
                                  <span className="size-9 rounded-lg bg-accent/15 text-accent grid place-items-center shrink-0">
                                    <MapPin className="size-[18px]" strokeWidth={1.75} />
                                  </span>
                                  <div className="flex-1 min-w-0 text-left">
                                    <p className="text-[13.5px] font-medium leading-tight">Abrir no Google Maps</p>
                                    {p.address && <p className="text-[11.5px] text-muted-foreground truncate mt-0.5">{p.address}</p>}
                                  </div>
                                  <ExternalLink className="size-3.5 text-muted-foreground shrink-0" />
                                </a>
                              )}
                              {uberUrl && (
                                <a
                                  href={uberUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-3 px-3.5 py-3 hover:bg-card/40 active:bg-card/60 transition-colors"
                                >
                                  <span className="size-9 rounded-lg bg-foreground text-background grid place-items-center shrink-0">
                                    <Car className="size-[18px]" strokeWidth={1.75} />
                                  </span>
                                  <div className="flex-1 min-w-0 text-left">
                                    <p className="text-[13.5px] font-medium leading-tight">Pedir Uber</p>
                                    <p className="text-[11.5px] text-muted-foreground mt-0.5">Corrida até o endereço</p>
                                  </div>
                                  <ExternalLink className="size-3.5 text-muted-foreground shrink-0" />
                                </a>
                              )}
                            </div>
                          )}
                          {(p.checkin_instructions || (Array.isArray(p.checkin_media) && p.checkin_media.length > 0)) && (
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-semibold mb-2">Instruções de check-in</p>
                              {p.checkin_instructions && (
                                <div className="mb-3">
                                  <StepList text={String(p.checkin_instructions)} />
                                </div>
                              )}
                              {Array.isArray(p.checkin_media) && p.checkin_media.length > 0 && (
                                <div className="grid grid-cols-2 gap-2">
                                  {(p.checkin_media as Array<{ url: string; type: "image" | "video" }>).map((m, i) => (
                                    <div key={i} className="rounded-xl overflow-hidden border border-border bg-muted/40 aspect-square">
                                      {m.type === "video" ? (
                                        <video src={m.url} className="size-full object-cover" controls playsInline preload="metadata" />
                                      ) : (
                                        <img src={m.url} alt={`Check-in ${i + 1}`} className="size-full object-cover" loading="lazy" />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </SubItem>
                    )}

                    {hasAcesso && (
                      <SubItem
                        icon={<KeyRound className="size-[18px]" strokeWidth={1.6} />}
                        label="Acesso"
                        hint={
                          p.gate_code && p.lock_code
                            ? "Portão e fechadura"
                            : p.gate_code
                            ? "Portão"
                            : p.lock_code
                            ? "Fechadura"
                            : "Instruções de entrada"
                        }
                      >
                        <div className="rounded-xl bg-background/50 border border-border/50 overflow-hidden divide-y divide-border/40">
                          {p.gate_code && (
                            <CopyCard flat icon={<KeyRound className="size-[18px]" strokeWidth={1.75} />} eyebrow="Portão" label="Toque para copiar" value={p.gate_code} />
                          )}
                          {p.lock_code && (
                            <CopyCard flat icon={<Lock className="size-[18px]" strokeWidth={1.75} />} eyebrow="Fechadura" label="Toque para copiar" value={p.lock_code} />
                          )}
                          {p.access_instructions && (
                            <div className="px-3.5 py-3 flex items-start gap-3">
                              <div className="size-9 grid place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
                                <ListOrdered className="size-[18px]" strokeWidth={1.75} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground mb-1">Passo a passo</div>
                                <p className="text-[13.5px] leading-relaxed text-foreground/90 whitespace-pre-wrap">{p.access_instructions as string}</p>
                              </div>
                            </div>
                          )}
                          {p.access_video_url && (
                            <a
                              href={p.access_video_url as string}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3.5 py-3 flex items-center gap-3 hover:bg-foreground/[0.03] transition-colors"
                            >
                              <div className="size-9 grid place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
                                <PlayCircle className="size-[18px]" strokeWidth={1.75} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Vídeo</div>
                                <div className="text-[13.5px] font-medium text-foreground">Assistir tutorial</div>
                              </div>
                              <ExternalLink className="size-4 text-muted-foreground" />
                            </a>
                          )}
                          {accessMedia.length > 0 && (
                            <div className="px-3.5 py-3">
                              <div className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground mb-2">Fotos & vídeos</div>
                              <div className="grid grid-cols-2 gap-2">
                                {accessMedia.map((m, i) => (
                                  <div key={i} className="rounded-lg overflow-hidden border border-border/60 bg-muted/40 aspect-square">
                                    {m.type === "video" ? (
                                      <video src={m.url} className="size-full object-cover" controls playsInline preload="metadata" />
                                    ) : (
                                      <img src={m.url} alt={`Acesso ${i + 1}`} className="size-full object-cover" loading="lazy" />
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </SubItem>
                    )}

                    {hasWifi && (
                      <SubItem
                        icon={<Wifi className="size-[18px]" strokeWidth={1.6} />}
                        label="Wi-Fi"
                        hint={p.wifi_ssid || undefined}
                      >
                        <div className="rounded-xl bg-background/50 border border-border/50 overflow-hidden divide-y divide-border/40">
                          <CopyCard flat icon={<Wifi className="size-[18px]" strokeWidth={1.75} />} eyebrow="Rede" label="Toque para copiar" value={p.wifi_ssid} />
                          {p.wifi_password && (
                            <CopyCard flat icon={<KeyRound className="size-[18px]" strokeWidth={1.75} />} eyebrow="Senha" label="Toque para copiar" value={p.wifi_password} />
                          )}
                        </div>
                      </SubItem>
                    )}
                  </SubList>
                );
              })()}
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

            <TabsContent value="residencia" className="space-y-5">
              <SectionTitle title="A Residência" intro="Manual e detalhes da casa — toque em um item para saber mais." />
              {houseManual.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem informações adicionais.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {houseManual.map((m: any) => (
                    <ResidenciaCard key={m.id} item={m} />
                  ))}
                </div>
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

            <TabsContent value="faq" className="space-y-6">
              <SectionTitle title="Dúvidas" />
              {data.faqs.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <HelpCircle className="size-4 text-muted-foreground" />
                    <h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground">Perguntas frequentes</h3>
                  </div>
                  <Accordion type="single" collapsible className="space-y-1.5">
                    {data.faqs.map((f: any, idx: number) => (
                      <AccordionItem
                        key={f.id}
                        value={f.id}
                        className="border border-border/70 rounded-xl px-3.5 bg-card/30 hover:bg-card/60 transition-colors data-[state=open]:bg-card data-[state=open]:border-accent/40"
                      >
                        <AccordionTrigger className="text-left hover:no-underline py-2.5 gap-3">
                          <span className="flex items-center gap-2.5 min-w-0">
                            <span className="text-[10px] font-mono text-accent/70 tabular-nums tracking-wider shrink-0">{String(idx + 1).padStart(2, "0")}</span>
                            <span className="text-[13.5px] font-medium leading-snug truncate">{f.question}</span>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="text-[13.5px] leading-relaxed whitespace-pre-line text-foreground/80 pl-6 pr-1 pb-3.5 max-w-prose">
                          {f.answer}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              )}
              {data.emergency.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <LifeBuoy className="size-4 text-muted-foreground" />
                    <h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground">Emergências</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {data.emergency.map((e: any) => (
                      <a
                        key={e.id}
                        href={`tel:${e.number}`}
                        className="flex items-center gap-3 bg-card border border-border rounded-xl p-3 active:scale-[0.98] transition-transform hover:border-accent/50"
                      >
                        <span className="size-10 rounded-full bg-accent/15 text-accent grid place-items-center shrink-0">
                          <Phone className="size-[18px]" strokeWidth={1.75} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{e.label}</p>
                          <p className="text-[13px] text-muted-foreground font-mono tracking-wider">{e.number}</p>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {(p.host_name || p.host_phone) && (
                <div>
                  <div className="mb-2.5 flex items-center gap-2">
                    <UserRound className="size-3.5 text-muted-foreground" />
                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-semibold text-muted-foreground">Anfitrião</h3>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/40 p-3">
                    <div className="size-10 rounded-full bg-accent/15 text-accent grid place-items-center text-sm font-semibold shrink-0">
                      {(p.host_name as string | undefined)?.trim()?.charAt(0)?.toUpperCase() ?? <UserRound className="size-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      {p.host_name && <p className="text-[14px] font-medium leading-tight truncate">{p.host_name}</p>}
                      {p.host_phone && (
                        <p className="text-[11.5px] text-muted-foreground font-mono tracking-wider mt-0.5 truncate">{p.host_phone}</p>
                      )}
                    </div>
                    {p.host_phone && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <a
                          href={`tel:${p.host_phone}`}
                          aria-label="Ligar"
                          className="grid size-9 place-items-center rounded-full bg-foreground text-background hover:brightness-110 transition"
                        >
                          <Phone className="size-3.5" />
                        </a>
                        <a
                          href={`https://wa.me/${String(p.host_phone).replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="WhatsApp"
                          className="grid size-9 place-items-center rounded-full border border-border bg-background/60 hover:border-accent/50 transition"
                        >
                          <MessageCircle className="size-3.5" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!p.host_name && !p.host_phone && data.emergency.length === 0 && data.faqs.length === 0 && (
                <p className="text-sm text-muted-foreground">Sem informações de suporte.</p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
      <GuideAiChat slug={slug} propertyName={heroTitle} />
    </div>
  );
}

function residenciaIcon(title: string): React.ReactNode {
  const t = title.toLowerCase();
  if (/cozinha|fog(ã|a)o|forno|micro|panela/.test(t)) return <UtensilsCrossed className="size-5" strokeWidth={1.5} />;
  if (/geladeira|freezer/.test(t)) return <Refrigerator className="size-5" strokeWidth={1.5} />;
  if (/ar[\s-]?cond|climati|ventil|aquece/.test(t)) return <Wind className="size-5" strokeWidth={1.5} />;
  if (/tv|televis|streaming|netflix|controle/.test(t)) return <Tv className="size-5" strokeWidth={1.5} />;
  if (/chuveiro|banheir|toalha/.test(t)) return <ShowerHead className="size-5" strokeWidth={1.5} />;
  if (/banhei/.test(t)) return <Bath className="size-5" strokeWidth={1.5} />;
  if (/pet|cachorro|gato|animal/.test(t)) return <PawPrint className="size-5" strokeWidth={1.5} />;
  if (/lavanderia|m(á|a)quina|lavar|rouparia|secad/.test(t)) return <WashingMachine className="size-5" strokeWidth={1.5} />;
  if (/piscina|hidro|jacuzzi|spa/.test(t)) return <Waves className="size-5" strokeWidth={1.5} />;
  if (/churras|grill|fog(ã|a)o a lenha/.test(t)) return <Flame className="size-5" strokeWidth={1.5} />;
  if (/luz|iluminaç|l(â|a)mpada|interruptor/.test(t)) return <Lightbulb className="size-5" strokeWidth={1.5} />;
  if (/lixo|reciclag|coleta/.test(t)) return <Trash2 className="size-5" strokeWidth={1.5} />;
  if (/cama|quarto|colch(ã|a)o|len(ç|c)ol/.test(t)) return <BedDouble className="size-5" strokeWidth={1.5} />;
  return <Home className="size-5" strokeWidth={1.5} />;
}

function ResidenciaCard({ item }: { item: { id: string; title: string; description?: string | null; body?: string | null } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative text-left bg-card border border-border rounded-2xl p-4 hover:border-accent/50 hover:shadow-[0_8px_24px_-12px_oklch(from_var(--accent)_l_c_h/0.5)] active:scale-[0.98] transition-all min-h-[120px] flex flex-col gap-3"
      >
        <span className="grid size-10 place-items-center rounded-xl bg-accent/12 text-accent group-hover:bg-accent/20 transition-colors">
          {residenciaIcon(item.title)}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-[15px] leading-snug text-foreground line-clamp-2">{item.title}</h3>
          {item.description && (
            <p className="text-[11.5px] text-muted-foreground mt-1 line-clamp-2 leading-snug">{item.description}</p>
          )}
        </div>
        <ChevronRight className="absolute top-3 right-3 size-4 text-muted-foreground/60 group-hover:text-accent transition-colors" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 text-left">
              <span className="grid size-10 place-items-center rounded-xl bg-accent/15 text-accent shrink-0">
                {residenciaIcon(item.title)}
              </span>
              <DialogTitle className="font-serif text-xl leading-tight">{item.title}</DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            {item.description && (
              <p className="text-[13.5px] text-muted-foreground leading-relaxed">{item.description}</p>
            )}
            {item.body && (
              <div className="text-[14px] leading-relaxed whitespace-pre-line text-foreground/90">
                {item.body}
              </div>
            )}
            {!item.description && !item.body && (
              <p className="text-sm text-muted-foreground">Sem detalhes adicionais.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function cleanGuideTitle(name?: string, city?: string) {
  return String(name ?? "")
    .replace(/^Entrada\/Saída\s+da\s+/i, "")
    .replace(city ? new RegExp(`\\s+em\\s+${String(city).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") : /\s+em\s+[^,]+$/i, "")
    .trim() || String(name ?? "Guia");
}

function GuideMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="none">
      <path d="M16 3v7.5M16 21.5V29M3 16h7.5M21.5 16H29" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 10.5c0 3.04-2.46 5.5-5.5 5.5 3.04 0 5.5 2.46 5.5 5.5 0-3.04 2.46-5.5 5.5-5.5-3.04 0-5.5-2.46-5.5-5.5Z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  );
}

function HeroCompact({
  name, tagline, city, photos, theme, onToggleTheme,
}: {
  name: string; tagline?: string; city?: string; photos: string[];
  theme: "dark" | "light"; onToggleTheme: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const total = photos.length;
  const hasMany = total > 1;

  function go(dir: number) {
    if (!hasMany) return;
    setIdx((i) => (i + dir + total) % total);
  }
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  }

  return (
    <section
      className="relative min-h-[360px] md:min-h-[480px] overflow-hidden px-5 md:px-10 lg:px-16 pb-16 md:pb-24 pt-4 md:pt-8"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Photo slides */}
      <div className="absolute inset-0">
        {photos.map((src, i) => (
          <img
            key={`${src}-${i}`}
            src={src}
            alt=""
            className={`absolute inset-0 size-full object-cover object-[62%_50%] transition-opacity duration-500 ${i === idx ? "opacity-100" : "opacity-0"}`}
          />
        ))}
      </div>
      {/* lighter overlay so the photo stays vivid in both themes; just enough for text legibility */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,oklch(0.02_0.004_40/0.48)_0%,oklch(0.02_0.004_40/0.18)_45%,oklch(0.02_0.004_40/0)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,oklch(0.02_0.004_40/0.18)_0%,transparent_30%,oklch(0.02_0.004_40/0.32)_82%,oklch(0.02_0.004_40/0.85)_100%)]" />
      {/* bottom fade INTO the page background so the transition is seamless in any theme */}
      <div className="absolute inset-x-0 bottom-0 h-32 md:h-40 bg-[linear-gradient(180deg,transparent_0%,var(--background)_100%)]" />

      <header className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GuideMark className="size-5 text-accent" />
          <p className="font-serif text-[1.25rem] leading-none text-white">
            <span>Sigma</span><span className="text-accent">Guide</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
          title={theme === "dark" ? "Tema claro" : "Tema escuro"}
          className="grid size-9 shrink-0 place-items-center rounded-full border border-accent/55 bg-background/10 text-white/95 backdrop-blur-sm transition-colors hover:bg-accent/25 hover:text-white"
        >
          {theme === "dark" ? <Sun className="size-4" strokeWidth={1.75} /> : <Moon className="size-4" strokeWidth={1.75} />}
        </button>
      </header>


      <div className="relative z-10 mt-14 md:mt-24">
        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.36em] text-accent">Bem-vindo</p>
        <h1 className="font-serif text-[1.75rem] md:text-[3rem] leading-[1.0] text-white text-balance max-w-[300px] md:max-w-[640px]">
          {name}
        </h1>
        {city && (
          <p className="mt-2.5 md:mt-4 inline-flex items-center gap-2 text-[0.8rem] md:text-[0.95rem] leading-none text-white/85">
            <MapPin className="size-3.5 text-white/85 fill-white/85" strokeWidth={0} /> {city}
          </p>
        )}
        <span className="mt-3.5 md:mt-5 block h-[2px] w-10 md:w-14 bg-accent" />
        {tagline && (
          <p className="mt-3 md:mt-4 text-[0.85rem] md:text-[1rem] leading-[1.5] text-white/80 md:max-w-[52ch]">
            {tagline}
          </p>
        )}
      </div>

      {hasMany && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Foto anterior"
            className="hidden md:grid absolute left-3 top-1/2 -translate-y-1/2 z-10 size-10 place-items-center rounded-full border border-white/30 bg-black/30 text-white backdrop-blur-sm hover:bg-black/50"
          >
            <ArrowLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Próxima foto"
            className="hidden md:grid absolute right-3 top-1/2 -translate-y-1/2 z-10 size-10 place-items-center rounded-full border border-white/30 bg-black/30 text-white backdrop-blur-sm hover:bg-black/50"
          >
            <ArrowRight className="size-4" />
          </button>
          <div className="absolute bottom-20 md:bottom-28 left-0 right-0 z-10 flex justify-center gap-1.5">
            {photos.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`Ir para foto ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${i === idx ? "w-6 bg-accent" : "w-1.5 bg-white/50 hover:bg-white/80"}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}


function ThemeCard({
  title, desc, icon, image, theme,
}: {
  title: string; desc: string; icon: React.ReactNode; image?: string; theme: "dark" | "light";
}) {
  const isLight = theme === "light";
  return (
    <div className="group relative min-h-[112px] overflow-hidden rounded-2xl border border-accent/30 bg-card transition-all duration-500 ease-out hover:border-transparent hover:shadow-[0_0_0_1px_oklch(from_var(--accent)_l_c_h/0.25),0_10px_40px_-8px_oklch(from_var(--accent)_l_c_h/0.45),0_0_60px_-10px_oklch(from_var(--accent)_l_c_h/0.35)] hover:-translate-y-0.5 active:scale-[0.99] active:translate-y-0">
      {image && (
        <img
          src={image}
          alt=""
          className={`absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105 ${
            isLight ? "opacity-25" : "opacity-70"
          }`}
        />
      )}
      {isLight ? (
        <>
          <div className="absolute inset-0 bg-[linear-gradient(90deg,oklch(from_var(--card)_l_c_h/0.98)_0%,oklch(from_var(--card)_l_c_h/0.9)_45%,oklch(from_var(--card)_l_c_h/0.7)_80%,oklch(from_var(--card)_l_c_h/0.88)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,oklch(from_var(--card)_l_c_h/0.4),oklch(from_var(--card)_l_c_h/0.85))]" />
        </>
      ) : (
        <>
          <div className="absolute inset-0 bg-[linear-gradient(90deg,oklch(0.02_0.004_40/0.96)_0%,oklch(0.02_0.004_40/0.78)_38%,oklch(0.02_0.004_40/0.28)_72%,oklch(0.02_0.004_40/0.55)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,oklch(0.02_0.004_40/0.1),oklch(0.02_0.004_40/0.55))]" />
        </>
      )}
      <div className="relative flex min-h-[112px] items-center gap-4 px-4 py-3.5 pr-14">
        <span className={`grid size-11 shrink-0 place-items-center rounded-full border backdrop-blur-sm ${
          isLight
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-accent/45 bg-background/20 text-accent"
        }`}>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className={`font-serif text-[1.15rem] leading-[1.1] text-balance ${isLight ? "text-foreground" : "text-white"}`}>{title}</h3>
          <p className={`mt-1 text-[11.5px] leading-[1.4] line-clamp-2 ${isLight ? "text-muted-foreground" : "text-white/72"}`}>{desc}</p>
        </div>
        <span className={`absolute right-3.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full border transition-colors group-hover:bg-accent group-hover:text-background ${
          isLight ? "border-accent/70 text-accent" : "border-accent/75 text-white"
        }`}>
          <ArrowRight className="size-4" strokeWidth={1.6} />
        </span>
      </div>
    </div>
  );
}

function SubList({ children }: { children: React.ReactNode }) {
  return (
    <Accordion type="single" collapsible className="bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border/70">
      {children}
    </Accordion>
  );
}

function SubItem({
  icon, label, hint, children,
}: {
  icon: React.ReactNode; label: string; hint?: string; children: React.ReactNode;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <AccordionItem value={id} className="border-0">
      <AccordionTrigger className="px-4 py-3.5 hover:no-underline">
        <div className="flex items-center gap-3.5 flex-1 min-w-0">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-foreground/80">
            {icon}
          </span>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[15px] leading-tight font-medium text-foreground">{label}</p>
            {hint && <p className="text-[11.5px] text-muted-foreground mt-0.5 truncate">{hint}</p>}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pl-[3.875rem] pr-3 pb-3.5 pt-0">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

function SectionTitle({ title, intro }: { eyebrow?: string; title: string; intro?: string }) {
  return (
    <div className="pt-2 pb-1">
      <h2 className="font-serif text-[1.9rem] leading-[1.1] tracking-tight">{title}</h2>
      {intro && <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed max-w-[36ch]">{intro}</p>}
    </div>
  );
}

function InfoTile({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div className={`px-4 py-3 ${border ? "border-l border-border/40" : ""}`}>
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">{label}</p>
      <p className="text-[14px] mt-1 font-medium leading-snug text-foreground/95">{value}</p>
    </div>
  );
}

function TimeRow({
  kind,
  label,
  from,
  to,
  fallbackPrefix,
}: {
  kind: "in" | "out";
  label: string;
  from?: string;
  to?: string;
  fallbackPrefix: string;
}) {
  const Icon = kind === "in" ? LogIn : LogOut;
  const hasRange = !!from && !!to;
  const single = from || to || "";
  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      <div className="size-9 rounded-full bg-foreground/5 flex items-center justify-center shrink-0">
        <Icon className="size-[16px] text-foreground/70" strokeWidth={1.7} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">{label}</p>
        {hasRange ? (
          <div className="mt-0.5 flex items-baseline gap-1.5 text-[15px] font-medium text-foreground/95 leading-snug">
            <span className="tabular-nums">{from}</span>
            <ArrowRight className="size-3 text-muted-foreground/70 self-center" strokeWidth={2} />
            <span className="tabular-nums">{to}</span>
          </div>
        ) : (
          <p className="mt-0.5 text-[15px] font-medium text-foreground/95 leading-snug">
            <span className="text-muted-foreground/80 font-normal">{fallbackPrefix} </span>
            <span className="tabular-nums">{single}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function CopyCard({ icon, eyebrow, label, value, flat }: { icon?: React.ReactNode; eyebrow?: string; label: string; value: string; flat?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success("Copiado!");
    setTimeout(() => setCopied(false), 1800);
  }
  if (flat) {
    return (
      <button
        onClick={copy}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left hover:bg-card/40 active:bg-card/60 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div className="size-9 rounded-lg bg-accent/12 text-accent grid place-items-center shrink-0">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            {eyebrow && <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">{eyebrow}</p>}
            <p className="text-[15px] font-semibold tracking-tight mt-0.5 break-all leading-snug">{value}</p>
          </div>
        </div>
        <div className="size-8 rounded-full bg-secondary grid place-items-center shrink-0">
          {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5 text-muted-foreground" />}
        </div>
      </button>
    );
  }
  return (
    <button onClick={copy} className="w-full bg-card border border-border rounded-2xl p-5 flex items-center justify-between gap-4 active:scale-[0.99] transition-transform hover:border-accent/40">
      <div className="flex items-center gap-4 min-w-0">
        {icon && <div className="size-12 rounded-xl bg-gradient-to-br from-accent/20 to-accent/5 text-accent grid place-items-center shrink-0">{icon}</div>}
        <div className="min-w-0 text-left">
          {eyebrow && <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-semibold">{eyebrow}</p>}
          <p className="text-lg sm:text-xl font-semibold tracking-tight mt-0.5 break-all leading-snug">{value}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
        </div>
      </div>
      <div className="size-9 rounded-full bg-secondary grid place-items-center shrink-0">
        {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4 text-muted-foreground" />}
      </div>
    </button>
  );
}

function WifiStrip({ ssid, password, theme }: { ssid?: string | null; password?: string | null; theme: "dark" | "light" }) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  function copyPwd() {
    if (!password) return;
    navigator.clipboard.writeText(password);
    setCopied(true);
    toast.success("Senha copiada");
    setTimeout(() => setCopied(false), 1600);
  }
  const masked = password ? "•".repeat(Math.min(password.length, 12)) : "—";
  const isLight = theme === "light";
  return (
    <div className={`wifi-shimmer relative overflow-hidden rounded-2xl backdrop-blur-sm shadow-[0_8px_30px_-12px_oklch(from_var(--accent)_l_c_h/0.35)] ${
      isLight
        ? "bg-[linear-gradient(135deg,oklch(from_var(--card)_l_c_h/0.98)_0%,oklch(from_var(--card)_l_c_h/0.94)_60%,oklch(from_var(--card)_l_c_h/0.98)_100%)]"
        : "bg-[linear-gradient(135deg,oklch(0.18_0.04_55/0.95)_0%,oklch(0.12_0.02_50/0.92)_60%,oklch(0.08_0.01_45/0.95)_100%)]"
    }`}>

        {/* subtle dot pattern */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:radial-gradient(oklch(var(--accent))_1px,transparent_1px)] [background-size:14px_14px]" />
        {/* corner glow */}
        <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-accent/20 blur-3xl" />

        <div className="relative flex items-center gap-3.5 px-4 py-3.5">
          <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_30%_30%,oklch(var(--accent)/0.35),oklch(var(--accent)/0.05))] text-accent ring-1 ring-accent/45">
            <span className="wifi-pulse pointer-events-none absolute inset-0 rounded-full bg-accent/25 blur-md" />
            <Wifi className="relative size-[18px]" strokeWidth={1.75} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <p className="text-[9px] uppercase tracking-[0.32em] text-accent font-semibold">Wi-Fi</p>
              <span className="h-px flex-1 bg-gradient-to-r from-accent/40 to-transparent" />
            </div>
            <p className="text-[13px] text-foreground/90 truncate font-medium mt-0.5">{ssid || "Rede da casa"}</p>
            <p className="font-mono text-[13px] tracking-[0.2em] text-foreground/85 mt-0.5 truncate">
              {password ? (reveal ? password : masked) : "—"}
            </p>
          </div>
          {password && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Ocultar senha" : "Revelar senha"}
                className="grid size-8 place-items-center rounded-full border border-border/50 bg-background/30 text-foreground/75 hover:text-foreground hover:border-accent/60 transition-colors"
              >
                {reveal ? <EyeOff className="size-3.5" strokeWidth={1.75} /> : <Eye className="size-3.5" strokeWidth={1.75} />}
              </button>
              <button
                onClick={copyPwd}
                aria-label="Copiar senha"
                className="grid size-8 place-items-center rounded-full bg-accent text-accent-foreground hover:brightness-110 transition-all shadow-[0_4px_12px_-4px_oklch(var(--accent)/0.6)]"
              >
                {copied ? <Check className="size-3.5" strokeWidth={2.25} /> : <Copy className="size-3.5" strokeWidth={2} />}
              </button>
            </div>
          )}
        </div>
      </div>

  );
}

