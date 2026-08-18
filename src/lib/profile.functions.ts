import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ownerId: z.string().uuid().nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const ownerId = await resolveAuthorizedAccountOwnerId(supabase, userId, data.ownerId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: profile, error }, { data: authUser, error: authError }] = await Promise.all([
      supabaseAdmin
      .from("profiles")
      .select("id, full_name, avatar_url, cpf, phone, phone_country, trade_name, birth_date, job_title, created_at, onboarding_completed_at")
      .eq("id", ownerId)
      .maybeSingle(),
      supabaseAdmin.auth.admin.getUserById(ownerId),
    ]);
    if (error) throw new Error(error.message);
    if (authError) throw new Error("Não foi possível carregar os dados de acesso desta conta.");
    return {
      profile: profile ?? null,
      email: authUser.user?.email ?? null,
    };
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      ownerId: z.string().uuid().nullable().optional(),
      full_name: z.string().trim().min(1, "Nome completo é obrigatório").max(120),
      trade_name: z.string().trim().max(120).optional().nullable(),
      birth_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
        .refine((date) => new Date(date) <= new Date(), "Data de nascimento não pode ser no futuro"),
      job_title: z.string().trim().max(80).optional().nullable(),
      phone: z.string().trim().max(30).optional().nullable(),
      phone_country: z.string().trim().max(8).optional().nullable(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const ownerId = await resolveAuthorizedAccountOwnerId(supabase, userId, data.ownerId);
    if (ownerId !== userId) {
      const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      if (roleError || !isAdmin) throw new Error("Apenas o titular ou um administrador pode alterar este perfil.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        full_name: data.full_name,
        trade_name: data.trade_name?.trim() ? data.trade_name.trim() : null,
        birth_date: data.birth_date,
        job_title: data.job_title?.trim() ? data.job_title.trim() : null,
        phone: data.phone?.trim() ? data.phone.trim() : null,
        phone_country: data.phone_country?.trim() ? data.phone_country.trim() : null,
      })
      .eq("id", ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const uploadMyAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      ownerId: z.string().uuid().nullable().optional(),
      fileBase64: z.string().min(10),
      contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const ownerId = await resolveAuthorizedAccountOwnerId(supabase, userId, data.ownerId);
    if (ownerId !== userId) {
      const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      if (roleError || !isAdmin) throw new Error("Apenas o titular ou um administrador pode alterar esta foto.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ext = data.contentType === "image/png" ? "png" : data.contentType === "image/webp" ? "webp" : "jpg";
    const path = `${ownerId}/avatar-${Date.now()}.${ext}`;
    const bytes = Uint8Array.from(atob(data.fileBase64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > 3 * 1024 * 1024) {
      throw new Error("Arquivo maior que 3MB. Use uma imagem menor.");
    }
    const { error: upErr } = await supabaseAdmin.storage
      .from("avatars")
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (upErr) throw new Error(upErr.message);
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("avatars")
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 10); // 10 anos
    if (signErr) throw new Error(signErr.message);
    const url = signed.signedUrl;
    const { error: profErr } = await supabaseAdmin
      .from("profiles")
      .update({ avatar_url: url })
      .eq("id", ownerId);
    if (profErr) throw new Error(profErr.message);
    return { url };
  });

export const removeMyAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ownerId: z.string().uuid().nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const ownerId = await resolveAuthorizedAccountOwnerId(supabase, userId, data.ownerId);
    if (ownerId !== userId) {
      const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      if (roleError || !isAdmin) throw new Error("Apenas o titular ou um administrador pode remover esta foto.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("profiles").update({ avatar_url: null }).eq("id", ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setMissingCpf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ cpf: z.string().trim().regex(/^\d{11}$/, "CPF inválido (11 dígitos)") }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const isValidCPFDigits = (digits: string): boolean => {
      if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
      const calc = (base: string, factor: number) => {
        let sum = 0;
        for (let index = 0; index < base.length; index++) sum += Number(base[index]) * (factor - index);
        const rest = (sum * 10) % 11;
        return rest === 10 ? 0 : rest;
      };
      return calc(digits.slice(0, 9), 10) === Number(digits[9]) && calc(digits.slice(0, 10), 11) === Number(digits[10]);
    };
    if (!isValidCPFDigits(data.cpf)) throw new Error("CPF inválido.");
    const { data: current } = await supabase
      .from("profiles").select("cpf").eq("id", userId).maybeSingle();
    if (current?.cpf) throw new Error("CPF já cadastrado. Alteração apenas via suporte.");
    const { data: dup } = await supabase
      .from("profiles").select("id").neq("id", userId).eq("cpf", data.cpf).limit(1).maybeSingle();
    if (dup) throw new Error("Este CPF já está cadastrado em outra conta.");
    const { error } = await supabase.from("profiles").update({ cpf: data.cpf }).eq("id", userId);
    if (error) {
      const msg = error.message || "";
      if (msg.includes("profiles_cpf_unique_digits") || msg.toLowerCase().includes("duplicate"))
        throw new Error("Este CPF já está cadastrado em outra conta.");
      throw new Error(msg);
    }
    return { ok: true };
  });

export const requestEmailChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      ownerId: z.string().uuid().nullable().optional(),
      email: z.string().trim().toLowerCase().email().max(200),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const ownerId = await resolveAuthorizedAccountOwnerId(supabase, userId, data.ownerId);
    if (ownerId === userId) {
      const { error } = await supabase.auth.updateUser({ email: data.email });
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError || !isAdmin) throw new Error("Apenas o titular ou um administrador pode alterar este e-mail.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(ownerId, { email: data.email });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
