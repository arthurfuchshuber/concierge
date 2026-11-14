import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Funções de servidor do módulo fiscal. TODA função passa por `authorizeFiscal` (módulo habilitado + titular da conta: `owner_only`).
 * Ninguém mais — nem admin SaaS, admin operacional, membro ou prestador — tem caminho aqui (403).
 */
const Owner = z.object({ ownerId: z.string().uuid().nullish() });
const uuid = z.string().uuid();
const envEnum = z.enum(["homologation", "production"]);

import type * as Service from "./service.server";

export type FiscalOverview =
  | { enabled: false }
  | {
      enabled: true;
      ownerId: string;
      connections: Awaited<ReturnType<typeof Service.getConnectionPublic>>;
      companies: Awaited<ReturnType<typeof Service.listCompanies>>;
      documents: Awaited<ReturnType<typeof Service.listDocuments>>;
      operations: Awaited<ReturnType<typeof Service.listOperations>>;
    };

async function svc() { return import("./service.server"); }

export const fiscalOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<FiscalOverview> => {
    const s = await svc();
    try {
      const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "empresas.ver");
      const [connections, companies, documents, operations] = await Promise.all([s.getConnectionPublic(db, ownerId), s.listCompanies(db, ownerId), s.listDocuments(db, ownerId), s.listOperations(db, ownerId)]);
      return { enabled: true, ownerId, connections, companies, documents, operations };
    } catch (e) {
      if ((e as { code?: string }).code === "module_disabled") return { enabled: false };
      throw e;
    }
  });

export const fiscalSaveConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.extend({ environment: envEnum, token: z.string().min(8).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "provedor.configurar");
    const r = await s.saveConnection(db, ownerId, { environment: data.environment, token: data.token });
    // o segredo do webhook é mostrado UMA vez (só o hash fica guardado)
    return { id: r.id, fingerprint: r.fingerprint, webhookPath: `/api/public/webhooks/fiscal/${r.id}/${r.webhookSecret}` };
  });

export const fiscalTestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.extend({ connectionId: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "provedor.testar");
    return s.testConnection(db, ownerId, data.connectionId);
  });

export const fiscalCreateCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.extend({ connectionId: uuid, taxId: z.string().min(11).max(18), legalName: z.string().min(2).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "empresas.cadastrar");
    return s.createCompany(db, ownerId, data);
  });

export const fiscalPrepareOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    Owner.extend({ companyId: uuid, kind: z.enum(["issue", "cancel"]), documentKind: z.enum(["nfe", "nfse", "nfsen", "cte"]).optional(), documentId: uuid.optional(), payload: z.record(z.string(), z.unknown()) }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, data.kind === "issue" ? "documentos.preparar" : "documentos.cancelar-preparar");
    return s.prepareOperation(db, ownerId, context.userId, data);
  });

/** Autoriza (ato humano, uso único) e envia no mesmo passo — `immediate` é o único modo. */
export const fiscalAuthorizeAndSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.extend({ operationId: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "autorizacoes.autorizar");
    const { authorizationId } = await s.authorizeOperation(db, ownerId, context.userId, data.operationId);
    const outcome = await s.dispatchOperation(db, ownerId, data.operationId, authorizationId);
    return { outcome };
  });

export const fiscalRejectOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.extend({ operationId: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "autorizacoes.rejeitar");
    await s.rejectOperation(db, ownerId, context.userId, data.operationId);
    return { ok: true as const };
  });

export const fiscalAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "auditoria");
    return { items: await s.listAudit(db, ownerId) };
  });

/** Projeção segura: só metadados públicos (status, razão social, fantasia, CNPJ, validade do certificado). */
export const fiscalStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<Service.FiscalStatusPublic> => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "empresas.ver");
    return s.getFiscalStatusPublic(db, ownerId);
  });

/** Upload write-only do certificado A1 (também "Substituir Certificado"). Não existe rota de leitura/download. */
export const fiscalSubmitCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    Owner.extend({ companyId: uuid, pfxBase64: z.string().min(16).max(400_000), password: z.string().min(1).max(200), companyFields: z.record(z.string(), z.unknown()).default({}), dryRun: z.boolean().default(true) }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "empresas.certificado");
    return s.submitCompanyCertificate(db, ownerId, context.userId, data);
  });

/** Arquivos (XML/PDF) de um documento: só metadados. */
export const fiscalDocumentFiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.extend({ documentId: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "documentos.ver");
    return { files: await s.listDocumentFiles(db, ownerId, data.documentId) };
  });

/** Busca no provedor e guarda XML/PDF de uma nota autorizada (idempotente). */
export const fiscalCaptureFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.extend({ documentId: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "documentos.consultar");
    return s.captureDocumentFiles(db, ownerId, data.documentId);
  });

/** Link assinado curto (60 s) do XML/PDF da nota, só para o titular. */
export const fiscalDocumentFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.extend({ fileId: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "documentos.baixar");
    return s.documentFileSignedUrl(db, ownerId, context.userId, data.fileId);
  });

/** Leve: o menu só mostra "Fiscal" quando o módulo está habilitado E a pessoa tem acesso. Nunca lança. */
export const fiscalMenuVisible = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const s = await svc();
    try {
      await s.authorizeFiscal(context.userId, data.ownerId, "empresas.ver");
      return { visible: true as const };
    } catch {
      return { visible: false as const };
    }
  });
