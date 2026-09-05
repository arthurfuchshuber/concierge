// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Páginas públicas e iguais para todo visitante: geradas como HTML estático
    // no build (SSG). Páginas com sessão/dados por usuário continuam de fora.
    pages: [
      { path: "/" },
      { path: "/precos" },
      { path: "/termos" },
      { path: "/privacidade" },
      { path: "/reembolso" },
      { path: "/confianca" },
    ],
    prerender: { enabled: true, autoStaticPathsDiscovery: false },
  },

  vite: {
    plugins: [mcpPlugin()],
    define: {
      // Identificador único por build: usado para recarregar automaticamente
      // as abas abertas quando uma nova versão entra no ar.
      __APP_BUILD_ID__: JSON.stringify(String(Date.now())),
    },
  },
});

