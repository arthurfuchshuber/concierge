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

function checkRateLimit(sessionId: string, ip: string, slug: string): { ok: boolean; reason?: string } {
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
  forceAi: z.boolean().optional(),
});

export const Route = createFileRoute("/api/public/guide-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch (err) {
          return new Response(JSON.stringify({ error: "Entrada inválida." }), { status: 400, headers: { "Content-Type": "application/json" } });
        }

        // Rate limit checks
        const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
        const rl = checkRateLimit(body.sessionId, clientIp, body.slug);
        if (!rl.ok) {
          return new Response(
            JSON.stringify({ error: "Muitas mensagens em pouco tempo. Aguarde um momento." }),
            { status: 429, headers: { "Content-Type": "application/json" } },
          );
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "IA não configurada." }), { status: 500, headers: { "Content-Type": "application/json" } });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: prop } = await supabaseAdmin
          .from("properties")
          .select("*")
          .eq("slug", body.slug)
          .eq("published", true)
          .maybeSingle<PropertyRow>();

        if (!prop) {
          return new Response(JSON.stringify({ error: "Guia não encontrado." }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        if (prop.access_mode === "pin") {
          const cookie = getCookie(`sg-pin-${prop.id}`);
          if (cookie !== "ok") {
            return new Response(JSON.stringify({ error: "Acesso bloqueado." }), { status: 403, headers: { "Content-Type": "application/json" } });
          }
        }

        // Gate: guest AI chat is available from the Pro plan onwards.
        const { resolveOwnerPlanAdmin } = await import("@/lib/plan-guard.server");
        const ownerPlan = await resolveOwnerPlanAdmin(supabaseAdmin as SupabaseClient, prop.owner_id);
        if (!ownerPlan.features.guestChat) {
          return new Response(
            JSON.stringify({ error: "A assistente IA não está disponível neste guia." }),
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
            return new Response(JSON.stringify({ error: "Não consegui iniciar a conversa." }), { status: 500, headers: { "Content-Type": "application/json" } });
          }
          conversationId = created.id;

          // Avisa o anfitrião que um hóspede iniciou uma conversa com a IA.
          try {
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

        // ── Omnichannel Conversation Core (espelho unificado, nunca bloqueante)
        const { resolveCoreConversation, appendCoreMessage } = await import("@/lib/ai/conversation/core.server");
        const coreConv = await resolveCoreConversation({
          supabase: supabaseAdmin,
          tenantId: String(prop.owner_id),
          propertyId: String(prop.id),
          legacyConversationId: conversationId,
          channel: "platform_chat",
          guestName: body.guestName ?? null,
          guestPhone: null,
        });
        const mirrorToCore = async (
          senderType: "guest" | "agent" | "human_operator",
          content: string,
        ): Promise<void> => {
          if (!coreConv || !content) return;
          await appendCoreMessage({
            supabase: supabaseAdmin,
            conversationId: coreConv.id,
            tenantId: coreConv.tenantId,
            propertyId: String(prop.id),
            senderType,
            channel: "platform_chat",
            content,
          });
        };

        // If the conversation is currently handled by a human (ai_paused), just
        // persist the guest message and let the agent reply — the guide chat
        // will surface new agent messages via polling / realtime.
        const { data: convState } = await supabaseAdmin
          .from("property_chat_conversations")
          .select("ai_paused, status")
          .eq("id", conversationId)
          .maybeSingle();

        // Se a conversa está "resolvida" e o hóspede envia nova mensagem, reabrir com a IA.
        if (convState?.status === "resolved") {
          await supabaseAdmin
            .from("property_chat_conversations")
            .update({ status: "ai", ai_paused: false, resolved_at: null, assigned_to: null })
            .eq("id", conversationId);
        }

        // Se um humano assumiu a conversa (ai_paused), NUNCA devolvemos para a IA
        // — mesmo que o hóspede clique em uma dica com forceAi. A mensagem é
        // apenas persistida para o atendente responder.
        if (convState?.ai_paused) {
          await supabaseAdmin.from("property_chat_messages").insert({
            conversation_id: conversationId,
            role: "user",
            content: body.message,
            sender_type: "guest",
          });
          await mirrorToCore("guest", body.message);

          await supabaseAdmin
            .from("property_chat_conversations")
            .update({ last_message_at: new Date().toISOString(), guest_name: body.guestName ?? undefined })
            .eq("id", conversationId);
          return new Response(
            JSON.stringify({ conversationId, reply: "", handoff: true, humanMode: true }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        // Load prior messages (latest 20)
        const { data: priorRaw } = await supabaseAdmin
          .from("property_chat_messages")
          .select("role, content")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(20);
        const prior = (priorRaw ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .reverse();

        await supabaseAdmin.from("property_chat_messages").insert({
          conversation_id: conversationId,
          role: "user",
          content: body.message,
          sender_type: "guest",
        });
        await mirrorToCore("guest", body.message);


        // Nota: quando ai_paused=true, já retornamos acima. Aqui ai_paused é
        // false, então não há handoff ativo para limpar.


        // Sticky exploration mode: se qualquer resposta anterior da IA já foi no
        // formato de exploração de dica, mantemos o mesmo comportamento nos
        // turnos seguintes (sem handoff automático, tom de amigo local).
        const explorationSignature = /Destaques|Melhor horário|Como chegar|Dica de quem conhece/i;
        const inExplorationFlow = body.forceAi || prior.some(
          (m) => m.role === "assistant" && explorationSignature.test(m.content ?? ""),
        );

        // ─── Agente de Hospitalidade (nova arquitetura) ───
        const { runHospitalityAgent } = await import("@/lib/ai/orchestrator.server");
        const { AiGatewayError } = await import("@/lib/ai/gateway.server");

        let result: Awaited<ReturnType<typeof runHospitalityAgent>>;
        try {
          result = await runHospitalityAgent({
            supabase: supabaseAdmin as SupabaseClient,
            property: prop as unknown as Record<string, unknown>,
            conversationId,
            sessionId: body.sessionId,
            guestName: body.guestName ?? null,
            message: body.message,
            history: prior.map((m) => ({ role: m.role as string, content: m.content ?? "" })),
            explorationMode: inExplorationFlow,
            surface: "guide_chat",
          });
        } catch (err) {
          const status = err instanceof AiGatewayError ? err.status : 502;
          const message =
            err instanceof AiGatewayError
              ? err.message
              : "Não consegui responder agora. Tente de novo.";
          if (!(err instanceof AiGatewayError)) console.error("guide-chat agent error", err);
          return new Response(JSON.stringify({ error: message, conversationId }), {
            status: status === 429 || status === 402 ? status : 502,
            headers: { "Content-Type": "application/json" },
          });
        }

        const handoffTriggered = result.handoff;
        const partialReply = result.reply.trim();
        if (handoffTriggered) {
          const reason = result.handoffReason ?? "Hóspede pediu atendimento humano.";
          const urgency = result.handoffUrgency;
          await supabaseAdmin
            .from("property_chat_conversations")
            .update({
              status: "needs_human",
              // Com resposta parcial a IA continua na conversa (consulta
              // interna); só travamos a IA quando não houve nada a dizer.
              ai_paused: !partialReply,
              handoff_reason: reason,
              handoff_urgency: urgency,
              handoff_at: new Date().toISOString(),
            })
            .eq("id", conversationId);
          try {
            const { getPropertyNotifiableUsers, sendHandoffPush } = await import("@/lib/handoff.server");
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

        // A IA sempre entrega o que sabe. No handoff, a mensagem parcial já
        // sinaliza a consulta interna — sem anunciar transferência.
        const finalReply = partialReply;

        if (finalReply) {
          await supabaseAdmin.from("property_chat_messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: finalReply,
            sender_type: "ai",
          });
          await mirrorToCore("agent", finalReply);
        }

        await supabaseAdmin
          .from("property_chat_conversations")
          .update({ last_message_at: new Date().toISOString(), guest_name: body.guestName ?? undefined })
          .eq("id", conversationId);

        return new Response(JSON.stringify({ conversationId, reply: finalReply, handoff: handoffTriggered }), { status: 200, headers: { "Content-Type": "application/json" } });

      },
      // Poll for new messages in a conversation (used after human handoff so the
      // guest widget can surface agent replies without a page reload).
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const conversationId = url.searchParams.get("conversationId") ?? "";
        const sessionId = url.searchParams.get("sessionId") ?? "";
        const since = url.searchParams.get("since");
        if (!/^[0-9a-f-]{36}$/i.test(conversationId) || sessionId.length < 8) {
          return new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: conv } = await supabaseAdmin
          .from("property_chat_conversations")
          .select("id, guest_session_id, ai_paused, status")
          .eq("id", conversationId)
          .maybeSingle();
        if (!conv || conv.guest_session_id !== sessionId) {
          return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        let q = supabaseAdmin
          .from("property_chat_messages")
          .select(
            "id, role, content, sender_type, created_at, attachment_path, attachment_type, attachment_mime, attachment_duration_ms, attachment_size_bytes, attachment_name",
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
