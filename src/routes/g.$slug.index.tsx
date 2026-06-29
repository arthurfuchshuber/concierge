import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getPublicGuide, submitPin, submitAccessPin } from "@/lib/guide.functions";
import { trackGuideEvent } from "@/lib/guide-analytics.functions";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  Lock, MapPin, Wifi, Phone, KeyRound, Compass, ListChecks, LifeBuoy, HelpCircle,
  Copy, Check, ArrowLeft, ArrowRight, Home, Eye, EyeOff, Clock, ExternalLink, Car,
  Sun, Moon, UserRound, UtensilsCrossed, Wind, Tv, ShowerHead, PawPrint, WashingMachine, Waves, Refrigerator, Flame, Lightbulb, Trash2, Bath, BedDouble, ChevronRight, ChevronDown, MessageCircle, LogIn, LogOut, PlayCircle, ListOrdered,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GuideAiChat } from "@/components/GuideAiChat";
import { GuideAccessGate, readAccessRecord, type AccessRecord } from "@/components/GuideAccessGate";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/g/$slug/")({
  loader: async ({ params }) => {
    const r = await getPublicGuide({ data: { slug: params.slug } });
    if (r.status === "not_found") throw notFound();
    return r;
  },
  head: ({ loaderData, params }) => {
    if (!loaderData || loaderData.status !== "ok") {
      return { meta: [{ title: "Guia — SigmaGuide" }, { name: "robots", content: "noindex" }] };
    }
    const p = loaderData.property as Record<string, unknown>;
    const name = p.name as string;
    const city = (p.city as string | null) ?? null;
    const tagline = (p.tagline as string | null) ?? null;
    const title = `${name} — Guia do Hóspede`;
    const baseDesc =
      tagline ||
      `Guia digital de ${name}${city ? ` em ${city}` : ""}: instruções de chegada, Wi-Fi, manual da casa e recomendações selecionadas pelo anfitrião.`;
    const desc = baseDesc.length < 60
      ? `${baseDesc} Tudo o que você precisa para uma estadia tranquila${city ? ` em ${city}` : ""}.`
      : baseDesc;
    const url = `https://guiadigital.anfitriaosigma.com.br/g/${params.slug}`;
    const address = (p.address as string | null) ?? null;
    const ldAccommodation: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "LodgingBusiness",
      name,
      description: desc,
      url,
      ...(p.hero_image_url ? { image: p.hero_image_url as string } : {}),
      ...(address || city
        ? {
            address: {
              "@type": "PostalAddress",
              ...(address ? { streetAddress: address } : {}),
              ...(city ? { addressLocality: city } : {}),
            },
          }
        : {}),
      ...(p.lat != null && p.lng != null
        ? {
            geo: {
              "@type": "GeoCoordinates",
              latitude: p.lat as number,
              longitude: p.lng as number,
            },
          }
        : {}),
    };
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        ...(p.hero_image_url ? [{ property: "og:image", content: p.hero_image_url as string }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(ldAccommodation),
        },
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
type Section = "home" | "checkin" | "saida" | "wifi" | "residencia" | "regras" | "faq";

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

function Lockable({ locked, children }: { locked: boolean; children: React.ReactNode }) {
  if (!locked) return <>{children}</>;
  return (
    <div className="relative min-h-[80px]">
      {/* Blurred content behind — kept for layout space */}
      <div className="blur-md select-none pointer-events-none opacity-60" aria-hidden>
        {children}
      </div>
      {/* Overlay — always fully visible, never clipped */}
      <div className="absolute inset-0 flex items-center justify-center px-3 py-2">
        <div className="w-full rounded-2xl bg-background/95 backdrop-blur-sm border border-border/60 shadow-lg overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="size-8 rounded-xl bg-muted grid place-items-center shrink-0">
              <Lock className="size-4 text-muted-foreground" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground leading-tight">Acesso encerrado</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                Disponível 24h antes até 12h após o check-in.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Guide({ data }: { data: GuideOk }) {

  const baseProp = data.property as Record<string, any>;
  const [revealedCodes, setRevealedCodes] = useState<{ wifi_password?: string | null; lock_code?: string | null; gate_code?: string | null }>({});
  const p = useMemo(() => {
    if (!revealedCodes || (revealedCodes.wifi_password == null && revealedCodes.lock_code == null && revealedCodes.gate_code == null)) {
      return baseProp;
    }
    return { ...baseProp, ...revealedCodes };
  }, [baseProp, revealedCodes]);
  const { slug } = Route.useParams();
  const [section, setSection] = useState<Section>("home");
  const trackEvent = useServerFn(trackGuideEvent);


  function gotoSection(s: Section) {
    setSection(s);
    // Fire-and-forget analytics — never blocks navigation
    const sid = typeof window !== "undefined"
      ? (localStorage.getItem(`guide-chat-session:${slug}`) ?? "anon")
      : "anon";
    trackEvent({ data: { slug, section: s, sessionId: sid } }).catch(() => {});
  }
  const { lang, setLang } = useI18n();

  // Auto-detect browser language on first visit (if no saved preference)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("sg-lang");
    if (saved === "pt" || saved === "en") return; // respect saved preference
    const nav = navigator.language ?? navigator.languages?.[0] ?? "";
    if (nav.toLowerCase().startsWith("pt")) setLang("pt");
    else setLang("en");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Identification gate is ALWAYS shown on first access (per host requirement).
  // The reservation code is only required when "exigir identificação do hóspede" is enabled.
  const gateEnabled = !!p.require_access_gate;
  // Modo "preview" para admin do SaaS dentro do iframe (?preview=1): pula o gate
  // e mostra o conteúdo do guia diretamente, sem exigir preenchimento.
  const isPreview =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview") === "1";
  const [accessRec, setAccessRec] = useState<AccessRecord | null>(() => {
    if (isPreview) {
      const today = new Date().toISOString().slice(0, 10);
      return {
        name: "Pré-visualização",
        code: null,
        checkinDate: today,
        checkoutDate: today,
        phone: null,
        phoneCountry: null,
      };
    }
    return null;
  });
  // Hidrata o registro do localStorage somente após mount (evita mismatch SSR
  // que descartava o registro e fazia o popup reaparecer a cada acesso).
  const [gateReady, setGateReady] = useState(isPreview);
  useEffect(() => {
    if (isPreview) return;
    const rec = readAccessRecord(slug);
    if (rec) setAccessRec(rec);
    setGateReady(true);
  }, [slug, isPreview]);
  const needsGate = gateReady && !accessRec && !isPreview;



  // (Wi-Fi e senhas de acesso agora seguem apenas a regra de check-out às
  // 15h00 — `checkinLocked` abaixo. A antiga regra "12h após check-in" foi
  // removida porque o hóspede pode precisar consultar as senhas a qualquer
  // momento durante a estadia.)


  // Informações sensíveis (Wi-Fi, senhas de acesso) permanecem disponíveis
  // dentro da página "Chegada" até as 15h00 do dia do check-out.
  const checkinLocked = (() => {
    if (!accessRec?.checkoutDate) return false;
    const [y, mo, d] = accessRec.checkoutDate.split("-").map(Number);
    if (!y || !mo || !d) return false;
    const end = new Date(y, mo - 1, d, 15, 0, 0, 0).getTime();
    return Date.now() > end;
  })();

  // Faixas da home: visíveis somente de 8h antes do check-in até 12h após
  // a data e hora do check-in informados pelo anfitrião.
  const homeStripsVisible = (() => {
    if (!accessRec?.checkinDate) return false;
    const t = String(p.checkin_time ?? "15:00").match(/^(\d{1,2}):(\d{2})/);
    const hh = t ? Number(t[1]) : 15;
    const mm = t ? Number(t[2]) : 0;
    const [y, mo, d] = accessRec.checkinDate.split("-").map(Number);
    if (!y || !mo || !d) return false;
    const ci = new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
    const now = Date.now();
    return now >= ci - 8 * 3600_000 && now <= ci + 12 * 3600_000;
  })();

  // Aviso de check-out: aparece como faixa na home a partir das 3h00 do
  // dia do check-out e até as 15h00 do mesmo dia.
  const checkoutNoticeVisible = (() => {
    if (!accessRec?.checkoutDate) return false;
    if (!p.checkout_note && !p.checkout_time) return false;
    const [y, mo, d] = accessRec.checkoutDate.split("-").map(Number);
    if (!y || !mo || !d) return false;
    const start = new Date(y, mo - 1, d, 3, 0, 0, 0).getTime();
    const end = new Date(y, mo - 1, d, 15, 0, 0, 0).getTime();
    const now = Date.now();
    return now >= start && now <= end;
  })();


  // Shared "access PIN unlock" state — once unlocked, all gated codes/Wi-Fi reveal.
  // The actual PIN never reaches the browser; only the boolean flags do.
  const hasAccessPin = !!(p as any).hasAccessPin;
  const initialUnlocked = !!(p as any).accessUnlocked;
  const [unlocked, setUnlocked] = useState(initialUnlocked);


  const [pinDialog, setPinDialog] = useState<{ open: boolean; cb: (() => void) | null }>({ open: false, cb: null });
  const requestUnlock = (cb?: () => void) => {
    if (!hasAccessPin || unlocked) {
      if (!unlocked) setUnlocked(true);
      cb?.();
      return;
    }
    setPinDialog({ open: true, cb: cb ?? null });
  };


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

  function toggleLang() {
    const cycle: import("@/lib/i18n").Lang[] = ["pt", "en", "es", "fr"];
    const idx = cycle.indexOf(lang as import("@/lib/i18n").Lang);
    const next = cycle[(idx + 1) % cycle.length];
    setLang(next);
  }


  const galleryRaw: string[] = Array.isArray(p.gallery_images) ? p.gallery_images : [];
  const photos: string[] = galleryRaw.length ? galleryRaw : p.hero_image_url ? [p.hero_image_url] : [];
  const heroImg = photos[0];
  const heroTitle = cleanGuideTitle(p.name, p.city);

  const rules = data.manual.filter(isRule);
  const houseManual = data.manual.filter((m: any) => !isRule(m));

  // Category availability — hide a card entirely when no sub-item has content
  const hasCheckin = !!(p.checkin_time || p.checkin_note || p.address || p.maps_url || p.address_note || p.gate_code || p.lock_code || p.wifi_ssid || p.checkin_instructions);
  const hasSaida = !!(p.checkout_time || p.checkout_note || p.checkout_instructions);
  const hasResidencia = houseManual.length > 0;
  const hasFaq = !!(p.host_name || p.host_phone) || data.emergency.length > 0 || data.faqs.length > 0;
  const hasExplore = (Array.isArray(data.recommendations) && data.recommendations.length > 0) ||
    (Array.isArray((data as any).cityReferences) && (data as any).cityReferences.length > 0);

  // Pick images for cards: theme_images first, then gallery fallback, then hero
  const themeImages = (p.theme_images ?? {}) as Record<string, string | undefined>;
  const pick = (i: number) => photos[i % Math.max(photos.length, 1)] ?? heroImg;
  const themePick = (key: string, fallbackIdx: number) => themeImages[key] || pick(fallbackIdx);

  // Dynamic descriptions — real info visible before the card is opened
  const checkinDesc = (() => {
    const parts: string[] = [];
    if (p.checkin_time) {
      const t = String(p.checkin_time).match(/^(\d{1,2}):(\d{2})/);
      if (t) parts.push(`Check-in a partir das ${t[1].padStart(2,"0")}h${t[2] !== "00" ? t[2] : ""}`);
    }
    if (p.wifi_ssid) parts.push(`Wi-Fi: ${p.wifi_ssid}`);
    return parts[0] ?? "Endereço, códigos de acesso e horários.";
  })();

  const saidaDesc = (() => {
    if (p.checkout_time) {
      const t = String(p.checkout_time).match(/^(\d{1,2}):(\d{2})/);
      if (t) return `Check-out até ${t[1].padStart(2,"0")}h${t[2] !== "00" ? t[2] : ""}`;
    }
    return "Horário e instruções para o check-out.";
  })();

  const residenciaDesc = houseManual.length > 0
    ? `${houseManual.length} ${houseManual.length === 1 ? "item" : "itens"} no manual da casa`
    : "Manual, comodidades e detalhes da casa.";

  const exploreDesc = (() => {
    const total = (Array.isArray(data.recommendations) ? data.recommendations.length : 0) +
      (Array.isArray((data as any).cityReferences) ? (data as any).cityReferences.length : 0);
    if (total > 0) return `${total} ${total === 1 ? "lugar curado" : "lugares curados"} pelo anfitrião`;
    return "Restaurantes, atrações e experiências.";
  })();

  const faqDesc = (() => {
    if (p.host_name) return `Fale com ${p.host_name}`;
    if (data.faqs.length > 0) return `${data.faqs.length} pergunta${data.faqs.length > 1 ? "s" : ""} frequente${data.faqs.length > 1 ? "s" : ""}`;
    return "Anfitrião, emergências e respostas rápidas.";
  })();

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
      title: "Chegada",
      desc: checkinDesc,
      icon: <KeyRound className="size-5" strokeWidth={1.5} />,
      image: themePick("checkin", 1),
      visible: hasCheckin,
      to: { kind: "section", value: "checkin" },
    },
    {
      key: "saida",
      eyebrow: "Estadia",
      title: "Saída",
      desc: saidaDesc,
      icon: <LogOut className="size-5" strokeWidth={1.5} />,
      image: themePick("saida", 5),
      visible: hasSaida,
      to: { kind: "section", value: "saida" },
    },
    {
      key: "residencia",
      eyebrow: "A casa",
      title: "A Residência",
      desc: residenciaDesc,
      icon: <Home className="size-5" strokeWidth={1.5} />,
      image: themePick("residencia", 2),
      visible: hasResidencia,
      to: { kind: "section", value: "residencia" },
    },
    {
      key: "explore",
      eyebrow: "Concierge",
      title: "Explore a Região",
      desc: exploreDesc,
      icon: <Compass className="size-5" strokeWidth={1.5} />,
      image: themePick("explore", 4),
      visible: hasExplore,
      to: { kind: "link", to: `/g/${slug}/explorar` },
    },
    {
      key: "faq",
      eyebrow: "Suporte",
      title: "Dúvidas",
      desc: faqDesc,
      icon: <HelpCircle className="size-5" strokeWidth={1.5} />,
      image: themePick("faq", 3),
      visible: hasFaq,
      to: { kind: "section", value: "faq" },
    },
  ];
  const cards = allCards.filter((c) => c.visible);

  return (
    <div className={`sigma-public-guide guide-ambient min-h-screen bg-background text-foreground pb-16 ${theme === "light" ? "theme-light" : ""}`}>
      {needsGate && (
        <GuideAccessGate slug={slug} propertyName={p.name as string} requireReservationCode={gateEnabled} onUnlock={setAccessRec} />
      )}
      <div className="mx-auto w-full max-w-md md:max-w-none">
        <AnimatePresence mode="wait" initial={false}>
        {section === "home" ? (
          <motion.div
            key="home"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
          >
            <HeroCompact
              name={heroTitle}
              tagline={p.tagline}
              city={p.city}
              photos={photos}
              theme={theme}
              onToggleTheme={toggleTheme}
              lang={lang}
              onToggleLang={toggleLang}
            />


            {/* Faixas com Wi-Fi e códigos: aparecem de 8h antes do check-in
                até 12h depois. O conteúdo continua travado pelo PIN até o
                hóspede liberá-lo. */}
            {homeStripsVisible && (
              <div className="px-5 md:px-10 lg:px-16 -mt-2 md:-mt-3 relative z-10 mb-3 md:mb-4 space-y-2.5">
                {p.wifi_ssid && (
                  <div className="md:max-w-md lg:max-w-lg">
                    <WifiStrip
                      ssid={p.wifi_ssid}
                      password={p.wifi_password}
                      passwordSet={!!((p as any).wifi_password_set || p.wifi_password)}
                      theme={theme}
                      unlocked={unlocked}
                      requestUnlock={requestUnlock}
                      checkinLocked={checkinLocked}
                      hasAccessRec={!!accessRec}
                      gateEnabled={gateEnabled}
                    />
                  </div>
                )}
                {((p as any).gate_code_set || (p as any).lock_code_set || p.gate_code || p.lock_code) && (
                  <div className="md:max-w-md lg:max-w-lg">
                    <AccessCodesStrip
                      gateCode={p.gate_code as string | null}
                      lockCode={p.lock_code as string | null}
                      gateCodeSet={!!((p as any).gate_code_set || p.gate_code)}
                      lockCodeSet={!!((p as any).lock_code_set || p.lock_code)}
                      gateLabel={(p.gate_label as string | null) || "Portão"}
                      lockLabel={(p.lock_label as string | null) || "Fechadura"}
                      unlocked={unlocked}
                      requestUnlock={requestUnlock}
                      checkinLocked={checkinLocked}
                      hasAccessRec={!!accessRec}
                      gateEnabled={gateEnabled}
                      theme={theme}
                      checkinInstructions={p.checkin_instructions as string | null}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Aviso de check-out: aparece a partir das 3h00 do dia do
                check-out, levando o lembrete configurado pelo anfitrião. */}
            {checkoutNoticeVisible && (
              <div className="px-5 md:px-10 lg:px-16 -mt-2 md:-mt-3 relative z-10 mb-3 md:mb-4">
                <div className="md:max-w-md lg:max-w-lg">
                  <CheckoutNoticeStrip
                    note={(p.checkout_note as string | null) || null}
                    checkoutTime={(p.checkout_time as string | null) || null}
                    theme={theme}
                  />
                </div>
              </div>
            )}



            <section id="guide-actions" className="px-5 md:px-10 lg:px-16 relative z-10">
              <div className="flex items-center gap-3 mb-3 md:mb-5">
                <p className="shrink-0 text-[9px] uppercase tracking-[0.3em] text-accent/75 font-semibold">
                  O que você deseja acessar?
                </p>
                <span className="h-px flex-1 bg-accent/20" />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
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
                      onClick={() => c.to?.kind === "section" && gotoSection(c.to.value)}
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
                <img src={p.brand_logo_url} alt={p.brand_name ? `Logotipo ${p.brand_name}` : "Logotipo da hospedagem"} loading="lazy" className="h-5 w-auto object-contain opacity-80" />
              ) : (
                <GuideMark className="size-3.5 text-accent/70" />
              )}
              <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/80 font-semibold">
                {p.brand_name || "Seu guia. Sua experiência."}
              </p>
            </footer>

          </motion.div>
        ) : (
          <motion.div
            key={section}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -18 }}
            transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
          >
          <Tabs value={section} onValueChange={(v) => setSection(v as Section)} className="px-5 md:px-10 lg:px-16 pt-6 md:pt-10 lg:max-w-3xl lg:mx-auto">
            <button
              type="button"
              onClick={() => gotoSection("home")}
              aria-label="Voltar ao guia"
              className="fixed left-3 md:left-6 top-1/2 -translate-y-1/2 z-30 grid place-items-center size-11 rounded-full bg-accent/15 backdrop-blur-md border border-accent/35 text-accent/85 shadow-md hover:text-accent hover:bg-accent/25 hover:scale-105 transition-all"
            >
              <ArrowLeft className="size-5" strokeWidth={1.75} />
            </button>


            <TabsContent value="checkin" className="space-y-5">
              <SectionTitle eyebrow="Estadia" title="Chegada" intro="Tudo o que você precisa para chegar e se acomodar." />

              {(() => {
                const hasHorario = !!p.checkin_time;
                const hasChegada = !!(p.address || p.maps_url || p.address_note || p.checkin_instructions || (Array.isArray(p.checkin_media) && p.checkin_media.length > 0));
                const gateMedia = Array.isArray(p.gate_media) ? (p.gate_media as Array<{ url: string; type: "image" | "video" }>) : [];
                const lockMedia = Array.isArray(p.lock_media) ? (p.lock_media as Array<{ url: string; type: "image" | "video" }>) : [];
                const gateCodeSet = !!((p as any).gate_code_set || p.gate_code);
                const lockCodeSet = !!((p as any).lock_code_set || p.lock_code);
                const hasGateExtras = !!(gateCodeSet && (p.gate_instructions || p.gate_video_url || gateMedia.length > 0));
                const hasLockExtras = !!(lockCodeSet && (p.lock_instructions || p.lock_video_url || lockMedia.length > 0));
                const hasAcesso = !!(gateCodeSet || lockCodeSet || hasGateExtras || hasLockExtras);
                const hasWifi = !!p.wifi_ssid;
                const hasRules = !!(p as Record<string, unknown>).house_rules;
                if (!hasHorario && !hasChegada && !hasAcesso && !hasWifi && !hasRules) {
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
                const noveNoveUrl = hasCoords
                  ? `https://99app.com/open/?destination_lat=${p.lat}&destination_lng=${p.lng}${p.address ? `&destination_address=${encodeURIComponent(String(p.address))}` : ""}`
                  : p.address
                    ? `https://99app.com/open/?destination_address=${encodeURIComponent(String(p.address))}`
                    : null;
                return (
                  <SubList>
                    {hasHorario && (() => {
                      const raw = String(p.checkin_time ?? "").trim();
                      const rawMax = String(p.checkin_time_max ?? "").trim();
                      const lower = raw.toLowerCase();
                      const fmt = (s: string) => {
                        const m = s.match(/^(\d{1,2}):(\d{2})/);
                        return m ? `${m[1].padStart(2, "0")}h${m[2]}` : s;
                      };
                      const isFlex = /flex/i.test(lower);
                      const isAgend = /agend/i.test(lower);
                      let summary: string;
                      if (isFlex) summary = "Check-In flexível";
                      else if (isAgend) summary = "Check-In sob agendamento";
                      else if (raw && rawMax) summary = `Entre ${fmt(raw)} e ${fmt(rawMax)}`;
                      else summary = `A partir de ${fmt(raw)}`;
                      return (
                        <SubItem
                          icon={<Clock className="size-[18px]" strokeWidth={1.6} />}
                          label="Horários de Check-In"
                          hint={summary}
                        >
                          {isFlex || isAgend ? (
                            <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3.5">
                              <p className="text-[14px] text-foreground/80 leading-relaxed">
                                {isFlex
                                  ? "A chegada pode ser feita em qualquer horário — combine com o anfitrião quando estiver a caminho."
                                  : "Combine seu horário de chegada diretamente com o anfitrião antes da viagem."}
                              </p>
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-border/60 bg-background/40 overflow-hidden divide-y divide-border/40">
                              <div className="flex items-center justify-between px-4 py-3">
                                <span className="text-[13px] uppercase tracking-wide text-muted-foreground">A partir de</span>
                                <span className="text-[15px] font-semibold tabular-nums text-foreground">{fmt(raw)}</span>
                              </div>
                              {rawMax && (
                                <div className="flex items-center justify-between px-4 py-3">
                                  <span className="text-[13px] uppercase tracking-wide text-muted-foreground">Até</span>
                                  <span className="text-[15px] font-semibold tabular-nums text-foreground">{fmt(rawMax)}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {p.checkin_note && (
                            <div className="mt-3 rounded-2xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-accent/75 font-semibold mb-1.5">Observação</p>
                              <p className="text-[14px] text-foreground/85 leading-relaxed whitespace-pre-line">{String(p.checkin_note)}</p>
                            </div>
                          )}
                        </SubItem>
                      );
                    })()}


                    {hasChegada && (
                      <SubItem
                        icon={<MapPin className="size-[18px]" strokeWidth={1.6} />}
                        label="Localização"
                        hint={p.city || (p.address ? "Como chegar" : undefined)}
                      >
                        <div className="space-y-7">
                          {p.address_note && (
                            <div className="space-y-3 text-[14px] leading-relaxed text-foreground/85 px-1">
                              {String(p.address_note)
                                .split(/\n\s*\n/)
                                .map((para: string, i: number) => (
                                  <p key={i} className="whitespace-pre-line">{para}</p>
                                ))}
                            </div>
                          )}
                          {(() => {
                            const garageHref = safeHttpsHref(p.garage_maps_url);
                            const hasAnyLink = !!(p.address || p.maps_url || garageHref || uberUrl || noveNoveUrl);
                            if (!hasAnyLink) return null;
                            return (
                              <div className="rounded-2xl bg-background/40 border border-border/60 overflow-hidden divide-y divide-border/40">
                                {mapsHref && (
                                  <a
                                    href={mapsHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 px-3.5 py-3.5 hover:bg-card/40 active:bg-card/60 transition-colors"
                                  >
                                    <span className="size-8 rounded-lg bg-accent/10 text-accent/75 grid place-items-center shrink-0">
                                      <MapPin className="size-[14px]" strokeWidth={1.75} />
                                    </span>
                                    <div className="flex-1 min-w-0 text-left">
                                      <p className="text-[14px] font-medium leading-tight">
                                        {garageHref ? "Como chegar — Entrada principal" : "Abrir no Google Maps"}
                                      </p>
                                      {p.address && <p className="text-[12px] text-muted-foreground truncate mt-1">{p.address}</p>}
                                    </div>
                                    <ExternalLink className="size-4 text-muted-foreground shrink-0" />
                                  </a>
                                )}
                                {garageHref && (
                                  <a
                                    href={garageHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 px-3.5 py-3.5 hover:bg-card/40 active:bg-card/60 transition-colors"
                                  >
                                    <span className="size-8 rounded-lg bg-accent/10 text-accent/75 grid place-items-center shrink-0">
                                      <Car className="size-[14px]" strokeWidth={1.75} />
                                    </span>
                                    <div className="flex-1 min-w-0 text-left">
                                      <p className="text-[14px] font-medium leading-tight">Como chegar — Garagem</p>
                                      <p className="text-[12px] text-muted-foreground mt-1">Entrada pelo acesso da garagem</p>
                                    </div>
                                    <ExternalLink className="size-4 text-muted-foreground shrink-0" />
                                  </a>
                                )}
                              {uberUrl && (
                                <a
                                  href={uberUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-3 px-3.5 py-3.5 hover:bg-card/40 active:bg-card/60 transition-colors"
                                >
                                  <span className="size-8 rounded-lg bg-foreground text-background grid place-items-center shrink-0">
                                    <Car className="size-[14px]" strokeWidth={1.75} />
                                  </span>
                                  <div className="flex-1 min-w-0 text-left">
                                    <p className="text-[14px] font-medium leading-tight">Pedir Uber</p>
                                    <p className="text-[12px] text-muted-foreground mt-1">Corrida até o endereço</p>
                                  </div>
                                  <ExternalLink className="size-4 text-muted-foreground shrink-0" />
                                </a>
                              )}
                              {noveNoveUrl && (
                                <a
                                  href={noveNoveUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-3 px-3.5 py-3.5 hover:bg-card/40 active:bg-card/60 transition-colors"
                                >
                                  <span className="size-8 rounded-lg bg-[#FFD400] text-black grid place-items-center shrink-0 font-bold text-[11px] tracking-tight">
                                    99
                                  </span>
                                  <div className="flex-1 min-w-0 text-left">
                                    <p className="text-[14px] font-medium leading-tight">Pedir 99</p>
                                    <p className="text-[12px] text-muted-foreground mt-1">Corrida até o endereço</p>
                                  </div>
                                  <ExternalLink className="size-4 text-muted-foreground shrink-0" />
                                </a>
                              )}
                              </div>
                            );
                          })()}
                        </div>
                      </SubItem>
                    )}

                    {(p.checkin_instructions || (Array.isArray(p.checkin_media) && p.checkin_media.length > 0)) && (
                      <SubItem
                        icon={<LogIn className="size-[18px]" strokeWidth={1.6} />}
                        label="Check-in"
                        hint="Passo a passo da chegada"
                      >
                        <Lockable locked={checkinLocked}>
                          <div className="space-y-4">
                            {p.checkin_instructions && (
                              <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-4">
                                <StepList text={String(p.checkin_instructions)} dense />
                              </div>
                            )}
                            {Array.isArray(p.checkin_media) && p.checkin_media.length > 0 && (
                              <div className="grid grid-cols-2 gap-2">
                                {(p.checkin_media as Array<{ url: string; type: "image" | "video" }>).map((m, i) => (
                                  <div key={i} className="rounded-xl overflow-hidden border border-border bg-muted/40 aspect-square">
                                    {m.type === "video" ? (
                                      <video src={m.url} className="size-full object-cover" controls playsInline preload="metadata" />
                                    ) : (
                                      <img src={m.url} alt={`Instruções de check-in da hospedagem${p.name ? ` ${p.name}` : ""} — foto ${i + 1}`} className="size-full object-cover" loading="lazy" />
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </Lockable>
                      </SubItem>
                    )}

                    {hasAcesso && (() => {
                      const gateLabel = ((p.gate_label as string | null) || "Portão").trim() || "Portão";
                      const lockLabel = ((p.lock_label as string | null) || "Fechadura").trim() || "Fechadura";
                      const accessCount = (gateCodeSet ? 1 : 0) + (lockCodeSet ? 1 : 0);
                      const accessLabel = accessCount > 1 ? "Senhas de Acessos" : "Senha de Acesso";
                      return (
                      <SubItem
                        icon={<KeyRound className="size-[18px]" strokeWidth={1.6} />}
                        label={accessLabel}
                        hint={
                          gateCodeSet && lockCodeSet
                            ? `${gateLabel} e ${lockLabel.toLowerCase()}`
                            : gateCodeSet
                            ? gateLabel
                            : lockCodeSet
                            ? lockLabel
                            : "Instruções de entrada"
                        }
                      >
                        <Lockable locked={checkinLocked}>
                          <div className="space-y-4">
                            {gateCodeSet && (
                              <AccessBlock
                                kind="gate"
                                label={gateLabel}
                                code={p.gate_code ?? ""}
                                instructions={p.gate_instructions as string | null}
                                videoUrl={p.gate_video_url as string | null}
                                media={gateMedia}
                                unlocked={unlocked}
                                requestUnlock={requestUnlock}
                                hasPin={hasAccessPin}
                              />
                            )}
                            {lockCodeSet && (
                              <AccessBlock
                                kind="lock"
                                label={lockLabel}
                                code={p.lock_code ?? ""}
                                instructions={p.lock_instructions as string | null}
                                videoUrl={p.lock_video_url as string | null}
                                media={lockMedia}
                                unlocked={unlocked}
                                requestUnlock={requestUnlock}
                                hasPin={hasAccessPin}
                              />
                            )}
                          </div>
                        </Lockable>
                      </SubItem>
                      );
                    })()}

                    {hasWifi && (
                      <SubItem
                        icon={<Wifi className="size-[18px]" strokeWidth={1.6} />}
                        label="Senha do Wi-Fi"
                        hint={p.wifi_ssid || undefined}
                      >
                        <div className="rounded-xl bg-background/50 border border-border/50 overflow-hidden divide-y divide-border/40">
                          <div className="flex items-center gap-3 px-3.5 py-3">
                            <div className="size-9 rounded-lg bg-accent/10 text-accent/75 grid place-items-center shrink-0">
                              <Wifi className="size-[18px]" strokeWidth={1.75} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Rede</p>
                              <p className="text-[15px] font-semibold tracking-tight mt-0.5 break-all leading-snug">{p.wifi_ssid}</p>
                            </div>
                          </div>
                          {((p as any).wifi_password_set || p.wifi_password) && (
                            <Lockable locked={checkinLocked}>
                              <GatedCopyCard
                                icon={<KeyRound className="size-[18px]" strokeWidth={1.75} />}
                                eyebrow="Senha"
                                value={p.wifi_password ?? ""}
                                unlocked={unlocked}
                                requestUnlock={requestUnlock}
                                hasPin={hasAccessPin}
                              />
                            </Lockable>
                          )}
                        </div>
                      </SubItem>
                    )}

                    {hasRules ? (
                      <SubItem
                        icon={<ListChecks className="size-[18px]" strokeWidth={1.6} />}
                        label="Proibido Neste Espaço"
                        hint="O que não é permitido durante a estadia"
                      >
                        <RulesGrid text={String((p as Record<string, unknown>).house_rules)} />
                      </SubItem>
                    ) : null}

                  </SubList>
                );
              })()}
              <TaggedFaqs faqs={data.faqs} tag="chegada" />
            </TabsContent>

            <TabsContent value="saida" className="space-y-5">
              <SectionTitle eyebrow="Estadia" title="Saída" intro="Tudo o que você precisa para o check-out." />

              {(() => {
                const hasHorarioOut = !!p.checkout_time;
                const hasInstr = !!p.checkout_instructions;
                if (!hasHorarioOut && !hasInstr) {
                  return <p className="text-sm text-muted-foreground">Sem informações cadastradas.</p>;
                }
                return (
                  <SubList>
                    {hasHorarioOut && (() => {
                      const raw = String(p.checkout_time ?? "").trim();
                      const rawMin = String(p.checkout_time_min ?? "").trim();
                      const lower = raw.toLowerCase();
                      const fmt = (s: string) => {
                        const m = s.match(/^(\d{1,2}):(\d{2})/);
                        return m ? `${m[1].padStart(2, "0")}h${m[2]}` : s;
                      };
                      const isFlex = /flex/i.test(lower);
                      const isAgend = /agend/i.test(lower);
                      let summary: string;
                      if (isFlex) summary = "Check-out flexível";
                      else if (isAgend) summary = "Check-out sob agendamento";
                      else if (raw && rawMin) summary = `Entre ${fmt(rawMin)} e ${fmt(raw)}`;
                      else summary = `Até ${fmt(raw)}`;
                      return (
                        <SubItem
                          icon={<Clock className="size-[18px]" strokeWidth={1.6} />}
                          label="Horários de Check-Out"
                          hint={summary}
                        >
                          {isFlex || isAgend ? (
                            <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3.5">
                              <p className="text-[14px] text-foreground/80 leading-relaxed">
                                {isFlex
                                  ? "A saída pode ser feita em horário flexível — alinhe com o anfitrião."
                                  : "Combine seu horário de saída diretamente com o anfitrião."}
                              </p>
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-border/60 bg-background/40 overflow-hidden divide-y divide-border/40">
                              {rawMin && (
                                <div className="flex items-center justify-between px-4 py-3">
                                  <span className="text-[13px] uppercase tracking-wide text-muted-foreground">A partir de</span>
                                  <span className="text-[15px] font-semibold tabular-nums text-foreground">{fmt(rawMin)}</span>
                                </div>
                              )}
                              <div className="flex items-center justify-between px-4 py-3">
                                <span className="text-[13px] uppercase tracking-wide text-muted-foreground">Até</span>
                                <span className="text-[15px] font-semibold tabular-nums text-foreground">{fmt(raw)}</span>
                              </div>
                            </div>
                          )}
                          {p.checkout_note && (
                            <div className="mt-3 px-1">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-accent/75 font-semibold mb-1.5">Observação</p>
                              <p className="text-[14px] text-foreground/85 leading-relaxed whitespace-pre-line">{String(p.checkout_note)}</p>
                            </div>
                          )}
                        </SubItem>
                      );
                    })()}

                    {hasInstr && (
                      <SubItem
                        icon={<LogOut className="size-[18px]" strokeWidth={1.6} />}
                        label="Check-out"
                        hint="Passo a passo da saída"
                      >
                        <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-4">
                          <StepList text={p.checkout_instructions as string} dense />
                        </div>
                      </SubItem>
                    )}
                  </SubList>
                );
              })()}
              <TaggedFaqs faqs={data.faqs} tag="saida" />
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
              <TaggedFaqs faqs={data.faqs} tag="residencia" />
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
                            <Check className="size-4 mt-0.5 text-accent/75 shrink-0" />
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
              <SectionTitle title="Dúvidas & Contatos" />
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
                        <span className="size-10 rounded-full bg-accent/10 text-accent/75 grid place-items-center shrink-0">
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
                    <div className="size-10 rounded-full bg-accent/10 text-accent/75 grid place-items-center text-sm font-semibold shrink-0">
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
          </motion.div>
        )}
        </AnimatePresence>
      </div>
      {data.aiEnabled ? <GuideAiChat slug={slug} propertyName={heroTitle} guestName={accessRec?.name ?? null} /> : null}
      <PinDialog
        open={pinDialog.open}
        slug={slug}
        onOpenChange={(o) => setPinDialog((s) => ({ ...s, open: o }))}
        onSuccess={(codes) => {
          setUnlocked(true);
          if (codes) setRevealedCodes(codes);
          const cb = pinDialog.cb;
          setPinDialog({ open: false, cb: null });
          cb?.();
        }}
      />

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
        <span className="grid size-10 place-items-center rounded-xl bg-accent/10 text-accent/75 group-hover:bg-accent/15 transition-colors">
          {residenciaIcon(item.title)}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-[15px] leading-snug text-foreground line-clamp-2">{item.title}</h3>
          {item.description && (
            <p className="text-[11.5px] text-muted-foreground mt-1 line-clamp-2 leading-snug">{item.description}</p>
          )}
        </div>
        <ChevronRight className="absolute top-3 right-3 size-4 text-muted-foreground/60 group-hover:text-accent/75 transition-colors" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 text-left">
              <span className="grid size-10 place-items-center rounded-xl bg-accent/10 text-accent/75 shrink-0">
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
  name, tagline, city, photos, theme, onToggleTheme, lang, onToggleLang,
}: {
  name: string; tagline?: string; city?: string; photos: string[];
  theme: "dark" | "light"; onToggleTheme: () => void;
  lang: string; onToggleLang: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const total = photos.length;
  const hasMany = total > 1;

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
      className="relative overflow-hidden px-5 md:px-10 lg:px-16 pb-24 md:pb-28 pt-4 md:pt-8 min-h-[44svh] md:min-h-[52svh] flex flex-col"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Photo slides with parallax */}
      <div className="absolute inset-0 overflow-hidden">
        {photos.map((src, i) => (
          <img
            key={`${src}-${i}`}
            src={src}
            alt=""
            style={{ transform: `translateY(${scrollY * 0.18}px) scale(1.04)`, transformOrigin: "center bottom" }}
            className={`absolute inset-0 size-full object-cover object-[center_bottom] transition-opacity duration-500 will-change-transform ${i === idx ? "opacity-100" : "opacity-0"}`}
          />
        ))}
      </div>
      {/* Elegant cinematic gradient — keeps photo vivid, deepens at bottom for legibility */}
      <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.25)_38%,rgba(0,0,0,0.02)_68%,rgba(0,0,0,0.18)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.20)_0%,transparent_22%,transparent_55%,rgba(0,0,0,0.35)_82%,rgba(0,0,0,0.85)_100%)]" />
      {/* bottom fade INTO the page background so the transition is seamless in any theme */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 md:h-72 bg-[linear-gradient(180deg,transparent_0%,color-mix(in_oklab,var(--background)_55%,transparent)_45%,var(--background)_100%)]" />


      <header className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GuideMark className="size-5 text-accent/75" />
          <p className="font-serif text-[1.25rem] leading-none text-white">
            <span>Sigma</span><span className="text-accent/80">Guide</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
            title={theme === "dark" ? "Tema claro" : "Tema escuro"}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-white/25 bg-black/30 text-white/95 backdrop-blur-md transition-colors hover:bg-accent/30 hover:text-white"
          >
            {theme === "dark" ? <Sun className="size-4" strokeWidth={1.75} /> : <Moon className="size-4" strokeWidth={1.75} />}
          </button>
        </div>
      </header>


      <div className="relative z-10 mt-auto pt-24 md:pt-32">
        {city && (
          <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-black/30 backdrop-blur-md px-3 py-1.5 text-[10.5px] md:text-[11px] font-semibold uppercase tracking-[0.22em] text-white/95">
            <MapPin className="size-3 text-accent/80" strokeWidth={2} /> {city}
          </span>
        )}
        <h1 className="font-serif text-[1.95rem] md:text-[3.5rem] leading-[1] tracking-[-0.01em] text-white text-balance max-w-[360px] md:max-w-[820px] drop-shadow-[0_2px_20px_rgba(0,0,0,0.45)] line-clamp-2">
          {name}
        </h1>

        
        {hasMany && (
          <div className="mt-5 md:mt-7 flex gap-1.5">
            {photos.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`Ir para foto ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${i === idx ? "w-6 bg-accent/80" : "w-1.5 bg-white/50 hover:bg-white/80"}`}
              />
            ))}
          </div>
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
        </>
      )}
    </section>
  );
}


function ThemeCard({
  title, desc, icon, theme = "dark",
}: {
  title: string; desc: string; icon: React.ReactNode; image?: string; theme?: "dark" | "light";
}) {
  const isLight = theme === "light";
  return (
    <div
      className={
        "group relative flex h-[150px] sm:h-[170px] md:h-[190px] flex-col overflow-hidden rounded-[20px] transition-all duration-500 ease-out hover:-translate-y-1 active:scale-[0.99] " +
        (isLight
          ? "border border-border bg-card shadow-[0_4px_18px_-8px_rgba(0,0,0,0.10)] hover:shadow-[0_18px_40px_-18px_oklch(from_var(--accent)_l_c_h/0.45),0_0_0_1px_oklch(from_var(--accent)_l_c_h/0.3)]"
          : "border border-white/10 bg-[linear-gradient(160deg,oklch(0.22_0.01_60)_0%,oklch(0.16_0.008_55)_100%)] shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)] hover:shadow-[0_24px_60px_-20px_oklch(from_var(--accent)_l_c_h/0.55),0_0_0_1px_oklch(from_var(--accent)_l_c_h/0.35)]")
      }
    >
      {/* Subtle abstract accent — pattern + soft glow */}
      <div
        aria-hidden
        className={
          "pointer-events-none absolute inset-0 " +
          (isLight ? "opacity-[0.05]" : "opacity-[0.08]") +
          " [background-image:radial-gradient(oklch(var(--accent))_1px,transparent_1px)] [background-size:14px_14px]"
        }
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-accent/20 blur-3xl opacity-60 group-hover:opacity-100 transition-opacity duration-500"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-[linear-gradient(180deg,transparent,oklch(from_var(--accent)_l_c_h/0.08))]"
      />

      <div className="relative z-10 flex h-full flex-col p-3.5 sm:p-4 md:p-5">
        <span
          className={
            "grid size-10 sm:size-11 md:size-12 place-items-center rounded-xl ring-1 transition-colors " +
            (isLight
              ? "bg-accent/15 text-accent/80 ring-accent/20 shadow-[0_4px_14px_-10px_oklch(from_var(--accent)_l_c_h/0.35)]"
              : "bg-accent/10 text-accent/75 ring-accent/15 shadow-[0_4px_14px_-10px_oklch(from_var(--accent)_l_c_h/0.28)]")
          }
        >
          <span className="[&>svg]:size-[20px] sm:[&>svg]:size-[22px] md:[&>svg]:size-6 [&>svg]:stroke-[2.2]">
            {icon}
          </span>
        </span>
        <div className="mt-auto min-w-0">
          <h3
            className={
              "font-serif text-[1.05rem] sm:text-[1.18rem] md:text-[1.3rem] leading-[1.1] tracking-tight truncate " +
              (isLight ? "text-foreground" : "text-white")
            }
          >
            {title}
          </h3>
          <p
            className={
              "mt-1 text-[11px] sm:text-[12px] md:text-[12.5px] leading-[1.45] truncate " +
              (isLight ? "text-muted-foreground" : "text-white/65")
            }
          >
            {desc}
          </p>
        </div>


      </div>
    </div>
  );
}

function SubList({ children }: { children: React.ReactNode }) {
  return (
    <Accordion type="single" collapsible className="space-y-3 md:space-y-3.5">
      {children}
    </Accordion>
  );
}

function StepList({ text, dense = false }: { text: string; dense?: boolean }) {
  const steps = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^\s*(?:\d+[.)\-º°]\s*|[-•·*]\s*)/, "").trim())
    .filter((s) => s.length > 0);
  if (steps.length === 0) return null;
  return (
    <ol className={`relative ${dense ? "space-y-5" : "space-y-6"} pl-2`}>
      {/* Vertical connector line */}
      <span aria-hidden className="pointer-events-none absolute left-[18px] top-3 bottom-3 w-px bg-gradient-to-b from-accent/50 via-accent/25 to-transparent" />
      {steps.map((step, i) => (
        <li key={i} className="relative flex items-start gap-4">
          <span
            aria-hidden
            className="relative z-10 mt-0.5 shrink-0 grid place-items-center size-9 rounded-full bg-accent/15 text-accent/85 text-[13px] font-semibold tabular-nums leading-none shadow-[0_4px_14px_-8px_oklch(from_var(--accent)_l_c_h/0.3)] ring-4 ring-background"
          >
            {i + 1}
          </span>
          <div className="flex-1 min-w-0 pt-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent/80 mb-1">Passo {i + 1}</p>
            <p className="text-[14.5px] leading-[1.6] text-foreground/90">{step}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

type RuleCategory = {
  key: string;
  label: string;
  icon: React.ReactNode;
  tone: string; // tailwind classes for icon bg/border
  patterns: RegExp[];
};

const RULE_CATEGORIES: RuleCategory[] = [
  {
    key: "silencio",
    label: "Silêncio e vizinhos",
    icon: <Moon className="size-[14px]" strokeWidth={1.9} />,
    tone: "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 ring-indigo-200/60 dark:ring-indigo-400/20",
    patterns: [/sil[êe]ncio/i, /barulh/i, /vizinh/i, /som\b/i, /m[úu]sica/i, /festa/i, /22h|23h|noite/i],
  },
  {
    key: "substancias",
    label: "Substâncias",
    icon: <Flame className="size-[14px]" strokeWidth={1.9} />,
    tone: "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-rose-200/60 dark:ring-rose-400/20",
    patterns: [/fumar|cigarr|tabac|vape|narguil/i, /[áa]lcool|bebid/i, /drog|entorpec/i],
  },
  {
    key: "animais",
    label: "Animais",
    icon: <PawPrint className="size-[14px]" strokeWidth={1.9} />,
    tone: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-200/60 dark:ring-amber-400/20",
    patterns: [/pet|animal|animais|c[ãa]o|gato/i],
  },
  {
    key: "limpeza",
    label: "Limpeza e cuidado",
    icon: <Trash2 className="size-[14px]" strokeWidth={1.9} />,
    tone: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-200/60 dark:ring-emerald-400/20",
    patterns: [/lixo|residu|sujei|limpe/i, /toalha|len[çc]ol|cama/i, /dano|estragar|quebrar/i],
  },
  {
    key: "seguranca",
    label: "Segurança",
    icon: <ShowerHead className="size-[14px]" strokeWidth={1.9} />,
    tone: "bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-200/60 dark:ring-sky-400/20",
    patterns: [/chave|fechadura|porta|port[ãa]o|janela|tranc/i, /seguran[çc]a|inc[êe]ndio|fogo/i, /piscina|crian[çc]a/i],
  },
  {
    key: "visitas",
    label: "Visitas e ocupação",
    icon: <UserRound className="size-[14px]" strokeWidth={1.9} />,
    tone: "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-200/60 dark:ring-violet-400/20",
    patterns: [/visit|convidad|h[óo]sped/i, /evento|festa|reuni/i, /sublocar|alug/i],
  },
];

function categorizeRule(rule: string): RuleCategory {
  for (const cat of RULE_CATEGORIES) {
    if (cat.patterns.some((re) => re.test(rule))) return cat;
  }
  return {
    key: "outros",
    label: "Outras combinações",
    icon: <ListChecks className="size-[14px]" strokeWidth={1.9} />,
    tone: "bg-neutral-100 dark:bg-white/5 text-neutral-700 dark:text-white/80 ring-neutral-200/60 dark:ring-white/10",
    patterns: [],
  };
}

function RulesGrid({ text }: { text: string }) {
  const rules = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^\s*(?:\d+[.)\-º°]\s*|[-•·*]\s*)/, "").trim())
    .filter(Boolean);
  if (rules.length === 0) return null;

  const groups = new Map<string, { cat: RuleCategory; items: string[] }>();
  for (const r of rules) {
    const cat = categorizeRule(r);
    const slot = groups.get(cat.key) ?? { cat, items: [] };
    slot.items.push(r);
    groups.set(cat.key, slot);
  }

  return (
    <Accordion type="single" collapsible className="space-y-2.5">
      {Array.from(groups.values()).map(({ cat, items }) => (
        <AccordionItem
          key={cat.key}
          value={cat.key}
          className="border border-border/60 rounded-2xl overflow-hidden bg-card/50 data-[state=open]:border-accent/40 transition-colors"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline [&>svg]:hidden">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className={`grid size-8 shrink-0 place-items-center rounded-xl ring-1 ${cat.tone}`}>
                {cat.icon}
              </span>
              <h4 className="flex-1 min-w-0 truncate text-[12px] font-semibold uppercase tracking-[0.18em] text-foreground/85 text-left">
                {cat.label}
              </h4>
              <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                {items.length}
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200" />
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 pt-0">
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {items.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-background/40 px-3 py-2.5"
                >
                  <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ring-1 ${cat.tone}`}>
                    <span className="size-1.5 rounded-full bg-current" />
                  </span>
                  <span className="text-[13.5px] leading-[1.45] text-foreground/85">{item}</span>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      ))}
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
    <AccordionItem value={id} className="border border-border/70 rounded-2xl overflow-hidden bg-card/60 backdrop-blur-sm data-[state=open]:border-accent/40 data-[state=open]:shadow-[0_8px_28px_-16px_oklch(from_var(--accent)_l_c_h/0.45)] transition-all">
      <AccordionTrigger className="px-5 py-4 md:py-5 hover:no-underline">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent/75 ring-1 ring-accent/15">
            {icon}
          </span>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[15.5px] leading-tight font-semibold text-foreground tracking-tight">{label}</p>
            {hint && <p className="text-[12.5px] text-muted-foreground mt-1 truncate">{hint}</p>}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-5 pb-5 pt-1">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

function AccessBlock({
  kind, label, code, instructions, videoUrl, media, unlocked, requestUnlock, hasPin,
}: {
  kind: "gate" | "lock";
  label?: string;
  code: string;
  instructions?: string | null;
  videoUrl?: string | null;
  media: Array<{ url: string; type: "image" | "video" }>;
  unlocked: boolean;
  requestUnlock: (cb?: () => void) => void;
  hasPin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const Icon = kind === "gate" ? KeyRound : Lock;
  const resolvedLabel = label?.trim() || (kind === "gate" ? "Portão" : "Fechadura");

  const hasMore = !!(instructions || videoUrl || media.length > 0);
  const showing = !hasPin || (unlocked && revealed);
  const masked = "•".repeat(Math.max(4, Math.min(code.length, 10)));

  function handleEye(e: React.MouseEvent) {
    e.stopPropagation();
    if (showing) { if (hasPin) setRevealed(false); return; }
    requestUnlock(() => setRevealed(true));
  }

  function copyCode(e: React.MouseEvent) {
    e.stopPropagation();
    const doCopy = () => {
      navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(`${resolvedLabel} copiado`);
      setTimeout(() => setCopied(false), 1500);
    };
    if (!showing) {
      requestUnlock(() => { setRevealed(true); doCopy(); });
    } else {
      doCopy();
    }
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-background/40 overflow-hidden">
      <div
        onClick={() => hasMore && setOpen((o) => !o)}
        className={`flex items-center gap-3 px-4 py-3.5 ${hasMore ? "cursor-pointer select-none hover:bg-card/30 active:bg-card/50 transition-colors" : ""}`}
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent/75">
          <Icon className="size-[14px]" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">{resolvedLabel}</p>
          <p className={`font-mono text-[15px] font-semibold tracking-[0.08em] mt-0.5 truncate ${showing ? "text-foreground" : "text-foreground/60"}`}>
            {showing ? code : masked}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasPin && (
            <button
              type="button"
              onClick={handleEye}
              aria-label={showing ? `Ocultar ${resolvedLabel}` : `Visualizar ${resolvedLabel}`}
              className="grid size-8 place-items-center rounded-full bg-foreground text-background hover:opacity-90 transition-all"
            >
              {showing ? <EyeOff className="size-3.5" strokeWidth={2} /> : <Eye className="size-3.5" strokeWidth={2} />}
            </button>
          )}
        </div>
        {hasMore && (
          <ChevronDown
            className={`size-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        )}
      </div>

      {hasMore && open && (
        <div className="px-4 pb-4 pt-1 space-y-5">
          {instructions && (
            <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-4">
              <StepList text={instructions} dense />
            </div>
          )}

          {videoUrl && (
            <a
              href={videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 group"
            >
              <PlayCircle className="size-[18px] text-accent/75 shrink-0" strokeWidth={1.75} />
              <span className="text-[14px] font-medium text-foreground flex-1 group-hover:text-accent/75 transition-colors">Assistir tutorial em vídeo</span>
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </a>
          )}

          {media.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {media.map((m, i) => (
                <div key={i} className="rounded-lg overflow-hidden border border-border/50 bg-muted/40 aspect-square">
                  {m.type === "video" ? (
                    <video src={m.url} className="size-full object-cover" controls playsInline preload="metadata" />
                  ) : (
                    <img src={m.url} alt={`${resolvedLabel} — foto ilustrativa ${i + 1}`} className="size-full object-cover" loading="lazy" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CopyCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }).catch(() => {});
      }}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-[13px] font-medium text-foreground hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors"
    >
      {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
      <span>{copied ? "Copiado" : "Copiar"}</span>
    </button>
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

function TaggedFaqs({ faqs, tag }: { faqs: any[]; tag: "chegada" | "saida" | "residencia" | "explore" }) {
  const filtered = (faqs ?? []).filter((f) => Array.isArray(f?.tags) && f.tags.includes(tag));
  if (filtered.length === 0) return null;
  return (
    <div className="pt-2">
      <div className="mb-3 flex items-center gap-2">
        <HelpCircle className="size-4 text-muted-foreground" />
        <h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground">Perguntas frequentes</h3>
      </div>
      <Accordion type="single" collapsible className="space-y-1.5">
        {filtered.map((f: any, idx: number) => (
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
            <div className="size-9 rounded-lg bg-accent/10 text-accent/75 grid place-items-center shrink-0">
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
        {icon && <div className="size-12 rounded-xl bg-gradient-to-br from-accent/12 to-accent/5 text-accent/75 grid place-items-center shrink-0">{icon}</div>}
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

function GatedCopyCard({ icon, eyebrow, value, unlocked, requestUnlock, hasPin }: {
  icon?: React.ReactNode;
  eyebrow?: string;
  value: string;
  unlocked: boolean;
  requestUnlock: (cb?: () => void) => void;
  hasPin: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const showing = !hasPin || (unlocked && revealed);
  const masked = "•".repeat(Math.max(6, Math.min(value.length, 12)));
  function copy() {
    const doCopy = () => {
      navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copiado!");
      setTimeout(() => setCopied(false), 1500);
    };
    if (!showing) requestUnlock(() => { setRevealed(true); doCopy(); });
    else doCopy();
  }
  function eye() {
    if (showing) { if (hasPin) setRevealed(false); return; }
    requestUnlock(() => setRevealed(true));
  }
  return (
    <div className="w-full flex items-center justify-between gap-3 px-3.5 py-3">
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="size-9 rounded-lg bg-accent/10 text-accent/75 grid place-items-center shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">{eyebrow}</p>}
          <p className={`text-[15px] font-semibold tracking-tight mt-0.5 break-all leading-snug ${showing ? "" : "text-foreground/60"}`}>
            {showing ? value : masked}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={copy} aria-label="Copiar" className="size-8 rounded-full bg-secondary grid place-items-center">
          {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5 text-muted-foreground" />}
        </button>
        {hasPin && (
          <button onClick={eye} aria-label={showing ? "Ocultar" : "Visualizar"} className="size-8 rounded-full bg-foreground text-background grid place-items-center">
            {showing ? <EyeOff className="size-3.5" strokeWidth={2} /> : <Eye className="size-3.5" strokeWidth={2} />}
          </button>
        )}
      </div>
    </div>
  );
}


function WifiStrip({
  ssid,
  password,
  passwordSet,
  theme,
  unlocked,
  requestUnlock,
  checkinLocked,
  hasAccessRec,
  gateEnabled,
}: {
  ssid?: string | null;
  password?: string | null;
  passwordSet?: boolean;
  theme: "dark" | "light";
  unlocked: boolean;
  requestUnlock: (cb?: () => void) => void;
  checkinLocked: boolean;
  hasAccessRec: boolean;
  gateEnabled: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const isLight = theme === "light";

  const hasPwd = !!password || !!passwordSet;
  const showing = unlocked && revealed && !!password;
  const masked = "•".repeat(12);

  function gateOk() {
    if (!hasPwd) return false;
    if (gateEnabled && !hasAccessRec) {
      toast.error("Informe seus dados de check-in para liberar a senha do Wi-Fi.");
      return false;
    }
    if (checkinLocked) {
      toast.error(
        "A senha do Wi-Fi fica disponível somente a partir de 24h antes do início do check-in até 12h depois. Fora dessa janela, fale com o time pelo chat do guia.",
        { duration: 9000 },
      );
      return false;
    }
    return true;
  }

  function handleEyeClick() {
    if (showing) { setRevealed(false); return; }
    if (!gateOk()) return;
    requestUnlock(() => setRevealed(true));
  }

  function copyPwd() {
    if (!gateOk()) return;
    requestUnlock(() => {
      setRevealed(true);
      if (password) {
        navigator.clipboard.writeText(password);
        setCopied(true);
        toast.success("Senha copiada");
        setTimeout(() => setCopied(false), 1500);
      }
    });
  }

  return (
    <div className={`wifi-shimmer relative overflow-hidden rounded-[18px] border ${isLight ? "border-border bg-card shadow-[0_4px_18px_-8px_rgba(0,0,0,0.10)]" : "border-amber-500/25 bg-[linear-gradient(135deg,oklch(0.22_0.05_55/0.95)_0%,oklch(0.16_0.04_50/0.92)_60%,oklch(0.12_0.03_45/0.95)_100%)] shadow-[0_14px_40px_-18px_oklch(from_var(--accent)_l_c_h/0.55)]"}`}>
      <div className={`pointer-events-none absolute inset-0 ${isLight ? "opacity-[0.04]" : "opacity-[0.07]"} [background-image:radial-gradient(oklch(var(--accent))_1px,transparent_1px)] [background-size:14px_14px]`} />
      <div className={`pointer-events-none absolute -top-12 -right-12 size-40 rounded-full ${isLight ? "bg-accent/15" : "bg-accent/25"} blur-3xl`} />
      <div className="relative flex items-center gap-3.5 px-4 py-2.5 md:px-5 md:py-3">
        <span className={`relative grid size-11 shrink-0 place-items-center rounded-2xl ring-1 ${isLight ? "bg-accent/15 text-accent/80 ring-accent/20" : "bg-accent/10 text-accent/75 ring-accent/15"}`}>
          <span className="wifi-pulse pointer-events-none absolute -inset-1 rounded-2xl bg-accent/15 blur-md -z-10" />
          <Wifi className="relative size-[20px]" strokeWidth={2} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[9.5px] uppercase tracking-[0.3em] text-accent/75 font-semibold">Senha do Wi-Fi</p>
          <p className="text-[12.5px] text-foreground/85 truncate font-medium mt-0.5">{ssid || "Rede da casa"}</p>
          <p className={`font-mono text-[15px] md:text-[16px] font-semibold tracking-[0.22em] mt-0.5 truncate ${showing ? "text-foreground" : "text-foreground/75"}`}>
            {hasPwd ? (showing ? password : masked) : "—"}
          </p>
        </div>
        {hasPwd && (
          <div className="flex flex-col items-center justify-center gap-2 shrink-0">
            {!showing ? (
              <button
                onClick={handleEyeClick}
                aria-label="Ver senha do Wi-Fi"
                className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-3 py-1.5 text-[11.5px] font-semibold tracking-wide hover:opacity-90 active:scale-95 transition-all"
              >
                <Eye className="size-3.5" strokeWidth={2.4} />
                <span>Ver Senha</span>
              </button>
            ) : (
              <button
                onClick={copyPwd}
                aria-label="Copiar senha do Wi-Fi"
                className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-3 py-1.5 text-[11.5px] font-semibold tracking-wide hover:opacity-90 active:scale-95 transition-all"
              >
                {copied ? <Check className="size-3.5" strokeWidth={2.4} /> : <Copy className="size-3.5" strokeWidth={2.4} />}
                <span>{copied ? "Copiado" : "Copiar"}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


function AccessCodesStrip({
  gateCode,
  lockCode,
  gateCodeSet,
  lockCodeSet,
  gateLabel,
  lockLabel,
  unlocked,
  requestUnlock,
  checkinLocked,
  hasAccessRec,
  gateEnabled,
  theme,
  checkinInstructions,
}: {
  gateCode: string | null;
  lockCode: string | null;
  gateCodeSet?: boolean;
  lockCodeSet?: boolean;
  gateLabel: string;
  lockLabel: string;
  unlocked: boolean;
  requestUnlock: (cb?: () => void) => void;
  checkinLocked: boolean;
  hasAccessRec: boolean;
  gateEnabled: boolean;
  theme: "dark" | "light";
  checkinInstructions?: string | null;
}) {
  const [revealed, setRevealed] = useState(false);
  const [instrOpen, setInstrOpen] = useState(false);
  const isLight = theme === "light";
  const gLabel = (gateLabel || "").trim() || "Portão";
  const lLabel = (lockLabel || "").trim() || "Fechadura";
  const hasGate = !!gateCode || !!gateCodeSet;
  const hasLock = !!lockCode || !!lockCodeSet;
  const showing = unlocked && revealed && (!!gateCode || !!lockCode);

  function gateOk() {
    if (gateEnabled && !hasAccessRec) {
      toast.error("Informe seus dados de check-in para liberar os códigos.");
      return false;
    }
    if (checkinLocked) {
      toast.error(
        "Os códigos de acesso ficam disponíveis somente a partir de 24h antes do início do check-in até 12h depois. Fora dessa janela, fale com o time pelo chat do guia.",
        { duration: 9000 },
      );
      return false;
    }
    return true;
  }

  function handleEyeClick() {
    if (showing) { setRevealed(false); return; }
    if (!gateOk()) return;
    requestUnlock(() => setRevealed(true));
  }

  function copyCode(code: string, label: string) {
    navigator.clipboard.writeText(code);
    toast.success(`${label} copiado`);
  }

  const hint = hasGate && hasLock ? `${gLabel} e ${lLabel.toLowerCase()}` : hasGate ? gLabel : lLabel;

  return (
    <div className={`wifi-shimmer relative overflow-hidden rounded-[18px] border ${isLight ? "border-border bg-card shadow-[0_4px_18px_-8px_rgba(0,0,0,0.10)]" : "border-amber-500/25 bg-[linear-gradient(135deg,oklch(0.22_0.05_55/0.95)_0%,oklch(0.16_0.04_50/0.92)_60%,oklch(0.12_0.03_45/0.95)_100%)] shadow-[0_14px_40px_-18px_oklch(from_var(--accent)_l_c_h/0.55)]"}`}>
      <div className={`pointer-events-none absolute inset-0 ${isLight ? "opacity-[0.04]" : "opacity-[0.07]"} [background-image:radial-gradient(oklch(var(--accent))_1px,transparent_1px)] [background-size:14px_14px]`} />
      <div className={`pointer-events-none absolute -top-12 -right-12 size-40 rounded-full ${isLight ? "bg-accent/15" : "bg-accent/25"} blur-3xl`} />
      <div className="relative flex items-center gap-3.5 px-4 py-2.5 md:px-5 md:py-3">
        <span className={`relative grid size-11 shrink-0 place-items-center rounded-2xl ring-1 ${isLight ? "bg-accent/15 text-accent/80 ring-accent/20" : "bg-accent/10 text-accent/75 ring-accent/15"}`}>
          <KeyRound className="relative size-[20px]" strokeWidth={2} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[9.5px] uppercase tracking-[0.3em] text-accent/75 font-semibold">Códigos de acesso</p>
          {showing ? (
            <div className="mt-1 space-y-0.5">
              {gateCode && (
                <button
                  type="button"
                  onClick={() => copyCode(gateCode, gLabel)}
                  className="w-full flex items-center justify-between gap-3 text-left group"
                >
                  <span className="text-[12px] text-foreground/75 font-medium shrink-0">{gLabel}</span>
                  <span className="font-mono text-[14.5px] md:text-[15px] font-semibold tracking-[0.22em] text-foreground flex items-center gap-1.5">
                    {gateCode}
                    <Copy className="size-3 text-foreground/50 group-hover:text-foreground/80 transition-colors" strokeWidth={2.2} />
                  </span>
                </button>
              )}
              {lockCode && (
                <button
                  type="button"
                  onClick={() => copyCode(lockCode, lLabel)}
                  className="w-full flex items-center justify-between gap-3 text-left group"
                >
                  <span className="text-[12px] text-foreground/75 font-medium shrink-0">{lLabel}</span>
                  <span className="font-mono text-[14.5px] md:text-[15px] font-semibold tracking-[0.22em] text-foreground flex items-center gap-1.5">
                    {lockCode}
                    <Copy className="size-3 text-foreground/50 group-hover:text-foreground/80 transition-colors" strokeWidth={2.2} />
                  </span>
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="text-[12.5px] text-foreground/85 truncate font-medium mt-0.5">{hint}</p>
              <p className="font-mono text-[15px] md:text-[16px] font-semibold tracking-[0.22em] text-foreground/75 mt-0.5 truncate">
                {"•".repeat(10)}
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col items-center justify-center gap-2 shrink-0">
          {!showing && (
            <button
              onClick={handleEyeClick}
              aria-label="Ver senhas de acesso"
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-3 py-1.5 text-[11.5px] font-semibold tracking-wide hover:opacity-90 active:scale-95 transition-all"
            >
              <Eye className="size-3.5" strokeWidth={2.4} />
              <span>Ver Senha</span>
            </button>
          )}
          {checkinInstructions && checkinInstructions.trim() && (
            <button
              type="button"
              onClick={() => setInstrOpen(true)}
              aria-label="Ver instruções de check-in"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/70 hover:text-foreground transition-colors"
            >
              <HelpCircle className="size-3" strokeWidth={2} />
              <span>Ver instruções</span>
            </button>
          )}
        </div>
      </div>
      {checkinInstructions && checkinInstructions.trim() && (
        <Dialog open={instrOpen} onOpenChange={setInstrOpen}>
          <DialogContent className="max-w-md p-0 overflow-hidden">
            <div className="px-6 pt-6 pb-4 text-center border-b border-border/40">
              <div className="mx-auto mb-3 grid place-items-center size-12 rounded-full bg-accent/12 ring-1 ring-accent/25 text-accent">
                <KeyRound className="size-5" strokeWidth={1.75} />
              </div>
              <DialogTitle className="font-display text-xl tracking-tight">Instruções de acesso</DialogTitle>
              <p className="text-[12.5px] text-muted-foreground mt-1.5 leading-relaxed max-w-xs mx-auto">
                Passo a passo para sua chegada à residência.
              </p>
            </div>
            <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
              <StepList text={String(checkinInstructions)} dense />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>

  );
}

function CheckoutNoticeStrip({
  note,
  checkoutTime,
  theme,
}: {
  note: string | null;
  checkoutTime: string | null;
  theme: "dark" | "light";
}) {
  const isLight = theme === "light";
  const fmt = (s: string) => {
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, "0")}h${m[2] !== "00" ? m[2] : ""}` : s;
  };
  const summary = checkoutTime ? `Check-out hoje até ${fmt(String(checkoutTime))}` : "Hoje é o seu dia de check-out";
  return (
    <div className={`relative overflow-hidden rounded-[22px] border ${isLight ? "border-border bg-card shadow-[0_4px_18px_-8px_rgba(0,0,0,0.10)]" : "border-amber-500/25 bg-[linear-gradient(135deg,oklch(0.22_0.05_55/0.95)_0%,oklch(0.16_0.04_50/0.92)_60%,oklch(0.12_0.03_45/0.95)_100%)] shadow-[0_14px_40px_-18px_oklch(from_var(--accent)_l_c_h/0.55)]"}`}>
      <div className={`pointer-events-none absolute inset-0 ${isLight ? "opacity-[0.04]" : "opacity-[0.07]"} [background-image:radial-gradient(oklch(var(--accent))_1px,transparent_1px)] [background-size:14px_14px]`} />
      <div className={`pointer-events-none absolute -top-12 -right-12 size-40 rounded-full ${isLight ? "bg-accent/15" : "bg-accent/25"} blur-3xl`} />
      <div className="relative flex items-start gap-4 px-5 py-3.5 md:px-6 md:py-4">
        <span className={`relative grid size-12 shrink-0 place-items-center rounded-2xl ring-1 ${isLight ? "bg-accent/15 text-accent/80 ring-accent/20" : "bg-accent/10 text-accent/75 ring-accent/15"}`}>
          <LogOut className="relative size-[20px]" strokeWidth={2} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.32em] text-accent/75 font-semibold">Aviso de check-out</p>
          <p className="text-[14px] text-foreground/90 font-semibold mt-1 leading-snug">{summary}</p>
          {note && (
            <p className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-line mt-1.5">
              {note}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}



function PinDialog({
  open,
  onOpenChange,
  slug,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  onSuccess: (codes?: { wifi_password?: string | null; lock_code?: string | null; gate_code?: string | null }) => void;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitFn = useServerFn(submitAccessPin);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await submitFn({ data: { slug, pin: value.trim() } });
      if (res?.ok) {
        setValue("");
        onSuccess({
          wifi_password: res.wifi_password,
          lock_code: res.lock_code,
          gate_code: res.gate_code,
        });
      } else {
        toast.error("Senha incorreta. Confira com o anfitrião.");
      }
    } catch {
      toast.error("Não foi possível validar a senha. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setValue(""); onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Senha de acesso</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">
          Digite a senha fornecida pelo anfitrião para visualizar as informações sensíveis.
        </p>
        <form onSubmit={submit} className="flex items-center gap-2 pt-1">
          <label htmlFor="guide-access-pin" className="sr-only">
            Senha de acesso da hospedagem
          </label>
          <Input
            id="guide-access-pin"
            aria-label="Senha de acesso da hospedagem"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Senha"
            autoFocus
            type="password"
            maxLength={32}
            className="h-10 flex-1"
          />

          <Button type="submit" className="h-10">Liberar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}


