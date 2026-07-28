import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getPublicGuide, submitPin, submitAccessPin } from "@/lib/guide.functions";
import { trackGuideEvent } from "@/lib/guide-analytics.functions";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  Lock,
  MapPin,
  Wifi,
  Phone,
  KeyRound,
  Compass,
  ListChecks,
  LifeBuoy,
  HelpCircle,
  Copy,
  Check,
  ArrowLeft,
  ArrowRight,
  Home,
  Eye,
  EyeOff,
  Clock,
  ExternalLink,
  Car,
  Sun,
  Moon,
  UserRound,
  UtensilsCrossed,
  Wind,
  Tv,
  ShowerHead,
  PawPrint,
  WashingMachine,
  Waves,
  Refrigerator,
  Flame,
  Lightbulb,
  Trash2,
  Bath,
  BedDouble,
  ChevronRight,
  ChevronDown,
  MessageCircle,
  LogIn,
  LogOut,
  PlayCircle,
  ListOrdered,
  Loader2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GuideAiChat } from "@/components/GuideAiChat";
import { HomeIntelligence } from "@/components/guide/HomeIntelligence";
import { CityNewsFeed } from "@/components/guide/CityNewsFeed";
import { CheckinCountdown } from "@/components/guide/CheckinCountdown";
import { BottomNav, type BottomNavKey } from "@/components/guide/BottomNav";
import waterfallImg from "@/assets/rec-waterfall.jpg";
import conciergeLogo from "@/assets/concierge-logo.png";
import { GuideAccessGate, readAccessRecord, type AccessRecord } from "@/components/GuideAccessGate";
import { InlineTagText } from "@/components/tags/InlineTagText";
import { slugForTag, expandInfoTags, type GuideTagKey } from "@/lib/guide-tags";
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
      return { meta: [{ title: "ConciergeIA — ConciergeIA" }, { name: "robots", content: "noindex" }] };
    }
    const p = loaderData.property as Record<string, unknown>;
    const name = p.name as string;
    const city = (p.city as string | null) ?? null;
    const tagline = (p.tagline as string | null) ?? null;
    const title = `${name} — ConciergeIA do Hóspede`;
    const baseDesc =
      tagline ||
      `ConciergeIA digital de ${name}${city ? ` em ${city}` : ""}: instruções de chegada, Wi-Fi, manual da casa e recomendações selecionadas pelo anfitrião.`;
    const desc =
      baseDesc.length < 60
        ? `${baseDesc} Tudo o que você precisa para uma estadia tranquila${city ? ` em ${city}` : ""}.`
        : baseDesc;
    const url = `https://guia.anfitriaosigma.com.br/g/${params.slug}`;
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
          aria-label={t("pin.desc")}
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
  const [revealedCodes, setRevealedCodes] = useState<{
    wifi_password?: string | null;
    lock_code?: string | null;
    gate_code?: string | null;
  }>({});
  const p = useMemo(() => {
    if (
      !revealedCodes ||
      (revealedCodes.wifi_password == null && revealedCodes.lock_code == null && revealedCodes.gate_code == null)
    ) {
      return baseProp;
    }
    return { ...baseProp, ...revealedCodes };
  }, [baseProp, revealedCodes]);
  const { slug } = Route.useParams();
  const [section, setSectionRaw] = useState<Section>(() => {
    if (typeof window === "undefined") return "home";
    const raw = window.location.hash.replace("#", "");
    const map: Record<string, Section> = {
      home: "home", checkin: "checkin", saida: "saida", residencia: "residencia", faq: "faq",
      wifi: "checkin", "senhas-acesso": "checkin", endereco: "checkin", "checkin-instrucoes": "checkin",
      "manual-casa": "residencia", "regras-casa": "residencia",
      "checkout-instrucoes": "saida", emergencias: "faq", "contato-anfitriao": "faq",
    };
    if (map[raw]) return map[raw];
    if (raw.startsWith("faq-") || raw.startsWith("local-")) return "faq";
    return "home";
  });
  // Ao trocar de seção, persiste no hash para que o refresh mantenha a página atual.
  const setSection = useCallback((s: Section) => {
    setSectionRaw(s);
    if (typeof window !== "undefined") {
      try { window.history.replaceState(null, "", `#${s}`); } catch {}
    }
  }, []);
  const trackEvent = useServerFn(trackGuideEvent);

  // Suporta navegação por hash. Sintaxe:
  //   #home | #checkin | #saida | #residencia | #faq  → apenas troca de seção
  //   #wifi | #senhas-acesso | #endereco | #checkin-instrucoes → seção checkin + scroll no bloco
  //   #manual-casa | #regras-casa → seção residencia + scroll
  //   #checkout-instrucoes → seção saida + scroll
  //   #faq-<slug> → seção faq + scroll na FAQ correspondente
  //   #local-<slug> → seção explorar / recomendações
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SECTION_ALIASES: Record<string, Section> = {
      home: "home", checkin: "checkin", saida: "saida", residencia: "residencia", faq: "faq",
      wifi: "checkin", "senhas-acesso": "checkin", endereco: "checkin", "checkin-instrucoes": "checkin",
      "manual-casa": "residencia", "regras-casa": "residencia",
      "checkout-instrucoes": "saida",
      emergencias: "faq", "contato-anfitriao": "faq",
    };
    const apply = () => {
      const raw = window.location.hash.replace("#", "");
      if (!raw) return;
      // Tenta match direto
      let target: Section | null = SECTION_ALIASES[raw] ?? null;
      let scrollToId: string | null = null;
      if (!target) {
        if (raw.startsWith("faq-")) { target = "faq"; scrollToId = raw; }
        else if (raw.startsWith("local-")) { target = "faq"; scrollToId = raw; /* fallback quando /explorar não é rota separada */ }
      } else if (SECTION_ALIASES[raw] && raw !== "home" && raw !== "checkin" && raw !== "saida" && raw !== "residencia" && raw !== "faq") {
        scrollToId = raw;
      }
      if (target) {
        setSection(target);
        // Aguarda o próximo frame para o DOM da nova seção existir antes do scroll
        requestAnimationFrame(() => {
          if (scrollToId) {
            const el = document.getElementById(scrollToId);
            if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
          }
          window.scrollTo({ top: 0, behavior: "auto" });
        });
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  // Navega para uma tag do guia (usada por links inline `[[tag:...]]`).
  function navigateGuideTag(key: GuideTagKey, param: string | null) {
    const hash = param ? `#${key}-${param}` : `#${key}`;
    // Se o hash já for o atual, força re-aplicação disparando hashchange manual
    if (window.location.hash === hash) {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else {
      window.location.hash = hash;
    }
  }




  function gotoSection(s: Section) {
    setSection(s);
    // Fire-and-forget analytics — never blocks navigation
    const sid = typeof window !== "undefined" ? (localStorage.getItem(`guide-chat-session:${slug}`) ?? "anon") : "anon";
    const pagePath = typeof window !== "undefined" ? window.location.pathname : null;
    trackEvent({
      data: {
        slug,
        section: s,
        sessionId: sid,
        guestName: accessRec?.name ?? null,
        guestPhone: accessRec?.phone ?? null,
        pagePath,
      },
    }).catch(() => {});
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
  const [isPreview, setIsPreview] = useState(false);
  const [accessRec, setAccessRec] = useState<AccessRecord | null>(null);
  // Hidrata o registro do localStorage somente após mount (evita mismatch SSR
  // que descartava o registro e fazia o popup reaparecer a cada acesso).
  const [gateReady, setGateReady] = useState(false);
  useEffect(() => {
    const preview = new URLSearchParams(window.location.search).get("preview") === "1";
    if (preview) {
      const today = new Date().toISOString().slice(0, 10);
      setIsPreview(true);
      setAccessRec({
        name: "Pré-visualização",
        code: null,
        checkinDate: today,
        checkoutDate: today,
        phone: null,
        phoneCountry: null,
      });
      setGateReady(true);
      return;
    }
    const rec = readAccessRecord(slug);
    if (rec) setAccessRec(rec);
    setGateReady(true);
  }, [slug]);
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

  // Faixas da home (Wi-Fi/Acesso e aviso de check-in): visíveis sempre que
  // o hóspede já preencheu o formulário de acesso — sem janela temporal.
  // A revelação das senhas continua gated por `checkinLocked`.
  const homeStripsVisible = !!accessRec;

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
  // Track when the guest actually reveals credentials (unlocked flips to true)
  const passwordsTrackedRef = useRef(false);
  useEffect(() => {
    if (!unlocked || passwordsTrackedRef.current) return;
    passwordsTrackedRef.current = true;
    const sid = typeof window !== "undefined" ? (localStorage.getItem(`guide-chat-session:${slug}`) ?? "anon") : "anon";
    const pagePath = typeof window !== "undefined" ? window.location.pathname : null;
    trackEvent({
      data: {
        slug,
        section: "senhas",
        sessionId: sid,
        guestName: accessRec?.name ?? null,
        guestPhone: accessRec?.phone ?? null,
        pagePath,
      },
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);


  // Expansividade da barra "check-in libera em" — abre wi-fi/senhas
  const [codesOpen, setCodesOpen] = useState(false);
  const [locWifiOpen, setLocWifiOpen] = useState(false);

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
    try {
      window.localStorage.setItem(`guide-theme:${slug}`, next);
    } catch {}
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
  const heroParts = splitGuideHeroTitle(cleanGuideTitle(p.name, p.city), p.tagline);

  const rules = data.manual.filter(isRule);
  const houseManual = data.manual.filter((m: any) => !isRule(m));

  // Card "Chegada/Saída" some 24h após a hora do check-in.
  // Mesmo assim, essas seções continuam acessíveis pela barra inferior.
  const stayCardsExpired = (() => {
    if (!accessRec?.checkinDate) return false;
    const t = String(p.checkin_time ?? "15:00").match(/^(\d{1,2}):(\d{2})/);
    const hh = t ? Number(t[1]) : 15;
    const mm = t ? Number(t[2]) : 0;
    const [y, mo, d] = accessRec.checkinDate.split("-").map(Number);
    if (!y || !mo || !d) return false;
    const ci = new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
    return Date.now() > ci + 24 * 3600_000;
  })();

  // Category availability — hide a card entirely when no sub-item has content
  const hasCheckinData = !!(
    p.checkin_time ||
    p.checkin_note ||
    p.address ||
    p.maps_url ||
    p.address_note ||
    p.gate_code ||
    p.lock_code ||
    p.wifi_ssid ||
    p.checkin_instructions
  );
  const hasCheckin = hasCheckinData && !stayCardsExpired;
  const hasSaidaData = !!(p.checkout_time || p.checkout_note || p.checkout_instructions);
  const hasSaida = hasSaidaData && !stayCardsExpired;
  const hasResidencia = houseManual.length > 0;
  const hasLocWifi = !hasResidencia && !!(p.address || p.maps_url || p.wifi_ssid || (p as any).wifi_password_set);
  const hasFaq = !!(p.host_name || p.host_phone) || data.emergency.length > 0 || data.faqs.length > 0;
  const hasExplore =
    (Array.isArray(data.recommendations) && data.recommendations.length > 0) ||
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
      if (t) parts.push(`Check-in a partir das ${t[1].padStart(2, "0")}h${t[2] !== "00" ? t[2] : ""}`);
    }
    if (p.wifi_ssid) parts.push(`Wi-Fi: ${p.wifi_ssid}`);
    return parts[0] ?? "Endereço, códigos de acesso e horários.";
  })();

  const saidaDesc = (() => {
    if (p.checkout_time) {
      const t = String(p.checkout_time).match(/^(\d{1,2}):(\d{2})/);
      if (t) return `Check-out até ${t[1].padStart(2, "0")}h${t[2] !== "00" ? t[2] : ""}`;
    }
    return "Horário e instruções para o check-out.";
  })();

  const residenciaDesc =
    houseManual.length > 0
      ? `${houseManual.length} ${houseManual.length === 1 ? "item" : "itens"} no manual da casa`
      : "Manual, comodidades e detalhes da casa.";

  const exploreDesc = (() => {
    const total =
      (Array.isArray(data.recommendations) ? data.recommendations.length : 0) +
      (Array.isArray((data as any).cityReferences) ? (data as any).cityReferences.length : 0);
    if (total > 0) return `${total} ${total === 1 ? "lugar curado" : "lugares curados"} pelo anfitrião`;
    return "Restaurantes, atrações e experiências.";
  })();

  const faqDesc = (() => {
    if (p.host_name) return `Fale com ${p.host_name}`;
    if (data.faqs.length > 0)
      return `${data.faqs.length} pergunta${data.faqs.length > 1 ? "s" : ""} frequente${data.faqs.length > 1 ? "s" : ""}`;
    return "Anfitrião, emergências e respostas rápidas.";
  })();

  const allCards: Array<{
    key: Exclude<Section, "home"> | "explore" | "locwifi";
    title: string;
    desc: string;
    icon: React.ReactNode;
    variant: "hero-wide" | "compact" | "horizontal-wide";
    tone: "gold" | "blue" | "green" | "purple" | "rose";
    badge?: string;
    visible: boolean;
    to?: { kind: "section"; value: Section } | { kind: "link"; to: string } | { kind: "dialog"; value: "locwifi" };
  }> = [
    {
      key: "checkin",
      title: "Chegada",
      desc: checkinDesc,
      icon: <KeyRound strokeWidth={1.6} />,
      variant: "hero-wide",
      tone: "gold",
      badge: "comece aqui",
      visible: hasCheckin,
      to: { kind: "section", value: "checkin" },
    },
    {
      key: "saida",
      title: "Saída",
      desc: saidaDesc,
      icon: <LogOut strokeWidth={1.6} />,
      variant: "compact",
      tone: "blue",
      visible: hasSaida,
      to: { kind: "section", value: "saida" },
    },
    {
      key: "residencia",
      title: "A residência",
      desc: residenciaDesc,
      icon: <Home strokeWidth={1.6} />,
      variant: "compact",
      tone: "green",
      visible: hasResidencia,
      to: { kind: "section", value: "residencia" },
    },
    {
      key: "locwifi",
      title: "Localização & Wi-Fi",
      desc: (() => {
        const bits: string[] = [];
        if (p.address || p.maps_url) bits.push("Endereço");
        if (p.wifi_ssid || (p as any).wifi_password_set) bits.push("Wi-Fi");
        return bits.length ? bits.join(" · ") : "Endereço e rede da residência.";
      })(),
      icon: <Wifi strokeWidth={1.6} />,
      variant: "compact",
      tone: "green",
      visible: hasLocWifi,
      to: { kind: "dialog", value: "locwifi" },
    },
    {
      key: "explore",
      title: "Explore a região",
      desc: exploreDesc,
      icon: <Compass strokeWidth={1.6} />,
      variant: "horizontal-wide",
      tone: "purple",
      visible: hasExplore,
      to: { kind: "link", to: `/g/${slug}/explorar` },
    },
    {
      key: "faq",
      title: "Dúvidas",
      desc: faqDesc,
      icon: <HelpCircle strokeWidth={1.6} />,
      variant: "compact",
      tone: "rose",
      visible: hasFaq,
      to: { kind: "section", value: "faq" },
    },
  ];
  const cards = allCards.filter((c) => c.visible);
  const quickCards = cards.filter((c) => c.key !== "faq");
  const faqCard = cards.find((c) => c.key === "faq");

  return (
    <div
      className={`sigma-public-guide relative min-h-screen bg-background text-foreground pb-10 overflow-x-hidden ${theme === "light" ? "theme-light" : ""}`}
    >
      {needsGate && (
        <GuideAccessGate
          slug={slug}
          propertyId={p.id as string}
          propertyName={p.name as string}
          requireReservationCode={gateEnabled}
          collection={{
            arrivalTime: ((p as unknown as { collect_arrival_time?: string }).collect_arrival_time as "off" | "optional" | "required") ?? "off",
            vehicles: ((p as unknown as { collect_vehicles?: string }).collect_vehicles as "off" | "optional" | "required") ?? "off",
            vehiclesMax: (p as unknown as { vehicles_max?: number }).vehicles_max ?? 2,
            document: ((p as unknown as { collect_document?: string }).collect_document as "off" | "optional" | "required") ?? "off",
            documentScope: ((p as unknown as { document_scope?: string }).document_scope as "main" | "all") ?? "main",
          }}
          onUnlock={setAccessRec}
          theme={theme === "light" ? "light" : "dark"}

        />
      )}
      <div className="relative z-10 mx-auto w-full max-w-[490px] md:max-w-[520px]">
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
                name={heroParts.title}
                tagline={heroParts.tagline}
                city={p.city}
                photos={photos}
                theme={theme}
                onToggleTheme={toggleTheme}
                lang={lang}
                onToggleLang={toggleLang}
                brandName={(p.brand_name as string | null) ?? null}
                brandLogoUrl={(p.brand_logo_url as string | null) ?? null}
              />

              {/* Bloco de check-in — topo, logo abaixo da imagem.
                  Barra "check-in libera em" é clicável e expande as senhas. */}
              {homeStripsVisible && (
                <div className="mt-3 md:mt-4">
                  {(() => {
                    const hasCodes =
                      p.wifi_ssid ||
                      (p as any).gate_code_set ||
                      (p as any).lock_code_set ||
                      p.gate_code ||
                      p.lock_code;
                    if (!hasCodes) {
                      return <CheckinCountdown checkinTime={p.checkin_time as string | null} theme={theme} />;
                    }
                    return (
                      <>
                        <CheckinCountdown
                          checkinTime={p.checkin_time as string | null}
                          theme={theme}
                          expandable
                          open={codesOpen}
                          onToggle={() => setCodesOpen((v) => !v)}
                        />
                        {/* Trigger neutro — aparece quando o countdown não está visível (fora da janela) */}
                        <CodesTrigger
                          theme={theme}
                          open={codesOpen}
                          onToggle={() => setCodesOpen((v) => !v)}
                          checkinTime={p.checkin_time as string | null}
                        />
                      </>
                    );
                  })()}

                  <AnimatePresence initial={false}>
                    {codesOpen &&
                      (p.wifi_ssid ||
                        (p as any).gate_code_set ||
                        (p as any).lock_code_set ||
                        p.gate_code ||
                        p.lock_code) && (
                        <motion.div
                          key="codes"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 md:px-10 lg:px-16 pt-1 pb-1 relative z-10 flex flex-col md:flex-row md:items-stretch gap-2.5 md:gap-3">
                            {p.wifi_ssid && (
                              <div className="md:flex-1 md:min-w-0">
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
                              <div className="md:flex-1 md:min-w-0">
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
                                  gateInstructions={p.gate_instructions as string | null}
                                  lockInstructions={p.lock_instructions as string | null}
                                  gateVideoUrl={p.gate_video_url as string | null}
                                  lockVideoUrl={p.lock_video_url as string | null}
                                  gateMedia={
                                    Array.isArray(p.gate_media)
                                      ? (p.gate_media as Array<{ url: string; type: "image" | "video" }>)
                                      : []
                                  }
                                  lockMedia={
                                    Array.isArray(p.lock_media)
                                      ? (p.lock_media as Array<{ url: string; type: "image" | "video" }>)
                                      : []
                                  }
                                />
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                  </AnimatePresence>
                </div>
              )}

              {/* Faixa amarela — informações importantes de check-in/check-out. */}
              {((homeStripsVisible && p.checkin_note) ||
                (checkoutNoticeVisible && (p.checkout_note || p.checkout_time))) && (
                <div className="px-4 md:px-10 lg:px-16 mt-3">
                  <div className={`rounded-[22px] border px-4 py-4 flex flex-col gap-4 ${theme === "dark" ? "border-amber-300/22 bg-amber-300/10 text-amber-50" : "border-amber-200/80 bg-amber-50/90 text-amber-950"}`}>
                    {homeStripsVisible && p.checkin_note && (
                      <div className="flex items-start gap-3 md:flex-1 md:min-w-0">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-amber-400">
                          <LogIn className="size-[18px]" strokeWidth={2} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.18em] font-black opacity-75 truncate whitespace-nowrap">
                            Importante · Check-in
                          </p>
                          <p className="text-[13px] leading-relaxed font-medium mt-1 whitespace-pre-line">
                            {String(p.checkin_note)}
                          </p>
                        </div>
                      </div>
                    )}
                    {checkoutNoticeVisible && (p.checkout_note || p.checkout_time) && (
                      <div className="flex items-start gap-3 md:flex-1 md:min-w-0">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-amber-400">
                          <LogOut className="size-[18px]" strokeWidth={2} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.18em] font-black opacity-75 truncate whitespace-nowrap">
                            {(() => {
                              const t = p.checkout_time
                                ? String(p.checkout_time).match(/^(\d{1,2}):(\d{2})/)
                                : null;
                              const time = t ? `${t[1].padStart(2, "0")}h${t[2] !== "00" ? t[2] : ""}` : null;
                              return `Importante · Check-out${time ? ` até ${time}` : ""}`;
                            })()}
                          </p>
                          {p.checkout_note && (
                            <p className="text-[13px] leading-relaxed font-medium mt-1 whitespace-pre-line">
                              {String(p.checkout_note)}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}


              <section id="guide-actions" className="px-4 md:px-10 lg:px-16 mt-3.5 md:mt-5 relative z-10">
                <div className="flex items-center gap-3 mb-3.5 md:mb-4">
                  <p className={`shrink-0 whitespace-nowrap text-[9.5px] md:text-[10px] uppercase tracking-[0.24em] font-black ${theme === "dark" ? "text-white/76" : "text-slate-950/78"}`}>
                    <span className="inline-block size-1.5 rounded-full bg-fuchsia-500 mr-2 align-middle shadow-[0_0_7px_rgba(217,70,239,0.75)]" />
                    Acessos rápidos
                  </p>
                  <span className={`h-px flex-1 bg-gradient-to-r ${theme === "dark" ? "from-white/12 via-white/4" : "from-slate-900/12 via-slate-900/4"} to-transparent`} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {quickCards.map((c) => {
                    const span =
                      c.variant === "hero-wide" || c.variant === "horizontal-wide" ? "col-span-2" : "";
                    const inner = (
                      <SectionCard
                        title={c.title}
                        desc={c.desc}
                        icon={c.icon}
                        variant={c.variant}
                        tone={c.tone}
                        badge={c.badge}
                        theme={theme}
                        imageUrl={c.key === "explore" ? (themeImages.explore || waterfallImg) : undefined}
                      />
                    );
                    return c.to?.kind === "link" ? (
                      <Link
                        key={c.key}
                        to="/g/$slug/explorar"
                        params={{ slug }}
                        className={`block ${span}`}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <button
                        key={c.key}
                        onClick={() => {
                          if (c.to?.kind === "section") gotoSection(c.to.value);
                          else if (c.to?.kind === "dialog" && c.to.value === "locwifi") setLocWifiOpen(true);
                        }}
                        className={`w-full text-left ${span}`}
                      >
                        {inner}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Dica do dia IA + Bolha do Concierge + Pulso da cidade — camada
                  de engajamento que aparece só quando temos contexto útil. */}
              {accessRec && (
                <HomeIntelligence
                  propertyId={p.id as string}
                  city={(p.city as string | null) ?? null}
                  country={(p.country as string | null) ?? null}
                  lang={lang as "pt" | "en" | "es" | "fr"}
                  guestName={accessRec?.name ?? null}
                  checkinDate={accessRec?.checkinDate ?? null}
                  theme={theme}
                />
              )}

              {/* Feed "O que rola hoje" — notícias reais curadas por IA */}
              {accessRec && (
                <CityNewsFeed
                  city={(p.city as string | null) ?? null}
                  country={(p.country as string | null) ?? null}
                  lang={lang as "pt" | "en" | "es" | "fr"}
                  theme={theme}
                />
              )}

              {faqCard && (
                <section className="px-4 md:px-10 lg:px-16 mt-3 relative z-10">
                  <button type="button" onClick={() => gotoSection("faq")} className="w-full text-left">
                    <SectionCard
                      title={faqCard.title}
                      desc={faqCard.desc}
                      icon={faqCard.icon}
                      variant="horizontal-wide"
                      tone={faqCard.tone}
                      theme={theme}
                      footerStyle
                    />
                  </button>
                </section>
              )}




              <footer className="mt-10 px-6 text-center flex items-center justify-center gap-2.5">
                {p.brand_logo_url ? (
                  <img
                    src={p.brand_logo_url}
                    alt={p.brand_name ? `Logotipo ${p.brand_name}` : "Logotipo da hospedagem"}
                    loading="lazy"
                    className="h-5 w-auto object-contain opacity-80"
                  />
                ) : (
                  <GuideMark className="size-3.5 text-accent/70" />
                )}
                <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/80 font-semibold">
                  {p.brand_name || "Seu concierge. Sua experiência."}
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
              <Tabs
                value={section}
                onValueChange={(v) => setSection(v as Section)}
                className="px-5 md:px-10 lg:px-16 pt-6 md:pt-10 lg:max-w-3xl lg:mx-auto"
              >
                <button
                  type="button"
                  onClick={() => gotoSection("home")}
                  aria-label="Voltar ao guia"
                  className="fixed left-3 md:left-6 top-1/2 -translate-y-1/2 z-30 grid place-items-center size-11 rounded-full bg-accent/15 backdrop-blur-md border border-accent/35 text-accent/85 shadow-md hover:text-accent hover:bg-accent/25 hover:scale-105 transition-all"
                >
                  <ArrowLeft className="size-5" strokeWidth={1.75} />
                </button>

                <TabsContent value="checkin" className="space-y-5">
                  <SectionTitle
                    eyebrow="Estadia"
                    title="Chegada"
                    intro="Tudo o que você precisa para chegar e se acomodar."
                  />

                  {(() => {
                    const hasHorario = !!p.checkin_time;
                    const hasChegada = !!(
                      p.address ||
                      p.maps_url ||
                      p.address_note ||
                      p.checkin_instructions ||
                      (Array.isArray(p.checkin_media) && p.checkin_media.length > 0)
                    );
                    const gateMedia = Array.isArray(p.gate_media)
                      ? (p.gate_media as Array<{ url: string; type: "image" | "video" }>)
                      : [];
                    const lockMedia = Array.isArray(p.lock_media)
                      ? (p.lock_media as Array<{ url: string; type: "image" | "video" }>)
                      : [];
                    const gateCodeSet = !!((p as any).gate_code_set || p.gate_code);
                    const lockCodeSet = !!((p as any).lock_code_set || p.lock_code);
                    const hasGateExtras = !!(
                      gateCodeSet &&
                      (p.gate_instructions || p.gate_video_url || gateMedia.length > 0)
                    );
                    const hasLockExtras = !!(
                      lockCodeSet &&
                      (p.lock_instructions || p.lock_video_url || lockMedia.length > 0)
                    );
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
                    const isShortMaps =
                      typeof safeStoredMapsUrl === "string" &&
                      /(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(safeStoredMapsUrl);
                    const mapsHref = hasCoords
                      ? `https://www.google.com/maps/search/?api=1&query=${p.lat}%2C${p.lng}`
                      : isShortMaps
                        ? safeStoredMapsUrl
                        : p.address
                          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`
                          : safeStoredMapsUrl;
                    // Uber Universal Link — abre o app com destino preenchido
                    const uberParams = new URLSearchParams();
                    uberParams.set("action", "setPickup");
                    uberParams.set("pickup", "my_location");
                    if (hasCoords) {
                      uberParams.set("dropoff[latitude]", String(p.lat));
                      uberParams.set("dropoff[longitude]", String(p.lng));
                    }
                    if (p.address) {
                      uberParams.set("dropoff[formatted_address]", String(p.address));
                      uberParams.set("dropoff[nickname]", String(p.address).slice(0, 60));
                    }
                    const uberUrl = (hasCoords || p.address)
                      ? `https://m.uber.com/ul/?${uberParams.toString()}`
                      : null;
                    // 99 deep link — abre o app com destino preenchido
                    const noveNoveParams = new URLSearchParams();
                    noveNoveParams.set("deep_link_value", "open_ride_estimate");
                    if (hasCoords) {
                      noveNoveParams.set("dropoff_latitude", String(p.lat));
                      noveNoveParams.set("dropoff_longitude", String(p.lng));
                    }
                    if (p.address) {
                      noveNoveParams.set("dropoff_title", String(p.address));
                    }
                    const noveNoveUrl = (hasCoords || p.address)
                      ? `https://99app.com/open/?${noveNoveParams.toString()}`
                      : null;

                    return (
                      <SubList>
                        {hasHorario &&
                          (() => {
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
                                      <span className="text-[13px] uppercase tracking-wide text-muted-foreground">
                                        A partir de
                                      </span>
                                      <span className="text-[15px] font-semibold tabular-nums text-foreground">
                                        {fmt(raw)}
                                      </span>
                                    </div>
                                    {rawMax && (
                                      <div className="flex items-center justify-between px-4 py-3">
                                        <span className="text-[13px] uppercase tracking-wide text-muted-foreground">
                                          Até
                                        </span>
                                        <span className="text-[15px] font-semibold tabular-nums text-foreground">
                                          {fmt(rawMax)}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {p.checkin_note && (
                                  <div className="mt-3 rounded-2xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-accent/75 font-semibold mb-1.5">
                                      Observação
                                    </p>
                                    <p className="text-[14px] text-foreground/85 leading-relaxed whitespace-pre-line">
                                      {String(p.checkin_note)}
                                    </p>
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
                                      <p key={i} className="whitespace-pre-line">
                                        {para}
                                      </p>
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
                                          {p.address && (
                                            <p className="text-[12px] text-muted-foreground truncate mt-1">
                                              {p.address}
                                            </p>
                                          )}
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
                                          <p className="text-[12px] text-muted-foreground mt-1">
                                            Entrada pelo acesso da garagem
                                          </p>
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
                                          <p className="text-[12px] text-muted-foreground mt-1">
                                            Corrida até o endereço
                                          </p>
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
                                          <p className="text-[12px] text-muted-foreground mt-1">
                                            Corrida até o endereço
                                          </p>
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
                                    {(p.checkin_media as Array<{ url: string; type: "image" | "video" }>).map(
                                      (m, i) => (
                                        <div
                                          key={i}
                                          className="rounded-xl overflow-hidden border border-border bg-muted/40 aspect-square"
                                        >
                                          {m.type === "video" ? (
                                            <video
                                              src={m.url}
                                              className="size-full object-cover"
                                              controls
                                              playsInline
                                              preload="metadata"
                                            />
                                          ) : (
                                            <img
                                              src={m.url}
                                              alt={`Instruções de check-in da hospedagem${p.name ? ` ${p.name}` : ""} — foto ${i + 1}`}
                                              className="size-full object-cover"
                                              loading="lazy"
                                            />
                                          )}
                                        </div>
                                      ),
                                    )}
                                  </div>
                                )}
                              </div>
                            </Lockable>
                          </SubItem>
                        )}

                        {hasAcesso &&
                          (() => {
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
                                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
                                    Rede
                                  </p>
                                  <p className="text-[15px] font-semibold tracking-tight mt-0.5 break-all leading-snug">
                                    {p.wifi_ssid}
                                  </p>
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
                        {hasHorarioOut &&
                          (() => {
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
                                        <span className="text-[13px] uppercase tracking-wide text-muted-foreground">
                                          A partir de
                                        </span>
                                        <span className="text-[15px] font-semibold tabular-nums text-foreground">
                                          {fmt(rawMin)}
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between px-4 py-3">
                                      <span className="text-[13px] uppercase tracking-wide text-muted-foreground">
                                        Até
                                      </span>
                                      <span className="text-[15px] font-semibold tabular-nums text-foreground">
                                        {fmt(raw)}
                                      </span>
                                    </div>
                                  </div>
                                )}
                                {p.checkout_note && (
                                  <div className="mt-3 px-1">
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-accent/75 font-semibold mb-1.5">
                                      Observação
                                    </p>
                                    <p className="text-[14px] text-foreground/85 leading-relaxed whitespace-pre-line">
                                      {String(p.checkout_note)}
                                    </p>
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
                      <CopyCard
                        icon={<Wifi className="size-5" strokeWidth={1.75} />}
                        eyebrow="Rede"
                        label="Toque para copiar"
                        value={p.wifi_ssid}
                      />
                      {p.wifi_password && (
                        <CopyCard
                          icon={<KeyRound className="size-5" strokeWidth={1.75} />}
                          eyebrow="Senha"
                          label="Toque para copiar"
                          value={p.wifi_password}
                        />
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Sem informações de Wi-Fi.</p>
                  )}
                </TabsContent>

                <TabsContent value="residencia" className="space-y-5">
                  <SectionTitle
                    title="A Residência"
                    intro="Manual e detalhes da casa — toque em um item para saber mais."
                  />
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
                            <h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground">
                              Antes de sair
                            </h3>
                          </div>
                          <ul className="space-y-2">
                            {data.checkout.map((c: any) => (
                              <li
                                key={c.id}
                                className="flex items-start gap-3 bg-card border border-border rounded-xl p-3 text-sm"
                              >
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
                        <h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground">
                          Perguntas frequentes
                        </h3>
                      </div>
                      <Accordion type="single" collapsible className="space-y-1.5">
                        {data.faqs.map((f: any, idx: number) => {
                          const anchor = `faq-${slugForTag(String(f.question ?? ""))}`;
                          return (
                          <AccordionItem
                            key={f.id}
                            id={anchor}
                            value={f.id}
                            className="border border-border/70 rounded-xl px-3.5 bg-card/30 hover:bg-card/60 transition-colors data-[state=open]:bg-card data-[state=open]:border-accent/40 scroll-mt-24"
                          >
                            <AccordionTrigger className="text-left hover:no-underline py-2.5 gap-3">
                              <span className="flex items-center gap-2.5 min-w-0">
                                <span className="text-[10px] font-mono text-accent/70 tabular-nums tracking-wider shrink-0">
                                  {String(idx + 1).padStart(2, "0")}
                                </span>
                                <span className="text-[13.5px] font-medium leading-snug truncate">{f.question}</span>
                              </span>
                            </AccordionTrigger>
                            <AccordionContent className="text-[13.5px] leading-relaxed whitespace-pre-line text-foreground/80 pl-6 pr-1 pb-3.5 max-w-prose">
                              <InlineTagText
                                text={String(f.answer ?? "")}
                                onNavigate={(k, pp) => navigateGuideTag(k, pp)}
                                info={{
                                  snapshot: p as never,
                                  unlocked,
                                  hasAccessPin,
                                  checkinLocked,
                                  onRequestUnlock: () => requestUnlock(),
                                }}
                              />
                            </AccordionContent>
                          </AccordionItem>
                        );})}
                      </Accordion>
                    </div>
                  )}
                  {data.emergency.length > 0 && (
                    <div>
                      <div className="mb-3 flex items-center gap-2">
                        <LifeBuoy className="size-4 text-muted-foreground" />
                        <h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground">
                          Emergências
                        </h3>
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
                        <h3 className="text-[10px] uppercase tracking-[0.2em] font-semibold text-muted-foreground">
                          Anfitrião
                        </h3>
                      </div>
                      <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/40 p-3">
                        <div className="size-10 rounded-full bg-accent/10 text-accent/75 grid place-items-center text-sm font-semibold shrink-0">
                          {(p.host_name as string | undefined)?.trim()?.charAt(0)?.toUpperCase() ?? (
                            <UserRound className="size-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          {p.host_name && (
                            <p className="text-[14px] font-medium leading-tight truncate">{p.host_name}</p>
                          )}
                          {p.host_phone && (
                            <p className="text-[11.5px] text-muted-foreground font-mono tracking-wider mt-0.5 truncate">
                              {p.host_phone}
                            </p>
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
      {(() => {
        const items: Array<{ key: import("@/components/guide/BottomNav").BottomNavKey; label: string }> = [
          { key: "home", label: "Início" },
        ];
        if (hasCheckinData) items.push({ key: "checkin", label: "Chegada" });
        if (hasSaidaData) items.push({ key: "saida", label: "Saída" });
        if (hasResidencia) items.push({ key: "residencia", label: "Residência" });
        if (hasExplore) items.push({ key: "explore", label: "Explorar" });
        if (items.length <= 1) return null;
        const active: import("@/components/guide/BottomNav").BottomNavKey =
          section === "home" ? "home" : (section as import("@/components/guide/BottomNav").BottomNavKey);
        return (
          <BottomNav
            theme={theme}
            active={active}
            items={items}
            onSelect={(k: BottomNavKey) => {
              if (k === "home") { setSection("home"); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
              if (k === "explore") { window.location.href = `/g/${slug}/explorar`; return; }
              gotoSection(k as Section);
            }}
          />
        );
      })()}
      {!needsGate && data.aiEnabled ? <GuideAiChat slug={slug} propertyName={heroParts.title} guestName={accessRec?.name ?? null} /> : null}
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
      <LocWifiDialog
        open={locWifiOpen}
        onOpenChange={setLocWifiOpen}
        address={(p.address as string | null) ?? null}
        addressNote={(p.address_note as string | null) ?? null}
        mapsUrl={safeHttpsHref(p.maps_url as string | null)}
        wifiSsid={(p.wifi_ssid as string | null) ?? null}
        wifiPassword={(p.wifi_password as string | null) ?? null}
        wifiPasswordSet={!!(p as any).wifi_password_set}
        unlocked={unlocked}
        onRequestUnlock={() => requestUnlock()}
      />
    </div>
  );
}

function LocWifiDialog({
  open,
  onOpenChange,
  address,
  addressNote,
  mapsUrl,
  wifiSsid,
  wifiPassword,
  wifiPasswordSet,
  unlocked,
  onRequestUnlock,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  address: string | null;
  addressNote: string | null;
  mapsUrl: string | null;
  wifiSsid: string | null;
  wifiPassword: string | null;
  wifiPasswordSet: boolean;
  unlocked: boolean;
  onRequestUnlock: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1600);
    } catch {}
  }
  const hasLoc = !!(address || mapsUrl);
  const hasWifi = !!(wifiSsid || wifiPassword || wifiPasswordSet);
  const showWifiPass = unlocked && wifiPassword;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px] p-0 overflow-hidden rounded-[22px]">
        <div className="px-5 pt-5 pb-3 text-center border-b border-border/40">
          <div className="mx-auto mb-2.5 grid place-items-center size-11 rounded-full bg-emerald-500/12 ring-1 ring-emerald-500/25 text-emerald-500">
            <Wifi className="size-[18px]" strokeWidth={1.75} />
          </div>
          <DialogTitle className="font-display text-[18px] tracking-tight">Localização & Wi-Fi</DialogTitle>
          <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
            Onde estamos e como se conectar.
          </p>
        </div>
        <div className="px-5 py-4 max-h-[65vh] overflow-y-auto sg-elegant-scroll space-y-5">
          {hasLoc && (
            <section className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.22em] font-black text-foreground/60">
                <MapPin className="inline size-3 -mt-0.5 mr-1" strokeWidth={2} />
                Endereço
              </p>
              {address && (
                <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
                  <p className="text-[13.5px] leading-relaxed whitespace-pre-line">{address}</p>
                  {addressNote && (
                    <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-line">
                      {addressNote}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copy("address", address)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-foreground/8 hover:bg-foreground/12 px-3 py-1.5 text-[11.5px] font-semibold"
                    >
                      {copied === "address" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied === "address" ? "Copiado" : "Copiar"}
                    </button>
                    {mapsUrl && (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 text-white px-3 py-1.5 text-[11.5px] font-semibold hover:opacity-90"
                      >
                        <ExternalLink className="size-3.5" />
                        Abrir no Maps
                      </a>
                    )}
                  </div>
                </div>
              )}
              {!address && mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 text-white px-3 py-1.5 text-[11.5px] font-semibold hover:opacity-90"
                >
                  <ExternalLink className="size-3.5" />
                  Abrir no Maps
                </a>
              )}
            </section>
          )}
          {hasLoc && hasWifi && <div className="h-px bg-border/50" />}
          {hasWifi && (
            <section className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.22em] font-black text-foreground/60">
                <Wifi className="inline size-3 -mt-0.5 mr-1" strokeWidth={2} />
                Wi-Fi
              </p>
              <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 space-y-2.5">
                {wifiSsid && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Rede</p>
                      <p className="text-[14px] font-semibold truncate">{wifiSsid}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copy("ssid", wifiSsid)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-foreground/8 hover:bg-foreground/12 px-3 py-1.5 text-[11.5px] font-semibold shrink-0"
                    >
                      {copied === "ssid" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    </button>
                  </div>
                )}
                {(wifiPasswordSet || wifiPassword) && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Senha</p>
                      {showWifiPass ? (
                        <p className="text-[14px] font-mono font-semibold tracking-wider truncate">{wifiPassword}</p>
                      ) : (
                        <p className="text-[14px] font-mono tracking-[0.3em] text-foreground/50">••••••••</p>
                      )}
                    </div>
                    {showWifiPass ? (
                      <button
                        type="button"
                        onClick={() => copy("pass", wifiPassword!)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-foreground/8 hover:bg-foreground/12 px-3 py-1.5 text-[11.5px] font-semibold shrink-0"
                      >
                        {copied === "pass" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={onRequestUnlock}
                        className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-3 py-1.5 text-[11.5px] font-semibold shrink-0 hover:opacity-90"
                      >
                        <Eye className="size-3.5" strokeWidth={2.4} />
                        Ver
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
  if (/lavanderia|m(á|a)quina|lavar|rouparia|secad/.test(t))
    return <WashingMachine className="size-5" strokeWidth={1.5} />;
  if (/piscina|hidro|jacuzzi|spa/.test(t)) return <Waves className="size-5" strokeWidth={1.5} />;
  if (/churras|grill|fog(ã|a)o a lenha/.test(t)) return <Flame className="size-5" strokeWidth={1.5} />;
  if (/luz|iluminaç|l(â|a)mpada|interruptor/.test(t)) return <Lightbulb className="size-5" strokeWidth={1.5} />;
  if (/lixo|reciclag|coleta/.test(t)) return <Trash2 className="size-5" strokeWidth={1.5} />;
  if (/cama|quarto|colch(ã|a)o|len(ç|c)ol/.test(t)) return <BedDouble className="size-5" strokeWidth={1.5} />;
  return <Home className="size-5" strokeWidth={1.5} />;
}

function ResidenciaCard({
  item,
}: {
  item: { id: string; title: string; description?: string | null; body?: string | null };
}) {
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
              <div className="text-[14px] leading-relaxed whitespace-pre-line text-foreground/90">{item.body}</div>
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
  return (
    String(name ?? "")
      .replace(/^Entrada\/Saída\s+da\s+/i, "")
      .replace(
        city ? new RegExp(`\\s+em\\s+${String(city).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") : /\s+em\s+[^,]+$/i,
        "",
      )
      .trim() || String(name ?? "Guia")
  );
}

function splitGuideHeroTitle(name?: string, tagline?: string | null) {
  const cleanName = String(name ?? "Guia").trim() || "Guia";
  const cleanTagline = String(tagline ?? "").trim();
  const proximity = cleanName.match(/\b(?:pr[oó]x\.?|perto|pr[oó]ximo(?:a)?|ao lado)\b[\s\S]*$/i);
  if (proximity?.index && proximity.index > 0) {
    const title = cleanName.slice(0, proximity.index).trim() || cleanName;
    const derivedTagline = cleanName.slice(proximity.index).trim();
    return { title, tagline: derivedTagline };
  }
  if (!cleanTagline) return { title: cleanName, tagline: null as string | null };
  const escaped = cleanTagline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\s*${escaped}\\s*$`, "i");
  const title = cleanName.replace(re, "").trim() || cleanName;
  return { title, tagline: cleanTagline };
}

function GuideMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="none">
      <path
        d="M16 3v7.5M16 21.5V29M3 16h7.5M21.5 16H29"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M16 10.5c0 3.04-2.46 5.5-5.5 5.5 3.04 0 5.5 2.46 5.5 5.5 0-3.04 2.46-5.5 5.5-5.5-3.04 0-5.5-2.46-5.5-5.5Z"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeroCompact({
  name,
  tagline,
  city,
  photos,
  theme,
  onToggleTheme,
  brandName,
  brandLogoUrl,
}: {
  name: string;
  tagline?: string | null;
  city?: string;
  photos: string[];
  theme: "dark" | "light";
  onToggleTheme: () => void;
  lang: string;
  onToggleLang: () => void;
  brandName?: string | null;
  brandLogoUrl?: string | null;
}) {
  const [idx, setIdx] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const total = photos.length;
  const hasMany = total > 1;
  const isDark = theme === "dark";

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

  // Marca fixa do produto: ConciergeIA (mesma logomarca da landing/painel).
  // A logo específica do anfitrião fica no rodapé, não no topo.
  return (
    <section className="relative px-4 md:px-10 lg:px-16 pt-4 pb-3 md:pt-6 md:pb-5">
      <header className="relative z-10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <img
            src={conciergeLogo}
            alt="ConciergeIA"
            className="size-6 object-contain shrink-0"
          />
          <span
            className={`font-display font-bold text-[13.5px] tracking-tight truncate ${isDark ? "text-white" : "text-foreground"}`}
          >
            ConciergeIA
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {city && (
            <span
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[9.5px] uppercase tracking-[0.12em] font-black ${
                isDark
                  ? "border-white/10 bg-white/[0.035] text-white/88"
                  : "border-slate-900/[0.055] bg-white/44 text-slate-950/82"
              }`}
            >
              <span className="relative flex size-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full size-1.5 bg-emerald-400" />
              </span>
              {city}
            </span>
          )}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Tema claro" : "Tema escuro"}
            className={`grid size-9 place-items-center rounded-full border transition ${
              isDark
                ? "border-white/10 bg-white/[0.045] text-white/86 hover:bg-white/10"
                : "border-slate-900/[0.055] bg-white/55 text-slate-950/78 hover:bg-white/80"
            }`}
          >
            {theme === "dark" ? (
              <Sun className="size-3.5" strokeWidth={1.8} />
            ) : (
              <Moon className="size-3.5" strokeWidth={1.8} />
            )}
          </button>
        </div>
      </header>

      <div
        className={`relative mt-4 md:mt-5 overflow-hidden rounded-[24px] border ${
          isDark
            ? "border-white/8 shadow-[0_20px_58px_-28px_rgba(0,0,0,0.9)]"
            : "border-slate-900/[0.04] shadow-[0_22px_58px_-34px_rgba(49,36,96,0.32)]"
        }`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="relative h-[282px] md:h-[350px] w-full">
          {photos.map((src, i) => (
            <img
              key={`${src}-${i}`}
              src={src}
              alt=""
              className={`absolute inset-0 size-full object-cover object-center transition-opacity duration-700 ${
                i === idx ? "opacity-100" : "opacity-0"
              }`}
            />
          ))}
          {photos.length === 0 && <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-violet-950 to-pink-950" />}
          <div
            className={`absolute inset-0 ${
              isDark
                ? "bg-[linear-gradient(90deg,rgba(5,6,18,0.74)_0%,rgba(5,6,18,0.34)_47%,rgba(5,6,18,0.05)_100%)]"
                : "bg-[linear-gradient(90deg,rgba(255,255,255,0.42)_0%,rgba(255,255,255,0.18)_45%,rgba(255,255,255,0)_100%)]"
            }`}
          />
          <div
            className={`absolute inset-x-0 bottom-0 h-[62%] ${
              isDark
                ? "bg-[linear-gradient(0deg,rgba(5,6,18,0.82),rgba(5,6,18,0.22),transparent)]"
                : "bg-[linear-gradient(to_top,rgba(255,255,255,0.86)_0%,rgba(255,255,255,0.72)_22%,rgba(255,255,255,0.44)_50%,rgba(255,255,255,0.18)_75%,rgba(255,255,255,0)_100%)]"
            }`}
          />
          {/* pink corner blob removed for a cleaner hero */}

          <div className="absolute inset-0 flex flex-col justify-end p-5 pb-6 md:p-8">
            <h1
              className={`text-[26px] md:text-[34px] leading-[1.06] tracking-[-0.01em] max-w-[300px] md:max-w-[460px] font-black line-clamp-2 ${
                isDark ? "text-[#f5efe4]" : "text-foreground"
              }`}
              title={tagline ? `${name} ${tagline}` : name}
            >
              {name}
              {tagline ? <span className="opacity-90"> {tagline}</span> : null}
            </h1>
            <p className={`relative z-10 mt-2.5 max-w-[260px] text-[12.5px] md:text-[13.5px] leading-[1.45] ${isDark ? "text-white/72" : "text-slate-950/76"}`}>
              Tudo o que você precisa para uma estadia incrível.
            </p>
          </div>

          {hasMany && (
            <div className="absolute bottom-3 right-3 z-10 flex gap-1.5">
              {photos.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIdx(i)}
                  aria-label={`Ir para foto ${i + 1}`}
                  className={`h-1 rounded-full transition-all ${
                    i === idx
                      ? "w-6 bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)]"
                      : "w-1 bg-white/50 hover:bg-white/80"
                  }`}
                />
              ))}
            </div>
          )}

          {hasMany && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Foto anterior"
                className="hidden md:grid absolute left-3 top-1/2 -translate-y-1/2 z-10 size-8 place-items-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur-md hover:bg-black/60"
              >
                <ArrowLeft className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Próxima foto"
                className="hidden md:grid absolute right-3 top-1/2 -translate-y-1/2 z-10 size-8 place-items-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur-md hover:bg-black/60"
              >
                <ArrowRight className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

    </section>
  );
}

// Celestial glassmorphism — each tone owns its color story
const SECTION_TONES = {
  gold:   { border: "border-pink-500/22",    bg: "bg-[linear-gradient(135deg,rgba(236,72,153,0.09),rgba(88,28,135,0.04)_58%,rgba(2,6,23,0.55))]", iconBg: "bg-pink-500/14",    iconRing: "border-pink-400/22",    icon: "text-pink-300",    accent: "text-pink-200",    glow: "shadow-pink-500/12" },
  blue:   { border: "border-blue-500/16",    bg: "bg-white/[0.035]", iconBg: "bg-blue-500/12",    iconRing: "border-blue-400/20",    icon: "text-blue-300",    accent: "text-blue-200",    glow: "shadow-blue-500/8" },
  green:  { border: "border-amber-400/18",   bg: "bg-white/[0.035]", iconBg: "bg-amber-400/12",   iconRing: "border-amber-300/22",   icon: "text-amber-200",   accent: "text-amber-100",   glow: "shadow-amber-500/8" },
  purple: { border: "border-violet-500/18",  bg: "bg-white/[0.035]", iconBg: "bg-violet-500/14",  iconRing: "border-violet-400/22",  icon: "text-violet-300",  accent: "text-violet-200",  glow: "shadow-violet-500/8" },
  rose:   { border: "border-pink-500/24",    bg: "bg-pink-500/[0.10]", iconBg: "bg-pink-500/16", iconRing: "border-pink-400/22", icon: "text-pink-300", accent: "text-pink-200", glow: "shadow-pink-500/12" },
} as const;

function SectionCard({
  title,
  desc,
  icon,
  variant = "compact",
  tone = "gold",
  badge,
  theme,
  imageUrl,
  footerStyle = false,
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  variant?: "hero-wide" | "compact" | "horizontal-wide";
  tone?: keyof typeof SECTION_TONES;
  badge?: string;
  theme: "dark" | "light";
  imageUrl?: string;
  footerStyle?: boolean;
}) {
  const t = SECTION_TONES[tone];
  const isDark = theme === "dark";
  const isGold = tone === "gold";

  // Light theme fallback — keeps the card readable without glass
  const lightBg = footerStyle ? "bg-pink-50/88" : isGold ? "bg-white/62" : "bg-white/45";
  const lightBorder = footerStyle ? "border-pink-100" : "border-slate-900/[0.055]";
  const lightIconBg = isGold ? "bg-pink-50" : tone === "purple" ? "bg-violet-50" : tone === "green" ? "bg-emerald-50" : tone === "blue" ? "bg-blue-50" : "bg-pink-50";
  const lightIcon = isGold ? "text-pink-600" : tone === "purple" ? "text-violet-600" : tone === "green" ? "text-emerald-600" : tone === "blue" ? "text-blue-600" : "text-pink-600";

  const surfaceBg = isDark ? t.bg : lightBg;
  const surfaceBorder = isDark ? t.border : lightBorder;
  const iconBgCls = isDark ? t.iconBg : lightIconBg;
  const iconRingCls = isDark ? t.iconRing : "border-transparent";
  const iconColorCls = isDark ? t.icon : lightIcon;
  const titleColor = isDark ? "text-white" : "text-foreground";
  const descColor = isDark ? "text-white/55" : "text-muted-foreground";

  if (variant === "horizontal-wide") {
    return (
      <div
        className={`relative flex min-h-[76px] items-center gap-3 overflow-hidden rounded-[20px] border px-4 py-3.5 transition-all duration-300 ease-out hover:-translate-y-0.5 active:scale-[0.99] ${surfaceBg} ${surfaceBorder} ${isDark ? `shadow-[0_16px_40px_-28px_rgba(0,0,0,0.9)] ${t.glow}` : "shadow-[0_14px_34px_-30px_rgba(31,24,74,0.32)]"}`}
      >
        {imageUrl && (
          <>
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              className="absolute inset-y-0 right-0 w-[72%] object-cover opacity-95"
              style={{
                WebkitMaskImage:
                  "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.15) 18%, rgba(0,0,0,0.55) 42%, rgba(0,0,0,0.9) 70%, #000 100%)",
                maskImage:
                  "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.15) 18%, rgba(0,0,0,0.55) 42%, rgba(0,0,0,0.9) 70%, #000 100%)",
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <span
              className={`pointer-events-none absolute inset-y-0 right-0 w-[72%] ${
                isDark
                  ? "bg-[linear-gradient(to_right,rgba(8,8,21,0.55)_0%,rgba(8,8,21,0.28)_35%,rgba(8,8,21,0.1)_65%,rgba(8,8,21,0)_100%)]"
                  : "bg-[linear-gradient(to_right,rgba(255,255,255,0.5)_0%,rgba(255,255,255,0.22)_35%,rgba(255,255,255,0.06)_65%,rgba(255,255,255,0)_100%)]"
              }`}
            />
          </>
        )}
        {!imageUrl && isDark && (
          <span className={`pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full opacity-24 blur-2xl ${t.iconBg}`} />
        )}
        <div
          className={`relative grid size-12 shrink-0 place-items-center rounded-full border ${iconBgCls} ${iconRingCls}`}
        >
          <span className={`${iconColorCls} [&>svg]:size-5`}>{icon}</span>
        </div>
        <div className="relative flex-1 min-w-0">
          <p className={`text-[14px] font-black leading-tight ${titleColor}`}>{title}</p>
          <p className={`mt-1 text-[11.5px] leading-snug line-clamp-2 ${descColor}`}>{desc}</p>
        </div>
        <ChevronRight className={`relative size-4 shrink-0 ${isDark ? "text-white/82" : "text-slate-950/68"}`} strokeWidth={2} />
      </div>
    );
  }

  const isHero = variant === "hero-wide";
  const pad = isHero ? "p-5 md:p-6" : "p-4";
  const iconSize = isHero ? "size-[58px]" : "size-10";
  const iconSvg = isHero ? "[&>svg]:size-6" : "[&>svg]:size-5";
  const titleSize = isHero ? "text-[18px]" : "text-[13.5px]";
  const descSize = isHero ? "text-[12.5px]" : "text-[10.8px]";

  return (
    <div
      className={`relative overflow-hidden rounded-[20px] border ${isHero ? "min-h-[132px]" : "min-h-[104px]"} ${pad} transition-all duration-300 ease-out hover:-translate-y-0.5 active:scale-[0.99] ${surfaceBg} ${surfaceBorder} ${isDark ? `shadow-[0_16px_40px_-28px_rgba(0,0,0,0.9)] ${t.glow}` : "shadow-[0_14px_34px_-30px_rgba(31,24,74,0.32)]"}`}
    >
      {/* Interior glow */}
      {isDark && (
        <>
          <span className={`pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full opacity-24 blur-3xl ${t.iconBg}`} />
          {isGold && (
            <span className="pointer-events-none absolute inset-0 rounded-[20px] bg-gradient-to-br from-pink-400/[0.08] to-transparent" />
          )}
        </>
      )}

      {/* Luggage watermark — only on the hero "Chegada" card (gold) */}
      {isHero && isGold && (
        <svg
          viewBox="0 0 120 100"
          aria-hidden="true"
          className={`pointer-events-none absolute -right-2 top-3 bottom-3 h-[calc(100%-20px)] w-auto ${isDark ? "text-pink-200/10" : "text-pink-900/7"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {/* Handles */}
          <path d="M42 22 v-6 a6 6 0 0 1 6 -6 h14 a6 6 0 0 1 6 6 v6" />
          <path d="M78 26 v-4 a4 4 0 0 1 4 -4 h8 a4 4 0 0 1 4 4 v4" />
          {/* Big suitcase */}
          <rect x="30" y="22" width="52" height="60" rx="7" />
          <line x1="56" y1="22" x2="56" y2="82" />
          <circle cx="42" cy="80" r="3" />
          <circle cx="70" cy="80" r="3" />
          {/* Small carry-on */}
          <rect x="66" y="30" width="34" height="50" rx="5" />
          <line x1="66" y1="52" x2="100" y2="52" />
        </svg>
      )}

      <div className={`relative flex items-start ${isHero ? "gap-4" : "gap-3"}`}>
        <div
          className={`grid ${iconSize} shrink-0 place-items-center rounded-full border ${iconBgCls} ${iconRingCls}`}
        >
          <span className={`${iconColorCls} ${iconSvg}`}>{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className={`${titleSize} font-black leading-tight truncate ${titleColor}`}>{title}</p>
          <p className={`mt-1 ${descSize} leading-[1.32] line-clamp-2 ${descColor}`}>{desc}</p>
        </div>
      </div>

      {isHero && badge ? (
        <div className="relative -mt-1 flex justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 px-3 py-1.5 text-[9.5px] font-black uppercase tracking-[0.08em] text-white shadow-[0_8px_22px_-10px_rgba(236,72,153,0.65)]">
            {badge}
            <ArrowRight className="size-3" strokeWidth={2.4} />
          </span>
        </div>
      ) : (
        badge && (
          <span
            className={`absolute top-3 right-3 z-10 rounded-md px-2 py-0.5 text-[9.5px] font-black uppercase tracking-tighter ${
              isDark
                ? "bg-amber-400 text-black shadow-[0_0_12px_rgba(251,191,36,0.5)]"
                : "bg-amber-500 text-white"
            }`}
          >
            {badge}
          </span>
        )
      )}
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

function StepList({ text, dense = false, compact = false }: { text: string; dense?: boolean; compact?: boolean }) {
  const steps = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^\s*(?:\d+[.)\-º°]\s*|[-•·*]\s*)/, "").trim())
    .filter((s) => s.length > 0);
  if (steps.length === 0) return null;
  const badge = compact ? "size-6 text-[11px]" : "size-9 text-[13px]";
  const lineLeft = compact ? "left-[12px]" : "left-[18px]";
  const gap = compact ? "gap-3" : "gap-4";
  const labelCls = compact ? "text-[9px] tracking-[0.2em] mb-0.5" : "text-[10px] tracking-[0.22em] mb-1";
  const textCls = compact ? "text-[13px] leading-[1.55]" : "text-[14.5px] leading-[1.6]";
  return (
    <ol className={`relative ${dense ? "space-y-5" : "space-y-6"} ${compact ? "space-y-3.5" : ""} pl-2`}>
      <span
        aria-hidden
        className={`pointer-events-none absolute ${lineLeft} top-3 bottom-3 w-px bg-gradient-to-b from-accent/50 via-accent/25 to-transparent`}
      />
      {steps.map((step, i) => (
        <li key={i} className={`relative flex items-start ${gap}`}>
          <span
            aria-hidden
            className={`relative z-10 mt-0.5 shrink-0 grid place-items-center ${badge} rounded-full bg-accent/15 text-accent/85 font-semibold tabular-nums leading-none shadow-[0_4px_14px_-8px_oklch(from_var(--accent)_l_c_h/0.3)] ring-4 ring-background`}
          >
            {i + 1}
          </span>
          <div className="flex-1 min-w-0 pt-1">
            <p className={`${labelCls} font-semibold uppercase text-accent/80`}>Passo {i + 1}</p>
            <p className={`${textCls} text-foreground/90`}>{step}</p>
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
    tone: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-amber-50 ring-emerald-200/60 dark:ring-emerald-400/20",
    patterns: [/lixo|residu|sujei|limpe/i, /toalha|len[çc]ol|cama/i, /dano|estragar|quebrar/i],
  },
  {
    key: "seguranca",
    label: "Segurança",
    icon: <ShowerHead className="size-[14px]" strokeWidth={1.9} />,
    tone: "bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-200/60 dark:ring-sky-400/20",
    patterns: [
      /chave|fechadura|porta|port[ãa]o|janela|tranc/i,
      /seguran[çc]a|inc[êe]ndio|fogo/i,
      /piscina|crian[çc]a/i,
    ],
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
              <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{items.length}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200" />
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 pt-0">
            <ul className="space-y-2.5">
              {items.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className={`mt-2 grid size-1.5 shrink-0 rounded-full ${cat.tone.split(" ").find((c) => c.startsWith("text-")) ?? "text-accent"} bg-current`}
                  />
                  <span className="text-[14.5px] leading-[1.6] text-foreground/90">{item}</span>
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
  icon,
  label,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <AccordionItem
      value={id}
      className="border border-border/70 rounded-2xl overflow-hidden bg-card/60 backdrop-blur-sm data-[state=open]:border-accent/40 data-[state=open]:shadow-[0_8px_28px_-16px_oklch(from_var(--accent)_l_c_h/0.45)] transition-all"
    >
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
      <AccordionContent className="px-5 pb-5 pt-1">{children}</AccordionContent>
    </AccordionItem>
  );
}

function AccessBlock({
  kind,
  label,
  code,
  instructions,
  videoUrl,
  media,
  unlocked,
  requestUnlock,
  hasPin,
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
    if (showing) {
      if (hasPin) setRevealed(false);
      return;
    }
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
      requestUnlock(() => {
        setRevealed(true);
        doCopy();
      });
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
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            {resolvedLabel}
          </p>
          <p
            className={`font-mono text-[15px] font-semibold tracking-[0.08em] mt-0.5 truncate ${showing ? "text-foreground" : "text-foreground/60"}`}
          >
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
            <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 group">
              <PlayCircle className="size-[18px] text-accent/75 shrink-0" strokeWidth={1.75} />
              <span className="text-[14px] font-medium text-foreground flex-1 group-hover:text-accent/75 transition-colors">
                Assistir tutorial em vídeo
              </span>
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
                    <img
                      src={m.url}
                      alt={`${resolvedLabel} — foto ilustrativa ${i + 1}`}
                      className="size-full object-cover"
                      loading="lazy"
                    />
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
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          })
          .catch(() => {});
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
        <h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground">
          Perguntas frequentes
        </h3>
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
                <span className="text-[10px] font-mono text-accent/70 tabular-nums tracking-wider shrink-0">
                  {String(idx + 1).padStart(2, "0")}
                </span>
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

function CopyCard({
  icon,
  eyebrow,
  label,
  value,
  flat,
}: {
  icon?: React.ReactNode;
  eyebrow?: string;
  label: string;
  value: string;
  flat?: boolean;
}) {
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
            <div className="size-9 rounded-lg bg-accent/10 text-accent/75 grid place-items-center shrink-0">{icon}</div>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">{eyebrow}</p>
            )}
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
    <button
      onClick={copy}
      className="w-full bg-card border border-border rounded-2xl p-5 flex items-center justify-between gap-4 active:scale-[0.99] transition-transform hover:border-accent/40"
    >
      <div className="flex items-center gap-4 min-w-0">
        {icon && (
          <div className="size-12 rounded-xl bg-gradient-to-br from-accent/12 to-accent/5 text-accent/75 grid place-items-center shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0 text-left">
          {eyebrow && (
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-semibold">{eyebrow}</p>
          )}
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

function GatedCopyCard({
  icon,
  eyebrow,
  value,
  unlocked,
  requestUnlock,
  hasPin,
}: {
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
    if (!showing)
      requestUnlock(() => {
        setRevealed(true);
        doCopy();
      });
    else doCopy();
  }
  function eye() {
    if (showing) {
      if (hasPin) setRevealed(false);
      return;
    }
    requestUnlock(() => setRevealed(true));
  }
  return (
    <div className="w-full flex items-center justify-between gap-3 px-3.5 py-3">
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="size-9 rounded-lg bg-accent/10 text-accent/75 grid place-items-center shrink-0">{icon}</div>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">{eyebrow}</p>
          )}
          <p
            className={`text-[15px] font-semibold tracking-tight mt-0.5 break-all leading-snug ${showing ? "" : "text-foreground/60"}`}
          >
            {showing ? value : masked}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={copy} aria-label="Copiar" className="size-8 rounded-full bg-secondary grid place-items-center">
          {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5 text-muted-foreground" />}
        </button>
        {hasPin && (
          <button
            onClick={eye}
            aria-label={showing ? "Ocultar" : "Visualizar"}
            className="size-8 rounded-full bg-foreground text-background grid place-items-center"
          >
            {showing ? <EyeOff className="size-3.5" strokeWidth={2} /> : <Eye className="size-3.5" strokeWidth={2} />}
          </button>
        )}
      </div>
    </div>
  );
}

function CodesTrigger({
  theme,
  open,
  onToggle,
  checkinTime,
}: {
  theme: "dark" | "light";
  open: boolean;
  onToggle: () => void;
  checkinTime: string | null;
}) {
  // Só aparece quando o CheckinCountdown não está visível (fora da janela ativa),
  // para não duplicar. Reproduz a lógica do CheckinCountdown de forma leve.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  const m = checkinTime ? String(checkinTime).match(/^(\d{1,2}):(\d{2})/) : null;
  if (m) {
    const target = new Date(now);
    target.setHours(Number(m[1]), Number(m[2]), 0, 0);
    const startOfWindow = new Date(now);
    startOfWindow.setHours(0, 0, 0, 0);
    const diffMs = target.getTime() - now.getTime();
    const inCountdown = now >= startOfWindow && now <= target;
    const inLiberated = diffMs < 0 && Math.abs(diffMs) < 3 * 60 * 60 * 1000;
    if (inCountdown || inLiberated) return null; // CheckinCountdown já cobre
  }
  const isLight = theme === "light";
  return (
    <div className="mx-4 md:mx-10 lg:mx-16 mb-3 relative z-10">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`block w-full text-left rounded-2xl border backdrop-blur-xl px-4 py-3 transition ${
          isLight
            ? "border-border bg-card/70 hover:bg-card/90"
            : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className={`text-[12px] font-medium inline-flex items-center gap-1.5 ${isLight ? "text-foreground/80" : "text-white/85"}`}>
            <KeyRound className="size-3.5 text-amber-400" strokeWidth={2} />
            {open ? "Ocultar senhas de acesso" : "Ver senhas de acesso"}
          </p>
          <ChevronDown
            className={`size-4 shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""} ${isLight ? "text-foreground/60" : "text-white/70"}`}
            strokeWidth={2.2}
          />
        </div>
      </button>
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
    if (showing) {
      setRevealed(false);
      return;
    }
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
    <div
      className={`wifi-shimmer relative overflow-hidden rounded-[18px] border ${isLight ? "border-border bg-card shadow-[0_4px_18px_-8px_rgba(0,0,0,0.10)]" : "border-amber-500/25 bg-[linear-gradient(135deg,oklch(0.22_0.05_55/0.95)_0%,oklch(0.16_0.04_50/0.92)_60%,oklch(0.12_0.03_45/0.95)_100%)] shadow-[0_14px_40px_-18px_oklch(from_var(--accent)_l_c_h/0.55)]"}`}
    >
      <div
        className={`pointer-events-none absolute inset-0 ${isLight ? "opacity-[0.04]" : "opacity-[0.07]"} [background-image:radial-gradient(oklch(var(--accent))_1px,transparent_1px)] [background-size:14px_14px]`}
      />
      <div
        className={`pointer-events-none absolute -top-12 -right-12 size-40 rounded-full ${isLight ? "bg-accent/15" : "bg-amber-400/15"} blur-3xl`}
      />
      {/* Etiqueta centralizada sobre a linha superior do card */}
      <span
        className={`absolute top-1.5 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] ring-1 whitespace-nowrap ${
          isLight
            ? "bg-card text-accent/85 ring-accent/30 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)]"
            : "bg-[oklch(0.16_0.04_50)] text-amber-100 ring-amber-200/35 shadow-[0_2px_10px_-2px_rgba(0,0,0,0.6)]"
        }`}
      >
        <Wifi className="size-2.5" strokeWidth={2.4} />
        Wi-Fi
      </span>

      <div className="relative flex items-center gap-3 px-3 py-3">

        <span
          className={`relative grid size-10 shrink-0 place-items-center rounded-xl ring-1 ${isLight ? "bg-accent/15 text-accent/80 ring-accent/20" : "bg-amber-400/10 text-amber-50 ring-amber-200/25"}`}
        >
          <span className={`wifi-pulse pointer-events-none absolute -inset-1 rounded-xl ${isLight ? "bg-accent/15" : "bg-amber-400/12"} blur-md -z-10`} />
          <Wifi className="relative size-[18px]" strokeWidth={2} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-foreground/85 truncate font-medium">{ssid || "Rede da casa"}</p>
          <p
            className={`font-mono text-[13px] font-semibold tracking-[0.22em] truncate ${showing ? "text-foreground" : "text-foreground/60"}`}
          >
            {hasPwd ? (showing ? password : masked) : "—"}
          </p>
        </div>
        {hasPwd && (
          !showing ? (
            <button
              onClick={handleEyeClick}
              aria-label="Ver senha do Wi-Fi"
              className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-3 py-1.5 text-[11px] font-semibold tracking-wide hover:opacity-90 active:scale-95 transition-all"
            >
              <Eye className="size-3.5" strokeWidth={2.4} />
              <span>Ver</span>
            </button>
          ) : (
            <button
              onClick={copyPwd}
              aria-label="Copiar senha do Wi-Fi"
              className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-3 py-1.5 text-[11px] font-semibold tracking-wide hover:opacity-90 active:scale-95 transition-all"
            >
              {copied ? <Check className="size-3.5" strokeWidth={2.4} /> : <Copy className="size-3.5" strokeWidth={2.4} />}
              <span>{copied ? "Copiado" : "Copiar"}</span>
            </button>
          )
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
  gateInstructions,
  lockInstructions,
  gateVideoUrl,
  lockVideoUrl,
  gateMedia,
  lockMedia,
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
  gateInstructions?: string | null;
  lockInstructions?: string | null;
  gateVideoUrl?: string | null;
  lockVideoUrl?: string | null;
  gateMedia?: Array<{ url: string; type: "image" | "video" }>;
  lockMedia?: Array<{ url: string; type: "image" | "video" }>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [instrOpen, setInstrOpen] = useState(false);
  const isLight = theme === "light";
  const gLabel = (gateLabel || "").trim() || "Portão";
  const lLabel = (lockLabel || "").trim() || "Fechadura";
  const hasGate = !!gateCode || !!gateCodeSet;
  const hasLock = !!lockCode || !!lockCodeSet;
  const showing = unlocked && revealed && (!!gateCode || !!lockCode);
  const gateInstr = (gateInstructions || "").trim();
  const lockInstr = (lockInstructions || "").trim();
  const gateVid = (gateVideoUrl || "").trim();
  const lockVid = (lockVideoUrl || "").trim();
  const gateMed = (gateMedia || []).filter((m) => m && m.url);
  const lockMed = (lockMedia || []).filter((m) => m && m.url);
  const hasGateBlock = !!(gateInstr || gateVid || gateMed.length);
  const hasLockBlock = !!(lockInstr || lockVid || lockMed.length);
  const hasInstructions = hasGateBlock || hasLockBlock;

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
    if (showing) {
      setRevealed(false);
      return;
    }
    if (!gateOk()) return;
    requestUnlock(() => setRevealed(true));
  }

  const hint = hasGate && hasLock ? `${gLabel} e ${lLabel.toLowerCase()}` : hasGate ? gLabel : lLabel;

  return (
    <div
      className={`wifi-shimmer relative overflow-hidden rounded-[18px] border ${isLight ? "border-border bg-card shadow-[0_4px_18px_-8px_rgba(0,0,0,0.10)]" : "border-amber-500/25 bg-[linear-gradient(135deg,oklch(0.22_0.05_55/0.95)_0%,oklch(0.16_0.04_50/0.92)_60%,oklch(0.12_0.03_45/0.95)_100%)] shadow-[0_14px_40px_-18px_oklch(from_var(--accent)_l_c_h/0.55)]"}`}
    >
      <div
        className={`pointer-events-none absolute inset-0 ${isLight ? "opacity-[0.04]" : "opacity-[0.07]"} [background-image:radial-gradient(oklch(var(--accent))_1px,transparent_1px)] [background-size:14px_14px]`}
      />
      <div
        className={`pointer-events-none absolute -top-12 -right-12 size-40 rounded-full ${isLight ? "bg-accent/15" : "bg-amber-400/15"} blur-3xl`}
      />
      {/* Etiqueta centralizada sobre a linha superior do card */}
      <span
        className={`absolute top-1.5 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] ring-1 whitespace-nowrap ${
          isLight
            ? "bg-card text-accent/85 ring-accent/30 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)]"
            : "bg-[oklch(0.16_0.04_50)] text-amber-100 ring-amber-200/35 shadow-[0_2px_10px_-2px_rgba(0,0,0,0.6)]"
        }`}
      >
        <KeyRound className="size-2.5" strokeWidth={2.4} />
        Acesso
      </span>

      <div className="relative flex items-center gap-3 px-3 py-3">

        <span
          className={`relative grid size-10 shrink-0 place-items-center rounded-xl ring-1 ${isLight ? "bg-accent/15 text-accent/80 ring-accent/20" : "bg-amber-400/10 text-amber-50 ring-amber-200/25"}`}
        >
          <KeyRound className="relative size-[18px]" strokeWidth={2} />
        </span>

        <div className="flex-1 min-w-0">
          {showing ? (
            <div className="space-y-0.5">
              {gateCode && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-foreground/70 font-medium shrink-0 truncate">{gLabel}</span>
                  <span className="font-mono text-[13px] font-semibold tracking-[0.22em] text-foreground truncate">
                    {gateCode}
                  </span>
                </div>
              )}
              {lockCode && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-foreground/70 font-medium shrink-0 truncate">{lLabel}</span>
                  <span className="font-mono text-[13px] font-semibold tracking-[0.22em] text-foreground truncate">
                    {lockCode}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="text-[12px] text-foreground/85 truncate font-medium">{hint}</p>
              <p className="font-mono text-[13px] font-semibold tracking-[0.22em] text-foreground/60 truncate">
                {"•".repeat(10)}
              </p>
            </>
          )}
        </div>

        <div className="shrink-0 flex flex-col items-end gap-1">
          {!showing && (
            <button
              onClick={handleEyeClick}
              aria-label="Ver senhas de acesso"
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-3 py-1.5 text-[11px] font-semibold tracking-wide hover:opacity-90 active:scale-95 transition-all"
            >
              <Eye className="size-3.5" strokeWidth={2.4} />
              <span>Ver</span>
            </button>
          )}
          {hasInstructions && (
            <button
              type="button"
              onClick={() => setInstrOpen(true)}
              aria-label="Ver instruções de acesso"
              className="inline-flex items-center gap-1 text-[10.5px] font-medium text-foreground/65 hover:text-foreground transition-colors"
            >
              <HelpCircle className="size-3" strokeWidth={2} />
              <span>Instruções</span>
            </button>
          )}
        </div>
      </div>
      {hasInstructions && (
        <Dialog open={instrOpen} onOpenChange={setInstrOpen}>
          <DialogContent className="max-w-[380px] p-0 overflow-hidden rounded-[22px]">
            <div className="px-5 pt-5 pb-3 text-center border-b border-border/40">
              <div className="mx-auto mb-2.5 grid place-items-center size-11 rounded-full bg-accent/12 ring-1 ring-accent/25 text-accent">
                <KeyRound className="size-[18px]" strokeWidth={1.75} />
              </div>
              <DialogTitle className="font-display text-[18px] tracking-tight">Instruções de acesso</DialogTitle>
              <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                Passo a passo para utilizar cada acesso.
              </p>
            </div>
            <div className="px-5 py-4 max-h-[60vh] overflow-y-auto sg-elegant-scroll space-y-5">
              {hasGateBlock && (
                <AccessInstructionsSection label={gLabel} instr={gateInstr} videoUrl={gateVid} media={gateMed} />
              )}
              {hasGateBlock && hasLockBlock && <div className="h-px bg-border/50" />}
              {hasLockBlock && (
                <AccessInstructionsSection label={lLabel} instr={lockInstr} videoUrl={lockVid} media={lockMed} />
              )}
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
    <div
      className={`relative overflow-hidden rounded-[22px] border ${isLight ? "border-border bg-card shadow-[0_4px_18px_-8px_rgba(0,0,0,0.10)]" : "border-amber-500/25 bg-[linear-gradient(135deg,oklch(0.22_0.05_55/0.95)_0%,oklch(0.16_0.04_50/0.92)_60%,oklch(0.12_0.03_45/0.95)_100%)] shadow-[0_14px_40px_-18px_oklch(from_var(--accent)_l_c_h/0.55)]"}`}
    >
      <div
        className={`pointer-events-none absolute inset-0 ${isLight ? "opacity-[0.04]" : "opacity-[0.07]"} [background-image:radial-gradient(oklch(var(--accent))_1px,transparent_1px)] [background-size:14px_14px]`}
      />
      <div
        className={`pointer-events-none absolute -top-12 -right-12 size-40 rounded-full ${isLight ? "bg-accent/15" : "bg-accent/25"} blur-3xl`}
      />
      <div className="relative flex items-start gap-4 px-5 py-3.5 md:px-6 md:py-4">
        <span
          className={`relative grid size-12 shrink-0 place-items-center rounded-2xl ring-1 ${isLight ? "bg-accent/15 text-accent/80 ring-accent/20" : "bg-accent/10 text-accent/75 ring-accent/15"}`}
        >
          <LogOut className="relative size-[20px]" strokeWidth={2} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.32em] text-accent/75 font-semibold">Aviso de check-out</p>
          <p className="text-[14px] text-foreground/90 font-semibold mt-1 leading-snug">{summary}</p>
          {note && <p className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-line mt-1.5">{note}</p>}
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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setValue("");
        onOpenChange(o);
      }}
    >
      <DialogContent
        className={cn(
          "max-w-[380px] p-0 gap-0 overflow-hidden border-white/10",
          "rounded-[24px]",
          "bg-[color-mix(in_oklab,hsl(var(--background))_78%,transparent)]",
          "backdrop-blur-2xl backdrop-saturate-150",
          "shadow-[0_28px_70px_-18px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.05)_inset]",
        )}
      >
        <div className="px-6 pt-6 pb-2">
          <div className="mx-auto mb-4 grid size-11 place-items-center rounded-2xl bg-primary/12 ring-1 ring-primary/25 text-primary">
            <KeyRound className="size-[18px]" strokeWidth={2} />
          </div>
          <DialogHeader className="text-center space-y-1.5">
            <DialogTitle className="font-serif text-[20px] leading-tight tracking-tight">
              Senha de acesso
            </DialogTitle>
            <p className="text-[12.5px] text-muted-foreground leading-relaxed px-2">
              Digite a senha do anfitrião para ver os dados sensíveis.
            </p>
          </DialogHeader>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 pt-3 space-y-3">
          <label htmlFor="guide-access-pin" className="sr-only">
            Senha de acesso da hospedagem
          </label>
          <Input
            id="guide-access-pin"
            aria-label="Senha de acesso da hospedagem"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="••••••"
            autoFocus
            type="password"
            maxLength={32}
            className={cn(
              "h-[52px] rounded-[14px] text-center text-[18px] tracking-[0.3em] font-semibold",
              "bg-white/[0.04] border-white/10 focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:border-primary/50",
            )}
          />
          <Button
            type="submit"
            disabled={submitting || !value.trim()}
            className={cn(
              "w-full h-[48px] rounded-full text-[14px] font-semibold",
              "bg-gradient-to-b from-primary to-[color-mix(in_oklab,hsl(var(--primary))_86%,#000)]",
              "text-primary-foreground",
              "shadow-[0_10px_28px_-8px_color-mix(in_oklab,hsl(var(--primary))_50%,transparent),0_1px_0_0_rgba(255,255,255,0.25)_inset]",
              "transition-all duration-200 hover:translate-y-[-1px]",
              "disabled:opacity-70 disabled:cursor-not-allowed",
            )}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                Validando…
              </span>
            ) : (
              "Liberar informações"
            )}
          </Button>
          <p className="text-[10.5px] text-center text-muted-foreground/80 pt-1">
            <Lock className="inline size-3 mr-1 -mt-0.5 text-primary/60" />
            Compartilhada apenas com hóspedes autorizados.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccessInstructionsSection({
  label,
  instr,
  videoUrl,
  media,
}: {
  label: string;
  instr: string;
  videoUrl: string;
  media: Array<{ url: string; type: "image" | "video" }>;
}) {
  const [preview, setPreview] = useState<{ url: string; type: "image" | "video" } | null>(null);
  function ytEmbed(u: string): string | null {
    const m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
    return m ? `https://www.youtube.com/embed/${m[1]}` : null;
  }
  function vimeoEmbed(u: string): string | null {
    const m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m ? `https://player.vimeo.com/video/${m[1]}` : null;
  }
  const embed = videoUrl ? ytEmbed(videoUrl) || vimeoEmbed(videoUrl) : null;
  const isDirectVideo = videoUrl && /\.(mp4|webm|mov)(\?|$)/i.test(videoUrl);
  return (
    <section>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="grid place-items-center size-7 rounded-full bg-accent/12 ring-1 ring-accent/20 text-accent">
          <KeyRound className="size-3.5" strokeWidth={2} />
        </span>
        <h3 className="text-[13.5px] font-semibold tracking-tight">{label}</h3>
      </div>
      {instr && <StepList text={instr} dense compact />}
      {videoUrl && (
        <div className="mt-3 overflow-hidden rounded-xl border border-border/40 bg-muted/30 aspect-video">
          {embed ? (
            <iframe
              src={embed}
              className="size-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : isDirectVideo ? (
            <video
              src={videoUrl}
              controls
              controlsList="nodownload"
              disablePictureInPicture
              onContextMenu={(e) => e.preventDefault()}
              className="size-full object-cover"
            />
          ) : (
            <button
              type="button"
              onClick={() => window.open(videoUrl, "_blank", "noopener,noreferrer")}
              className="grid size-full place-items-center text-[12px] text-accent underline"
            >
              Abrir vídeo tutorial
            </button>
          )}
        </div>
      )}
      {media.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {media.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPreview(m)}
              onContextMenu={(e) => e.preventDefault()}
              className="block overflow-hidden rounded-lg border border-border/40 bg-muted/30 aspect-square cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-accent/40"
              aria-label="Ampliar mídia"
            >
              {m.type === "video" ? (
                <video src={m.url} className="size-full object-cover pointer-events-none" muted playsInline />
              ) : (
                <img
                  src={m.url}
                  alt=""
                  className="size-full object-cover pointer-events-none select-none"
                  loading="lazy"
                  draggable={false}
                />
              )}
            </button>
          ))}
        </div>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(o) => {
          if (!o) setPreview(null);
        }}
      >
        <DialogContent
          className="max-w-[92vw] sm:max-w-[640px] p-0 overflow-hidden rounded-[20px] bg-black/95 border-white/10"
          onContextMenu={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">Visualização da mídia</DialogTitle>
          {preview && (
            <div className="relative w-full max-h-[80vh] grid place-items-center select-none">
              {preview.type === "video" ? (
                <video
                  src={preview.url}
                  controls
                  controlsList="nodownload noremoteplayback"
                  disablePictureInPicture
                  onContextMenu={(e) => e.preventDefault()}
                  className="max-h-[80vh] w-auto max-w-full"
                />
              ) : (
                <img
                  src={preview.url}
                  alt=""
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  onContextMenu={(e) => e.preventDefault()}
                  className="max-h-[80vh] w-auto max-w-full object-contain select-none pointer-events-none"
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
