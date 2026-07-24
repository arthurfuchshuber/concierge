import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, cpf, phone, phone_country, trade_name, birth_date, job_title")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const { data: userRes } = await supabase.auth.getUser();
    return {
      profile: profile ?? null,
      email: userRes.user?.email ?? null,
    };
  });

const UpdateInput = z.object({
  full_name: z.string().trim().min(1, "Nome completo é obrigatório").max(120),
  trade_name: z.string().trim().max(120).optional().nullable(),
  birth_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .refine((d) => new Date(d) <= new Date(), "Data de nascimento não pode ser no futuro"),
  job_title: z.string().trim().max(80).optional().nullable(),
});

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: data.full_name,
        trade_name: data.trade_name?.trim() ? data.trade_name.trim() : null,
        birth_date: data.birth_date,
        job_title: data.job_title?.trim() ? data.job_title.trim() : null,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const AvatarInput = z.object({
  fileBase64: z.string().min(10),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
});

export const uploadMyAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AvatarInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const ext = data.contentType === "image/png" ? "png" : data.contentType === "image/webp" ? "webp" : "jpg";
    const path = `${userId}/avatar-${Date.now()}.${ext}`;
    const bytes = Uint8Array.from(atob(data.fileBase64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > 3 * 1024 * 1024) {
      throw new Error("Arquivo maior que 3MB. Use uma imagem menor.");
    }
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (upErr) throw new Error(upErr.message);
    const { data: signed, error: signErr } = await supabase.storage
      .from("avatars")
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 10); // 10 anos
    if (signErr) throw new Error(signErr.message);
    const url = signed.signedUrl;
    const { error: profErr } = await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("id", userId);
    if (profErr) throw new Error(profErr.message);
    return { url };
  });

export const removeMyAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const CpfInput = z.object({
  cpf: z.string().trim().regex(/^\d{11}$/, "CPF inválido (11 dígitos)"),
});

function isValidCPFDigits(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (base: string, factor: number) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (factor - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return (
    calc(d.slice(0, 9), 10) === Number(d[9]) &&
    calc(d.slice(0, 10), 11) === Number(d[10])
  );
}

export const setMissingCpf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CpfInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
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

const EmailInput = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

export const requestEmailChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EmailInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.auth.updateUser({ email: data.email });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
