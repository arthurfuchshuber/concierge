import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { handleSaveConnection } from "@/lib/fiscal/connection-endpoint";

/** NÃO é `/api/public/*`: exige o token do usuário (Bearer) e a conta titular. Só POST; não existe leitura. */
export const Route = createFileRoute("/api/fiscal-connection")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        handleSaveConnection(request, {
          async userIdFromBearer(token) {
            const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_PUBLISHABLE_KEY"];
            if (!url || !key) return null;
            const sb = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
            const { data, error } = await sb.auth.getClaims(token);
            return error ? null : (data?.claims?.sub ?? null);
          },
          async authorize(userId) {
            const s = await import("@/lib/fiscal/service.server");
            const { db, ownerId } = await s.authorizeFiscal(userId, null, "provedor.configurar");
            return { save: (args) => s.saveConnection(db, ownerId, args) };
          },
        }),
    },
  },
});
