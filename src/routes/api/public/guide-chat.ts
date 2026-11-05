import { createFileRoute } from "@tanstack/react-router";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type PropertyRow = Database["public"]["Tables"]["properties"]["Row"];

// In-process rate limiters (reset on deployment — acceptable vs DB overhead).
// 1) Per-session: max 10 messages per session per 60s
// 2) Per-IP: max 30 messages per IP per 60s (prevents session spoofing)
// 3) Per-guide: max 200 messages per guide per day (cost protection)
const sessionMessageTimes = new Map<string, number[]>();
const ipMessageTimes = new Map<string, number[]>();
const guideDailyCount = new Map<string, { date: string; count: number }>();

function checkRateLimit(
  sessionId: string,
  ip: string,
  slug: string,
): { ok: boolean; reason?: string } {
  const now = Date.now();
  const min = 60_000;
  const day = 86_400_000;

  // Session limit: 10/min
  const sessionTimes = (sessionMessageTimes.get(sessionId) ?? []).filter((t) => now - t < min);
  if (sessionTimes.length >= 10) return { ok: false, reason: "session" };
  sessionTimes.push(now);
  sessionMessageTimes.set(sessionId, sessionTimes);

  // IP limit: 30/min (only when IP is available)
  if (ip) {
    const ipTimes = (ipMessageTimes.get(ip) ?? []).filter((t) => now - t < min);
    if (ipTimes.length >= 30) return { ok: false, reason: "ip" };
    ipTimes.push(now);
    ipMessageTimes.set(ip, ipTimes);
  }

  // Guide daily budget: 200/day
  const today = new Date().toISOString().slice(0, 10);
  const guideBucket = guideDailyCount.get(slug);
  if (guideBucket && guideBucket.date === today) {
    if (guideBucket.count >= 200) return { ok: false, reason: "guide_daily" };
    guideBucket.count += 1;
  } else {
    guideDailyCount.set(slug, { date: today, count: 1 });
  }

  return { ok: true };
}

const Body = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  sessionId: z.string().min(8).max(80),
  conversationId: z.string().uuid().optional(),
  guestName: z.string().trim().min(1).max(80).optional(),
  message: z.string().trim().min(1).max(2000),
  /** Quando true, a resposta vem como SSE (mesmo protocolo do widget do guia). */
  stream: z.boolean().optional(),
  /**
   * Código da reserva salvo pelo guia no aparelho do hóspede (o widget já
   * enviava; o servidor ignorava). Nos guias com código, liga a conversa à
   * reserva oficial (16/09/2026).
   */
  reservationCode: z.string().trim().max(40).optional(),
  /** Vitrine da landing: ninguém é notificado. */
  demo: z.boolean().optional(),
});

type StageEvent = { step: string; label: string };

