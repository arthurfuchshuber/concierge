/**
 * Cofre do token da conta remetente do Airbnb (26/11/2026).
 *
 * A Channex passou a mascarar o token OAuth ("***"). O ConciergeIA guarda, cifrado, o último token REAL de cada
 * conta (`airbnb_sender_credentials`), capturado sempre que a Channex ainda devolve um token de verdade
 * (`captureChannelToken`), e o envio direto usa o cofre antes da Channex (`getUsableSenderToken`).
 *
 * Renovação: só com credenciais de app do Airbnb configuradas (`AIRBNB_CLIENT_ID`/`AIRBNB_CLIENT_SECRET`) e
 * refresh token guardado. Sem isso, token vencido ⇒ `expired` e o envio segue o caminho normal (Channex).
 * Nada aqui loga ou devolve o token para fora do servidor.
 */
import { decryptToken, encryptToken } from "@/lib/security/sender-crypto.server";
import { isMaskedOrUnusableToken } from "@/lib/airbnb-token";

const TABLE = "airbnb_sender_credentials";
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

type Row = {
  id: string;
  owner_id: string;
  channex_channel_id: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  expires_at: string | null;
  status: string;
  updated_at: string;
};

export async function saveSenderCredentials(
  admin: any,
  p: {
    ownerId: string;
    channelId: string;
    accessToken: string;
    refreshToken?: string | null;
    expiresInSeconds?: number | null;
    expiresAt?: string | null;
    airbnbUserId?: string | null;
  },
): Promise<boolean> {
  if (isMaskedOrUnusableToken(p.accessToken)) return false;
  const expiresAt =
    p.expiresAt ?? (p.expiresInSeconds && p.expiresInSeconds > 0 ? new Date(Date.now() + p.expiresInSeconds * 1000).toISOString() : null);
  const refresh = p.refreshToken && !isMaskedOrUnusableToken(p.refreshToken) ? await encryptToken(p.refreshToken.trim()) : null;
  const row: Record<string, unknown> = {
    owner_id: p.ownerId,
    channex_channel_id: p.channelId,
    encrypted_access_token: await encryptToken(p.accessToken.trim()),
    expires_at: expiresAt,
    status: "active",
    updated_at: new Date().toISOString(),
  };
  if (refresh) row.encrypted_refresh_token = refresh;
  if (p.airbnbUserId) row.airbnb_user_id = p.airbnbUserId;
  const { error } = await admin.from(TABLE).upsert(row, { onConflict: "owner_id,channex_channel_id" });
  if (error) {
    console.error("[sender-cred] gravação falhou", error.message);
    return false;
  }
  return true;
}

export async function markSenderTokenExpired(admin: any, channelId: string): Promise<void> {
  await admin
    .from(TABLE)
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("channex_channel_id", channelId)
    .eq("status", "active");
}

/** Renovação pelo Airbnb (só com credenciais de app configuradas). Devolve o novo par ou null. */
export async function refreshAirbnbToken(
  refreshToken: string,
  env: Record<string, string | undefined> = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<{ accessToken: string; refreshToken: string | null; expiresInSeconds: number | null } | null> {
  const clientId = env["AIRBNB_CLIENT_ID"]?.trim();
  const secret = env["AIRBNB_CLIENT_SECRET"]?.trim();
  if (!clientId || !secret) return null;
  try {
    const res = await fetchFn("https://api.airbnb.com/v2/oauth2/authorizations?_unwrapped=true", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Airbnb-API-Key": clientId,
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const j: any = await res.json().catch(() => null);
    const access = j?.access_token;
    if (isMaskedOrUnusableToken(access)) return null;
    return {
      accessToken: String(access),
      refreshToken: typeof j?.refresh_token === "string" ? j.refresh_token : null,
      expiresInSeconds: Number(j?.expires_in) || null,
    };
  } catch {
    return null;
  }
}

/** Token utilizável do cofre para a conta (renovando se estiver para vencer e for possível), ou null. */
export async function getUsableSenderToken(
  admin: any,
  channelId: string,
  deps: { now?: () => number; refresh?: typeof refreshAirbnbToken } = {},
): Promise<string | null> {
  if (!channelId) return null;
  try {
    const { data, error } = await admin
      .from(TABLE)
      .select("id, owner_id, channex_channel_id, encrypted_access_token, encrypted_refresh_token, expires_at, status, updated_at")
      .eq("channex_channel_id", channelId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) return null;
    const row = ((data ?? []) as Row[])[0];
    if (!row) return null;
    const now = (deps.now ?? Date.now)();
    const exp = row.expires_at ? Date.parse(row.expires_at) : NaN;
    const expiring = Number.isFinite(exp) && exp - now < REFRESH_MARGIN_MS;
    if (!expiring) {
      const token = await decryptToken(row.encrypted_access_token);
      return isMaskedOrUnusableToken(token) ? null : token;
    }
    if (row.encrypted_refresh_token) {
      const renewed = await (deps.refresh ?? refreshAirbnbToken)(await decryptToken(row.encrypted_refresh_token));
      if (renewed) {
        await saveSenderCredentials(admin, {
          ownerId: row.owner_id,
          channelId,
          accessToken: renewed.accessToken,
          refreshToken: renewed.refreshToken,
          expiresInSeconds: renewed.expiresInSeconds,
        });
        return renewed.accessToken;
      }
    }
    // vencido de fato e sem renovação possível ⇒ marca, para não insistir
    if (Number.isFinite(exp) && exp <= now) await markSenderTokenExpired(admin, channelId);
    if (Number.isFinite(exp) && exp > now) {
      const token = await decryptToken(row.encrypted_access_token);
      return isMaskedOrUnusableToken(token) ? null : token;
    }
    return null;
  } catch (e) {
    console.error("[sender-cred] leitura falhou", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * A Channex ainda devolveu um token REAL para o canal ⇒ guarda no cofre de cada conta do ConciergeIA ligada a ele.
 * Só regrava quando o token mudou. Melhor esforço: nunca lança.
 */
export async function captureChannelToken(
  admin: any,
  channelId: string,
  settings: { tokens?: { access_token?: unknown; refresh_token?: unknown; expires_at?: unknown } } | null | undefined,
): Promise<void> {
  try {
    const access = settings?.tokens?.access_token;
    if (!channelId || isMaskedOrUnusableToken(access)) return;
    const { data: accounts } = await admin.from("airbnb_accounts").select("owner_id").eq("channex_channel_id", channelId);
    const owners = [...new Set(((accounts ?? []) as Array<{ owner_id: string | null }>).map((a) => a.owner_id).filter((x): x is string => !!x))];
    if (owners.length === 0) return;
    const current = await getUsableSenderToken(admin, channelId);
    if (current === String(access).trim()) return;
    const expSec = Number(settings?.tokens?.expires_at ?? 0);
    const refresh = settings?.tokens?.refresh_token;
    for (const ownerId of owners) {
      await saveSenderCredentials(admin, {
        ownerId,
        channelId,
        accessToken: String(access),
        refreshToken: typeof refresh === "string" ? refresh : null,
        expiresAt: expSec > 0 ? new Date(expSec * 1000).toISOString() : null,
      });
    }
  } catch (e) {
    console.error("[sender-cred] captura falhou", e instanceof Error ? e.message : e);
  }
}
