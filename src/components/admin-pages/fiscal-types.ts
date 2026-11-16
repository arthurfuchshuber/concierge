import type { CompanyPrefill } from "@/lib/fiscal/company-prefill";
import type { FiscalStatusPublic, FiscalServicePublic } from "@/lib/fiscal/service.server";

export type FiscalCompany = FiscalStatusPublic["companies"][number];
export type FiscalService = FiscalServicePublic;
export type Prefill = Extract<CompanyPrefill, { ok: true }>;
/** Visões da janela: principal, substituir certificado, editar dados e formulário de serviço ("‹ Voltar" nas três últimas). */
export type FiscalView = "main" | "replace" | "edit" | "service";
export type MainTab = "empresa" | "servicos" | "preferencias";
