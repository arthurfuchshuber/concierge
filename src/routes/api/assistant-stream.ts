/**
 * ASSISTENTE DO PAINEL, EM TEMPO REAL (20/09/2026).
 *
 * Pedido: "está demorando MUITO para responder". A medição mostrou 90 segundos
 * numa pergunta simples — e o modelo não era o problema sozinho: a resposta só
 * aparecia depois de pronta. Esta rota entrega o mesmo turno em SSE:
 *
 *   event: stage  → o que está sendo feito ("consultando pendências")
 *   event: delta  → a resposta, conforme é escrita
 *   event: done   → o payload completo (thread, fontes, ação preparada)
 *   event: error  → mensagem de erro, em português
 *
 * NÃO é `/api/public/*`: o chamador precisa mandar o token do usuário no
 * cabeçalho Authorization, exatamente como as server functions do painel. O
 * cliente criado aqui usa esse token, então o RLS continua valendo igual.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { AssistantAskInput } from "@/lib/assistant-run.shared";

export const Route = createFileRoute("/api/assistant-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const SUPABASE_URL = process.env["SUPABASE_URL"];
        const SUPABASE_PUBLISHABLE_KEY = process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Backend não configurado", { status: 500 });
        }

        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) {
          return new Response("Não autorizado", { status: 401 });
        }
        const token = authHeader.slice("Bearer ".length).trim();
        if (!token) return new Response("Não autorizado", { status: 401 });

        const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
        const userId = claimsData?.claims?.sub;
        if (claimsError || !userId) {
          return new Response("Não autorizado", { status: 401 });
        }

        let parsed;
        try {
          parsed = AssistantAskInput.parse(await request.json());
        } catch {
          return new Response("Pergunta inválida", { status: 400 });
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let closed = false;
            const send = (event: string, payload: unknown) => {
              if (closed) return;
              try {
                controller.enqueue(
                  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
                );
              } catch {
                closed = true;
              }
            };

            try {
              const { runAssistantTurn } = await import("@/lib/assistant-run.server");
              const result = await runAssistantTurn({
                supabase,
                userId,
                data: parsed,
                onEvent: (e) => send(e.type, e),
                // Sem timeout artificial aqui: o turno pode legitimamente
                // pensar bastante, e o texto já está fluindo enquanto isso.
                signal: request.signal,
              });
              send("done", result);
            } catch (err) {
              send("error", {
                message:
                  err instanceof Error ? err.message : "Não consegui responder agora.",
              });
            } finally {
              closed = true;
              try {
                controller.close();
              } catch {
                /* já fechado pelo cliente */
              }
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
