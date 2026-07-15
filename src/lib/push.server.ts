// Helpers server-only para envio de Web Push via VAPID.
// Não importe este arquivo em rotas/componentes — só em .functions.ts
// (dentro do handler) ou em outros *.server.ts.

import webpush from "web-push";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:contato@anfitriaosigma.com.br";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys ausentes no ambiente");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  data?: {
    url?: string;
    conversationId?: string;
    tag?: string;
    [k: string]: unknown;
  };
};

export type StoredSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Envia push para uma lista de subscriptions. Retorna quais devem ser removidas
 * (410/404 Gone) para o chamador limpar do banco.
 */
export async function sendPushToSubscriptions(
  subs: StoredSubscription[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number; stale: string[] }> {
  ensureConfigured();
  const body = JSON.stringify(payload);
  const stale: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (err: any) {
        failed++;
        const status = err?.statusCode ?? err?.status;
        if (status === 404 || status === 410) stale.push(s.id);
      }
    }),
  );

  return { sent, failed, stale };
}
