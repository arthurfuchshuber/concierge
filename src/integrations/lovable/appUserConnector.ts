/**
 * App User Connector helpers.
 *
 * SERVER-ONLY. Reads server-side secrets from `process.env` to authorize
 * connector-gateway calls. Never import this from a route component, loader
 * or any client-bundled file — only from `createServerFn` handlers.
 */

import { getUserAccessToken } from "@lovable.dev/lovable-auth-js/server";
import { getRequest } from "@tanstack/react-start/server";

function getIdentityToken(): string | null {
  return getRequest()?.headers.get("x-lovable-identity-token") ?? null;
}

async function getAppUserGatewayAccessToken(gatewayBaseUrl: string, operation: string): Promise<string> {
  const identityToken = getIdentityToken();
  if (!identityToken) {
    throw new Error(
      `${operation} requires a signed-in Lovable user: no identity token was found on the request. For app-authenticated users pass their stored connectionAPIKey instead.`,
    );
  }
  return getUserAccessToken({
    subjectToken: identityToken,
    resource: gatewayBaseUrl,
    scope: "connector:invoke",
  });
}

function requireApiKey(): string {
  const key = process.env['LOVABLE_API_KEY'];
  if (!key) {
    throw new Error("LOVABLE_API_KEY is not set. App User Connector calls require a server-side workspace token.");
  }
  return key;
}

export interface AppUserOAuthAuthorizeParams {
  gatewayBaseUrl: string;
  connectorId: string;
  appUserId: string;
  clientAPIKey: string;
  returnUrl: string;
  credentialsConfiguration?: Record<string, unknown>;
  connectionAPIKey?: string;
  responseMode?: "redirect" | "web_message";
  webMessageTargetOrigin?: string;
}

export interface AppUserOAuthAuthorizeResponse {
  authorizationUrl: string;
  sessionId: string;
}

export async function authorizeAppUserOAuth(
  params: AppUserOAuthAuthorizeParams,
): Promise<AppUserOAuthAuthorizeResponse> {
  const identityToken = getIdentityToken();
  if (params.responseMode === "web_message" && !identityToken) {
    throw new Error(
      "web_message requires a signed-in Lovable user. Use redirect mode for app-authenticated users so the connection key stays server-side.",
    );
  }
  const bearer =
    params.responseMode === "web_message"
      ? await getAppUserGatewayAccessToken(params.gatewayBaseUrl, "authorizeAppUserOAuth")
      : requireApiKey();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
    "X-Client-Api-Key": params.clientAPIKey,
  };
  if (params.connectionAPIKey) {
    headers["X-Connection-Api-Key"] = params.connectionAPIKey;
  }
  const res = await fetch(`${params.gatewayBaseUrl}/api/v1/app-users/oauth2/authorize`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      connector_id: params.connectorId,
      app_user_id: params.appUserId,
      return_url: params.returnUrl,
      credentials_configuration: params.credentialsConfiguration,
      response_mode: params.responseMode,
      web_message_target_origin: params.webMessageTargetOrigin,
      omit_connection_key: params.responseMode === "web_message",
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`App User OAuth start failed (${res.status}): ${text || res.statusText}`);
  }

  let body: { authorization_url?: string; session_id?: string };
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`App User OAuth start returned invalid JSON: ${text.slice(0, 200)}`);
  }
  if (!body.authorization_url) {
    throw new Error("App User OAuth start response missing authorization_url");
  }
  return { authorizationUrl: body.authorization_url, sessionId: body.session_id ?? "" };
}

export type CallAsAppUserParams = {
  gatewayBaseUrl: string;
  connectorId: string;
  path: string;
  init?: RequestInit;
} & ({ connectionAPIKey?: never } | { connectionAPIKey: string });

export async function callAsAppUser({
  gatewayBaseUrl,
  connectionAPIKey,
  connectorId,
  path,
  init,
}: CallAsAppUserParams): Promise<Response> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const headers = new Headers(init?.headers);
  if (connectionAPIKey) {
    headers.set("Authorization", `Bearer ${requireApiKey()}`);
    headers.set("X-Connection-Api-Key", connectionAPIKey);
  } else {
    const bearer = await getAppUserGatewayAccessToken(gatewayBaseUrl, "callAsAppUser");
    headers.set("Authorization", `Bearer ${bearer}`);
  }
  return fetch(`${gatewayBaseUrl}/${connectorId}${normalizedPath}`, { ...init, headers });
}

export type DisconnectAppUserParams = {
  gatewayBaseUrl: string;
  connectorId: string;
} & ({ connectionAPIKey?: never } | { connectionAPIKey: string });

export async function disconnectAppUser({
  gatewayBaseUrl,
  connectionAPIKey,
  connectorId,
}: DisconnectAppUserParams): Promise<void> {
  const headers = new Headers();
  if (connectionAPIKey) {
    headers.set("Authorization", `Bearer ${requireApiKey()}`);
    headers.set("X-Connection-Api-Key", connectionAPIKey);
  } else {
    const bearer = await getAppUserGatewayAccessToken(gatewayBaseUrl, "disconnectAppUser");
    headers.set("Authorization", `Bearer ${bearer}`);
  }
  headers.set("Content-Type", "application/json");
  const res = await fetch(`${gatewayBaseUrl}/api/v1/app-users/connection`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ connector_id: connectorId }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`App User disconnect failed (${res.status}): ${text || res.statusText}`);
  }
}

export interface ExchangeAppUserOAuthCodeResult {
  connectionAPIKey: string;
  connectorId: string;
}

export async function exchangeAppUserOAuthCode(
  gatewayBaseUrl: string,
  code: string,
): Promise<ExchangeAppUserOAuthCodeResult> {
  const bearer = requireApiKey();
  const res = await fetch(`${gatewayBaseUrl}/api/v1/app-users/oauth2/exchange`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`App User OAuth exchange failed (${res.status}): ${text || res.statusText}`);
  }

  let body: { api_key?: string; connector_id?: string };
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`App User OAuth exchange returned invalid JSON: ${text.slice(0, 200)}`);
  }
  if (!body.api_key) throw new Error("App User OAuth exchange response missing api_key");
  if (!body.connector_id) throw new Error("App User OAuth exchange response missing connector_id");
  return { connectionAPIKey: body.api_key, connectorId: body.connector_id };
}