async function runGuideChat(
  body: z.infer<typeof Body>,
  emitStage: (stage: StageEvent) => void,
): Promise<Response> {
  {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("*")
      .eq("slug", body.slug)
      .eq("published", true)
      .maybeSingle<PropertyRow>();

    if (!prop) {
      return new Response(JSON.stringify({ error: "Guia não encontrado." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const guestAccess = await import("@/lib/guest-access.server");
    if (prop.access_mode === "pin") {
      // Cookie assinado — o valor fixo "ok" podia ser forjado (16/09/2026).
      const pinOk = await guestAccess.verifyPinCookie(
        "pin",
        prop.id,
        (prop as { pin_code?: string | null }).pin_code ?? null,
        getCookie(guestAccess.pinCookieName("pin", prop.id)) ?? null,
      );
      if (!pinOk) {
        return new Response(JSON.stringify({ error: "Acesso bloqueado." }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Gate: guest chat is available from the Pro plan onwards.
    const { resolveOwnerPlanAdmin } = await import("@/lib/plan-guard.server");
    const landing = await import("@/lib/landing-demo.server");
    const planOwnerId = landing.isLandingCopy(body.slug)
      ? ((await landing.landingSourceOwnerId(supabaseAdmin as SupabaseClient)) ?? prop.owner_id)
      : prop.owner_id;
    const ownerPlan = await resolveOwnerPlanAdmin(supabaseAdmin as SupabaseClient, planOwnerId);
    if (!ownerPlan.features.guestChat) {
      return new Response(
        JSON.stringify({ error: "O chat não está disponível neste guia." }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    // Get or create conversation
    let conversationId = body.conversationId;
    if (conversationId) {
      const { data: conv } = await supabaseAdmin
        .from("property_chat_conversations")
        .select("id, property_id, guest_session_id")
        .eq("id", conversationId)
        .maybeSingle();
      if (!conv || conv.property_id !== prop.id || conv.guest_session_id !== body.sessionId) {
        conversationId = undefined;
      }
    }
    // Reaproveita a conversa recente da mesma sessão (evita conversas duplicadas,
    // que perdiam o histórico).
    if (!conversationId) {
      const since = new Date(Date.now() - 12 * 3600_000).toISOString();
      const { data: recent } = await supabaseAdmin
        .from("property_chat_conversations")
        .select("id")
        .eq("property_id", prop.id)
        .eq("guest_session_id", body.sessionId)
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recent?.id) conversationId = recent.id;
    }
    if (!conversationId) {
      const { data: created, error: cErr } = await supabaseAdmin
        .from("property_chat_conversations")
        .insert({
          property_id: prop.id,
          guest_session_id: body.sessionId,
          guest_name: body.guestName ?? null,
        })
        .select("id")
        .single();
      if (cErr || !created) {
        return new Response(JSON.stringify({ error: "Não consegui iniciar a conversa." }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      conversationId = created.id;

      // Avisa o anfitrião que um hóspede iniciou uma conversa.
      if (!body.demo) try {
        const { sendConversationStartedPush } = await import("@/lib/ops-push.server");
        await sendConversationStartedPush(supabaseAdmin, {
          propertyId: prop.id,
          propertyName: prop.name ?? null,
          conversationId: created.id,
          guestName: body.guestName ?? null,
          firstMessage: body.message ?? null,
        });
      } catch (e) {
        console.error("[guide-chat] conversation-started push failed", e);
      }
    }

    // If the conversation is currently handled by a human (ai_paused), just
    // persist the guest message and let the agent reply — the guide chat
    // will surface new agent messages via polling / realtime.
    const { data: convState } = await supabaseAdmin
      .from("property_chat_conversations")
      .select("ai_paused, paused_until, status, assigned_to")
      .eq("id", conversationId)
      .maybeSingle();

    /* A PAUSA EXPIRA SOZINHA (11/09/2026). Ver `lib/chat/pause.ts`. */
    // Código da reserva é soberano: liga a conversa à reserva oficial mesmo com a IA pausada.
    if (!body.demo && body.reservationCode && !landing.isLandingCopy(body.slug)) {
      try {
        const link = await import("@/lib/chat/conversation-link.server");
        await link.linkConversationByCode(supabaseAdmin as SupabaseClient, { conversationId, propertyId: String(prop.id), code: body.reservationCode });
      } catch (e) {
        console.error("guide-chat vínculo falhou", e);
      }
    }
    const { resolvePause, resumePatch } = await import("@/lib/chat/pause");
    const humanoNoComando = await resolvePause(supabaseAdmin, conversationId, convState);

    // Se a conversa está "resolvida" e o hóspede envia nova mensagem, reabrir.
    if (convState?.status === "resolved") {
      await supabaseAdmin
        .from("property_chat_conversations")
        .update({ status: "ai", ...resumePatch(), resolved_at: null, assigned_to: null })
        .eq("id", conversationId);
    }

    // Persiste a mensagem do hóspede em qualquer caso. O id vai para o slot da IA,
    // que revalida conversa + mensagem no backend (F0: o slot só recebe identificadores).
    const { data: guestMsg } = await supabaseAdmin
      .from("property_chat_messages")
      .insert({
        conversation_id: conversationId,
        role: "user",
        content: body.message,
        sender_type: "guest",
      })
      .select("id")
      .single();
    await supabaseAdmin
      .from("property_chat_conversations")
      .update({
        last_message_at: new Date().toISOString(),
        guest_name: body.guestName ?? undefined,
      })
      .eq("id", conversationId);

    // ─── Copiloto (05/11/2026): sugestão de resposta para a EQUIPE aprovar, gerada em segundo plano.
    // Não bloqueia, não responde ao hóspede e não altera o fluxo abaixo (slot, fallback humano, push).
    if (!body.demo && guestMsg?.id) {
      try {
        const { triggerCopilotSuggestion } = await import("@/lib/guest-ai/copilot/trigger.server");
        triggerCopilotSuggestion({
          surface: "guide_chat",
          conversationId,
          messageId: guestMsg.id,
          expectedOwnerId: prop.owner_id ? String(prop.owner_id) : null,
        });
      } catch (e) {
        console.error("[guide-chat] copiloto não disparado", e instanceof Error ? e.name : "");
      }
    }

    // Se um humano assumiu a conversa (ai_paused), a mensagem é apenas
    // persistida para o atendente responder. Push pra CADA mensagem do hóspede
    // numa conversa já assumida: se há um responsável específico, só ele
    // recebe; sem isso, cai pra todo o time notificável da propriedade.
    if (humanoNoComando) {
      if (!body.demo) try {
        const { getPropertyNotifiableUsers, sendGuestReplyPush } =
          await import("@/lib/handoff.server");
        const userIds = convState?.assigned_to
          ? [convState.assigned_to as string]
          : await getPropertyNotifiableUsers(supabaseAdmin, prop.id);
        await sendGuestReplyPush(supabaseAdmin, {
          userIds,
          conversationId,
          propertyName: prop.name,
          guestName: body.guestName ?? null,
          guestMessage: body.message,
        });
      } catch (e) {
        console.error("Guest reply push failed", e);
      }

      return new Response(
        JSON.stringify({ conversationId, reply: "", handoff: true, humanMode: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ─── IA de atendimento: ponto de extensão (sem implementação instalada) ───
    emitStage({ step: "route", label: "Encaminhando ao anfitrião" });
    const { requestGuestAiReply, NO_AI_HANDOFF_REASON } = await import("@/lib/guest-ai/slot.server");
    const ai = await requestGuestAiReply({
      surface: "guide_chat",
      conversationId,
      messageId: guestMsg?.id ?? "",
      expectedOwnerId: prop.owner_id ? String(prop.owner_id) : null,
    });

    // FALLBACK: sem IA, a conversa vai para a fila humana e a equipe é avisada.
    const handoffTriggered = ai ? ai.handoff : true;
    const reason = ai?.handoffReason ?? NO_AI_HANDOFF_REASON;
    const urgency = ai?.handoffUrgency ?? null;
    if (handoffTriggered) {
      await supabaseAdmin
        .from("property_chat_conversations")
        .update({
          status: "needs_human",
          ai_paused: false,
          handoff_reason: reason,
          handoff_urgency: urgency,
          handoff_at: new Date().toISOString(),
        })
        .eq("id", conversationId);
      if (!body.demo) try {
        const { getPropertyNotifiableUsers, sendHandoffPush } =
          await import("@/lib/handoff.server");
        const userIds = await getPropertyNotifiableUsers(supabaseAdmin, prop.id);
        const guestNameForLookup = (body.guestName ?? "").trim();
        const { data: accessLog } = guestNameForLookup
          ? await supabaseAdmin
              .from("guide_access_logs")
              .select("guest_name, checkin_date")
              .eq("property_id", prop.id)
              .eq("guest_name", guestNameForLookup)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : { data: null as { guest_name: string; checkin_date: string } | null };
        await sendHandoffPush(supabaseAdmin, {
          userIds,
          conversationId,
          propertyName: prop.name,
          guestName: body.guestName ?? accessLog?.guest_name ?? null,
          guestMessage: body.message,
          checkinDate: accessLog?.checkin_date ?? null,
          reason,
          urgency,
        });
      } catch (e) {
        console.error("Handoff push failed", e);
      }
    }

    const finalReply = (ai?.reply ?? "").trim();
    if (finalReply) {
      await supabaseAdmin.from("property_chat_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: finalReply,
        sender_type: "ai",
      });
      await supabaseAdmin
        .from("property_chat_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
    }

    return new Response(
      JSON.stringify({ conversationId, reply: finalReply, handoff: handoffTriggered }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/public/guide-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return new Response(JSON.stringify({ error: "Entrada inválida." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // PASSE DE IDENTIFICAÇÃO (25/09/2026): o chat só aceita hóspede
        // identificado no guia — o passe é assinado pelo servidor.
        {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: passProp } = await supabaseAdmin
            .from("properties")
            .select("id")
            .eq("slug", body.slug)
            .eq("published", true)
            .maybeSingle();
          const { verifyGuestPassInfo } = await import("@/lib/guest-pass.server");
          const info = passProp ? verifyGuestPassInfo(request.headers.get("x-guest-pass"), `guide:${passProp.id}`) : null;
          // Chat só com reserva conferida por código (25/09/2026).
          if (!info || !info.verified) {
            return new Response(
              JSON.stringify({
                error: "Para conversar pelo chat, informe o código da sua reserva na identificação do guia.",
                needsPass: true,
              }),
              { status: 401, headers: { "Content-Type": "application/json" } },
            );
          }
          if (!body.guestName) body.guestName = info.name;
        }

        // Rate limit checks
        // IP pelo helper comum: prioriza `cf-connecting-ip`. O primeiro item do
        // `x-forwarded-for` é escolhido pelo próprio cliente e anulava o limite.
        const { clientIpFrom, allowPaidGuestUse, allowDailyBudget } = await import(
          "@/lib/public-rate-limit.server"
        );
        const clientIp = clientIpFrom(request);
        const rl = checkRateLimit(body.sessionId, clientIp, body.slug);
        if (!rl.ok) {
          return new Response(
            JSON.stringify({ error: "Muitas mensagens em pouco tempo. Aguarde um momento." }),
            { status: 429, headers: { "Content-Type": "application/json" } },
          );
        }

        /* TETO DO DIA (23/09/2026).
           O chat do hóspede é aberto por natureza (ninguém faz login para ler
           o guia). O limite por minuto segura rajada; este teto impede que uma
           única pessoa ou um único imóvel inundem a fila de atendimento. */
        if (
          !allowDailyBudget(`guide-chat:ip:${clientIp}`, 200) ||
          !allowPaidGuestUse({
            scope: "guide-chat",
            propertyId: body.slug,
            sessionId: body.sessionId,
            perSession: 120,
            perProperty: 600,
            global: 4000,
          })
        ) {
          return new Response(
            JSON.stringify({
              error:
                "O atendimento automático atingiu o limite de mensagens de hoje. Fale com o anfitrião.",
            }),
            { status: 429, headers: { "Content-Type": "application/json" } },
          );
        }


        if (!body.stream) return runGuideChat(body, () => {});

        // ── Modo streaming (SSE): mesmo protocolo do widget do guia (etapas,
        // resposta em pedaços e evento final "done").
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let closed = false;
            const send = (event: Record<string, unknown>) => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              } catch {
                closed = true;
              }
            };
            send({ type: "stage", step: "start", label: "Recebi sua mensagem" });
            try {
              const res = await runGuideChat(
                body,
                (stage) => send({ type: "stage", step: stage.step, label: stage.label }),
              );
              const payload = (await res.json().catch(() => ({}))) as {
                reply?: string;
                conversationId?: string;
                handoff?: boolean;
                humanMode?: boolean;
                error?: string;
              };
              if (!res.ok || payload.error) {
                send({
                  type: "error",
                  error: payload.error ?? "Não consegui responder agora.",
                  conversationId: payload.conversationId ?? null,
                });
              } else {
                const reply = payload.reply ?? "";
                if (reply) {
                  send({ type: "reply_start", conversationId: payload.conversationId ?? null });
                  /**
                   * A revelação em pedaços é ENFEITE, e enfeite não pode cobrar
                   * segundos: aqui o texto JÁ ESTÁ pronto e validado, então
                   * cada milissegundo de pausa é espera pura somada ao fim de
                   * um pipeline que já demorou.
                   *
                   * O código anterior mandava um pedaço a cada 22ms com no
                   * mínimo 18 caracteres. Numa resposta de 600 caracteres isso
                   * eram ~33 pedaços, ~730ms de sono depois de tudo pronto.
                   *
                   * Agora o custo é ORÇADO: pedaço maior em texto longo e
                   * pausa calculada para a revelação inteira caber em ~260ms,
                   * seja qual for o tamanho. Continua parecendo que está sendo
                   * escrito, para de custar meio segundo.
                   *
                   * (Isto é diferente de streaming de verdade, que mostraria o
                   * texto enquanto o modelo escreve. Aqui não dá: a regra desta
                   * rota — correta — é nunca enviar ao hóspede texto que ainda
                   * não passou pela validação.)
                   */
                  const REVEAL_BUDGET_MS = 260;
                  const chunkSize = reply.length > 400 ? 36 : 18;
                  const chunkCount = Math.max(1, Math.ceil(reply.length / chunkSize));
                  const delayMs = Math.min(18, Math.floor(REVEAL_BUDGET_MS / chunkCount));
                  const words = reply.split(/(\s+)/);
                  let buf = "";
                  for (const w of words) {
                    buf += w;
                    if (buf.length >= chunkSize) {
                      send({ type: "delta", text: buf });
                      buf = "";
                      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
                    }
                  }
                  if (buf) send({ type: "delta", text: buf });
                }
                send({
                  type: "done",
                  conversationId: payload.conversationId ?? null,
                  reply,
                  handoff: !!payload.handoff,
                  humanMode: !!payload.humanMode,
                });
              }
            } catch (err) {
              console.error("[guide-chat] stream error", err);
              send({ type: "error", error: "Não consegui responder agora. Tente de novo." });
            } finally {
              closed = true;
              try {
                controller.close();
              } catch {
                /* já fechado */
              }
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
      // Poll for new messages in a conversation (used after human handoff so the
      // guest widget can surface agent replies without a page reload).
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const conversationId = url.searchParams.get("conversationId") ?? "";
        const sessionId = url.searchParams.get("sessionId") ?? "";
        const since = url.searchParams.get("since");
        /* O par conversa + sessão É a credencial do hóspede anônimo. Para que
         * isso seja de fato uma credencial, a sessão precisa ter entropia de
         * verdade (UUID) e as tentativas erradas precisam ter freio — senão
         * dá para varrer sessões curtas e ler conversa alheia (22/09/2026). */
        const sessionCore = sessionId.replace(/^preview-/, "");
        if (!/^[0-9a-f-]{36}$/i.test(conversationId) || sessionCore.length < 16) {
          return new Response(JSON.stringify({ error: "invalid" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const { clientIpFrom, allowPublicRate } = await import("@/lib/public-rate-limit.server");
        const ip = clientIpFrom(request);
        if (!allowPublicRate(`guide-chat-get:${ip}`, 120, 60_000)) {
          return new Response(JSON.stringify({ error: "rate_limited" }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: conv } = await supabaseAdmin
          .from("property_chat_conversations")
          .select("id, property_id, guest_session_id, ai_paused, status")
          .eq("id", conversationId)
          .maybeSingle();
        if (!conv || conv.guest_session_id !== sessionId) {
          // Tentativa errada consome um orçamento próprio: 20 falhas por
          // minuto por IP encerram a varredura.
          if (!allowPublicRate(`guide-chat-get-miss:${ip}`, 20, 60_000)) {
            return new Response(JSON.stringify({ error: "rate_limited" }), {
              status: 429,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ error: "not_found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        // Guia protegido por PIN: o histórico também exige o PIN provado.
        {
          const { data: prop } = await supabaseAdmin
            .from("properties")
            .select("id, access_mode, pin_code")
            .eq("id", (conv as { property_id: string }).property_id)
            .maybeSingle();
          const p = prop as { id: string; access_mode?: string | null; pin_code?: string | null } | null;
          if (p && p.access_mode === "pin") {
            const guestAccess = await import("@/lib/guest-access.server");
            const pinOk = await guestAccess.verifyPinCookie(
              "pin",
              p.id,
              p.pin_code ?? null,
              getCookie(guestAccess.pinCookieName("pin", p.id)) ?? null,
            );
            if (!pinOk) {
              return new Response(JSON.stringify({ error: "forbidden" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
              });
            }
          }
        }

        let q = supabaseAdmin
          .from("property_chat_messages")
          .select(
            "id, role, content, sender_type, created_at, attachment_path, attachment_type, attachment_mime, attachment_duration_ms, attachment_size_bytes, attachment_name, attachment_transcript",
          )
          .eq("conversation_id", conversationId)
          .eq("is_internal_note", false)
          .order("created_at", { ascending: true })
          .limit(50);
        if (since) q = q.gt("created_at", since);
        const { data: msgs } = await q;

        // Sign URLs for any attachment so the guest can preview them.
        const withAttachments = (msgs ?? []).filter((m) => m.attachment_path);
        const signedMap = new Map<string, string>();
        if (withAttachments.length) {
          const paths = withAttachments.map((m) => m.attachment_path as string);
          const { data: signed } = await supabaseAdmin.storage
            .from("chat-attachments")
            .createSignedUrls(paths, 60 * 60);
          for (const s of signed ?? []) {
            if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
          }
        }

        return new Response(
          JSON.stringify({
            humanMode: !!conv.ai_paused,
            status: conv.status,
            messages: (msgs ?? []).map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              senderType: m.sender_type,
              createdAt: m.created_at,
              attachment: m.attachment_path
                ? {
                    type: m.attachment_type,
                    mime: m.attachment_mime,
                    durationMs: m.attachment_duration_ms,
                    sizeBytes: m.attachment_size_bytes,
                    name: m.attachment_name,
                    transcript: m.attachment_transcript ?? null,
                    url: signedMap.get(m.attachment_path as string) ?? null,
                  }
                : null,
            })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
