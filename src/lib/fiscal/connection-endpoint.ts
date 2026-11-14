import { z } from "zod";

/**
 * Cadastro do token da Focus SEM interface (ordem do proprietário, 14/11/2026: front fechado por enquanto).
 * Rota autenticada (Bearer do usuário), só o titular (`owner_only`), nunca devolve o token, resposta sem cache.
 */
const Body = z.object({ environment: z.enum(["homologation", "production"]), token: z.string().min(8).max(200) }).strict();

export interface ConnectionEndpointDeps {
  userIdFromBearer(token: string): Promise<string | null>;
  authorize(userId: string): Promise<{ save(args: { environment: "homologation" | "production"; token: string }): Promise<{ id: string; fingerprint: string; webhookSecret: string }> }>;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function handleSaveConnection(request: Request, deps: ConnectionEndpointDeps): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "unauthorized" });
  const userId = await deps.userIdFromBearer(auth.slice(7).trim()).catch(() => null);
  if (!userId) return json(401, { error: "unauthorized" });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await request.json()); } catch { return json(400, { error: "invalid_input" }); }
  let ctx;
  try { ctx = await deps.authorize(userId); }
  catch (e) { return json((e as { httpStatus?: number }).httpStatus === 400 ? 400 : 403, { error: "forbidden" }); }
  try {
    const r = await ctx.save(body);
    // o segredo do webhook aparece UMA vez; o token nunca volta
    return json(200, { id: r.id, fingerprint: r.fingerprint, webhookPath: `/api/public/webhooks/fiscal/${r.id}/${r.webhookSecret}` });
  } catch { return json(500, { error: "save_failed" }); }
}
