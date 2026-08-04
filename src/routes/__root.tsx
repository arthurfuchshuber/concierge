import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { I18nProvider } from "../lib/i18n";
import { installPermissionDeniedHandler } from "@/lib/permissions/permissionClient";
import { Toaster } from "../components/ui/sonner";
import { supabase } from "../integrations/supabase/client";
import { META_PIXEL_ID, initMetaPixel, metaPixelPageView } from "../lib/meta-pixel";
import { startTrail, trackPageView } from "../lib/trail";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md text-center">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">404</p>
        <h1 className="font-display text-4xl">Página não encontrada</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          O caminho que você procura não existe.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
        >
          Voltar ao início
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md text-center">
        <h1 className="font-display text-3xl">Algo deu errado</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Não conseguimos carregar esta página. Tente novamente.
        </p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
        >
          Tentar de novo
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover" },
      { name: "theme-color", content: "#FDF9F2" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "ConciergeIA" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "google-site-verification", content: "o7m2Z68kLI_sgZFwkIsA1VQzKGI1OYfiqw6FKxsup5E" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Manrope:wght@300;400;500;600;700;800&display=swap",
      },
    ],
    scripts: [
      {
        children: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL_ID}');fbq('track','PageView');window.__metaPixelInitialized=true;window.__metaPixelLastPath=(location.pathname+location.search);`,
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "ConciergeIA",
          url: "https://guia.anfitriaosigma.com.br",
          logo: "https://guia.anfitriaosigma.com.br/favicon.png",
        }),
      },
    ],

  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{try{const t=localStorage.getItem('sg-theme');const m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(!t&&m))document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            alt=""
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          />
        </noscript>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [router, queryClient]);

  // Tratamento global de PERMISSION_DENIED (não quebra a aplicação).
  useEffect(() => installPermissionDeniedHandler(), []);



  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kb-inset", `${inset}px`);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Ao trocar de rota, garante que a próxima página abra no topo.
  const pathname = router.state.location.pathname;
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  // Meta Pixel: init once, then PageView on every client-side navigation.
  useEffect(() => {
    initMetaPixel();
  }, []);
  useEffect(() => {
    metaPixelPageView(pathname);
  }, [pathname]);

  // Rastro completo de uso: cliques, campos, envios, rolagem, erros e sessão.
  useEffect(() => {
    const slug = window.location.pathname.startsWith("/g/")
      ? window.location.pathname.split("/")[2]
      : undefined;
    return startTrail(slug);
  }, []);
  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);



  const persister = typeof window !== "undefined"
    ? createSyncStoragePersister({ storage: window.localStorage, key: "cia-cache-v1", throttleTime: 1000 })
    : null;

  const content = (
    <I18nProvider>
      <Outlet />
      <Toaster position="top-center" />
    </I18nProvider>
  );

  return persister ? (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7 /* 7 dias */ }}
    >
      {content}
    </PersistQueryClientProvider>
  ) : (
    <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>
  );
}
