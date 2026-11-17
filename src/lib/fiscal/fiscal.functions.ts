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


/**
 * Ativação em uma chamada (White-Label): dados da empresa + certificado A1 → Focus (conexão mestre da plataforma).
 * Só o titular da conta; o `.pfx`/senha nunca são gravados nem devolvidos. Retorna apenas metadados públicos.
 */
const Address = z.object({ cep: z.string().min(8).max(9), street: z.string().min(1).max(200), number: z.string().min(1).max(20), neighborhood: z.string().min(1).max(100), city: z.string().min(1).max(100), state: z.string().length(2) });
export const fiscalSetupCompanyWithCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      taxId: z.string().min(14).max(18), legalName: z.string().min(2).max(200), tradeName: z.string().max(200).nullish(),
      municipalRegistration: z.string().min(1).max(30), address: Address,
      email: z.string().max(200).nullish(), phone: z.string().max(20).nullish(), simples: z.enum(["nao_optante", "mei", "me_epp"]).nullish(),
      cnaeCode: z.string().max(10).nullish(), cnaeDescription: z.string().max(300).nullish(), ibgeCityCode: z.string().max(10).nullish(),
      pfxBase64: z.string().min(16).max(400_000), password: z.string().min(1).max(200), dryRun: z.boolean().optional(),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const db = await s.adminDb();
    const { assertTaxIdIsAccountCnpj } = await import("./company-prefill");
    // CNPJ da empresa (do perfil ou informado pelo titular): precisa ser válido; o certificado e a Focus validam o resto.
    if (!(await assertTaxIdIsAccountCnpj(db, context.userId, data.taxId))) return { ok: false as const, code: "cnpj_invalid" };
    return s.setupCompanyWithCertificate(db, context.userId, data);
  });

/** Janelas Fiscal/Serviços/Preferências (mockups A–R). Todas `owner_only` pelo guarda; empresa sempre conferida contra a conta. */
const Co = Owner.extend({ companyId: uuid });
export const fiscalCompanyUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Co.extend({ data: z.record(z.string(), z.unknown()) }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "empresas.cadastrar");
    return s.updateCompanyData(db, ownerId, context.userId, data.companyId, data.data);
  });
export const fiscalPreferencesSave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Co.extend({ data: z.record(z.string(), z.unknown()) }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "empresas.cadastrar");
    return s.savePreferences(db, ownerId, context.userId, data.companyId, data.data);
  });
export const fiscalServicesList = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Co.parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "empresas.ver");
    return s.listServices(db, ownerId, data.companyId);
  });
export const fiscalServiceSave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Co.extend({ serviceId: uuid.nullish(), data: z.record(z.string(), z.unknown()) }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "empresas.cadastrar");
    return data.serviceId ? s.updateService(db, ownerId, context.userId, data.companyId, data.serviceId, data.data) : s.createService(db, ownerId, context.userId, data.companyId, data.data);
  });
export const fiscalServiceDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Co.extend({ serviceId: uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "empresas.cadastrar");
    return s.deleteService(db, ownerId, context.userId, data.companyId, data.serviceId);
  });
export const fiscalDeactivate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Co.parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const { db, ownerId } = await s.authorizeFiscal(context.userId, data.ownerId, "empresas.desativar");
    return s.deactivateCompany(db, ownerId, context.userId, data.companyId);
  });
/** Busca do código de tributação nacional (lupa): catálogo local, sem rede. */
export const fiscalSearchServiceCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Owner.extend({ query: z.string().max(80) }).parse(i))
  .handler(async ({ data, context }) => {
    const s = await svc();
    await s.authorizeFiscal(context.userId, data.ownerId, "empresas.ver");
    const { searchNationalCodes } = await import("./national-codes");
    return { items: searchNationalCodes(data.query) };
  });

/** Dados da empresa (CNPJ da conta + Receita Federal) para a janela de ativação. Só o titular; nada sensível. */
export const fiscalCompanyPrefill = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ taxId: z.string().max(18).nullish() }).nullish().parse(i))
  .handler(async ({ data: input, context }) => {
    const { lookupCompanyByCnpj, onlyDigits, prefillFromAccountCompany } = await import("./company-prefill");
    // CNPJ informado pelo titular na janela tem prioridade; depois a empresa do Perfil (account_companies); por fim profiles.cpf.
    const typed = onlyDigits(input?.taxId);
    if (typed) return lookupCompanyByCnpj(typed);
    const s = await svc();
    const db = await s.adminDb();
    const { data: ac } = await db.from("account_companies").select("*").eq("owner_id", context.userId).maybeSingle();
    const fromProfile = await prefillFromAccountCompany(ac);
    if (fromProfile) return fromProfile;
    const { data } = await db.from("profiles").select("cpf").eq("id", context.userId).maybeSingle();
    return lookupCompanyByCnpj(data?.cpf);
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
