import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getCookie, setCookie } from "@tanstack/react-start/server";

const SlugInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  previewToken: z.string().max(300).optional().nullable(),
  // Vitrine pública (landing): mostra o guia REAL, porém com todo dado
  // sensível mascarado (senhas, códigos de fechadura/portão e telefones).
  demo: z.boolean().optional(),
});

async function loadFullGuide(supabaseAdmin: typeof import("@/integrations/supabase/client.server").supabaseAdmin, propertyId: string) {
  const [manual, recs, emerg, faqs, checkout] = await Promise.all([
    supabaseAdmin.from("property_manual_items").select("*").eq("property_id", propertyId).order("position"),
    supabaseAdmin.from("property_recommendations").select("*").eq("property_id", propertyId).eq("scope", "nearby").order("type").order("position"),
    supabaseAdmin.from("property_emergency_contacts").select("*").eq("property_id", propertyId).order("position"),
    supabaseAdmin.from("property_faqs").select("*").eq("property_id", propertyId).order("position"),
    supabaseAdmin.from("property_checkout_items").select("*").eq("property_id", propertyId).order("position"),
  ]);
  return {
    manual: manual.data ?? [],
    recommendations: recs.data ?? [],
    emergency: emerg.data ?? [],
    faqs: faqs.data ?? [],
    checkout: checkout.data ?? [],
  };
}

// Credentials (wifi_*, lock_code, gate_code, host_phone) are the purpose of the
// guide and are gated by access_mode + PIN cookie below. pin_code and owner_id
// are never returned to guests.

export const getPublicGuide = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => SlugInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Pré-visualização do anfitrião: token assinado libera o guia mesmo em rascunho.
    const { verifyGuidePreviewToken } = await import("@/lib/guide-preview.server");
    const isPreview = await verifyGuidePreviewToken(data.slug, data.previewToken ?? null);
    // First fetch only access-control + display fields (no credentials, no pin_code).
    let baseQuery = supabaseAdmin
      .from("properties")
      .select("id,owner_id,slug,name,tagline,hero_image_url,gallery_images,theme_images,marketplace_links,address,maps_url,garage_maps_url,lat,lng,city,state,country,checkin_time,checkin_time_max,checkin_note,checkout_time,checkout_time_min,checkout_note,address_note,checkin_instructions,checkout_instructions,checkin_media,house_rules,gate_label,gate_instructions,gate_media,gate_video_url,lock_label,lock_instructions,lock_media,lock_video_url,host_name,brand_name,brand_logo_url,access_mode,pin_expires_at,default_language,guide_theme,require_access_gate,collect_arrival_time,collect_vehicles,vehicles_max,collect_document,document_scope,published,created_at,updated_at,airbnb_ical_url")
      .eq("slug", data.slug);
    if (!isPreview) baseQuery = baseQuery.eq("published", true);
    const { data: prop, error } = await baseQuery.maybeSingle();
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    if (!prop) {
      // Link antigo: o anfitrião renomeou o guia. Redirecionamos para o slug atual
      // para que hóspedes que já receberam o link anterior continuem chegando.
      const { data: hist } = await (supabaseAdmin.from("property_slug_history" as never) as ReturnType<typeof supabaseAdmin.from>)
        .select("property_id")
        .eq("old_slug", data.slug)
        .maybeSingle();
      const movedTo = (hist as { property_id?: string } | null)?.property_id;
      if (movedTo) {
        const { data: target } = await supabaseAdmin
          .from("properties")
          .select("slug,published")
          .eq("id", movedTo)
          .maybeSingle();
        if (target?.slug && target.published) {
          return { status: "moved" as const, slug: target.slug };
        }
      }
      return { status: "not_found" as const };
    }


    if (!isPreview && prop.access_mode === "pin" && prop.pin_expires_at && new Date(prop.pin_expires_at) < new Date()) {
      return { status: "expired" as const, propertyName: prop.name };
    }

    if (!isPreview && prop.access_mode === "pin") {
      // Cookie assinado (16/09/2026): o valor fixo "ok" podia ser forjado.
      const { verifyPinCookie, pinCookieName } = await import("@/lib/guest-access.server");
      const { data: pinRow } = await supabaseAdmin
        .from("properties")
        .select("pin_code")
        .eq("id", prop.id)
        .maybeSingle();
      const pinOk = await verifyPinCookie(
        "pin",
        prop.id as string,
        (pinRow as { pin_code?: string | null } | null)?.pin_code ?? null,
        getCookie(pinCookieName("pin", prop.id as string)) ?? null,
      );
      if (!pinOk) {
        return { status: "locked" as const, propertyName: prop.name, expiresAt: prop.pin_expires_at };
      }
    }

    // Access granted — now fetch credential fields in a separate query.
    // access_codes_pin NEVER leaves the server; we only expose whether one is set
    // and whether the current visitor has already unlocked it via cookie.
    const { data: creds } = await supabaseAdmin
      .from("properties")
      .select("wifi_ssid,wifi_password,lock_code,gate_code,host_phone,access_codes_pin")
      .eq("id", prop.id)
      .maybeSingle();

    const rawPin = (creds?.access_codes_pin ?? "").toString().trim();
    const hasAccessPin = rawPin.length > 0;
    const guestAccess = await import("@/lib/guest-access.server");
    let accessUnlocked = hasAccessPin
      ? isPreview ||
        (await guestAccess.verifyPinCookie(
          "accesscodes",
          prop.id as string,
          rawPin,
          getCookie(guestAccess.pinCookieName("accesscodes", prop.id as string)) ?? null,
        ))
      : true;
    // A liberação por cookie acima só confirma que o PIN já foi validado
    // alguma vez nas últimas 24h (maxAge do cookie) — não que "agora" ainda
    // está dentro da janela de liberação do código (24h antes do check-in
    // até o check-out), que é a mesma regra já aplicada no agente de IA
    // (pinReleaseAt em src/lib/ai/context.server.ts). Revalidamos aqui contra
    // os dados reais de reserva do imóvel para fechar esse mesmo código fora
    // da janela mesmo com cookie válido (ex.: pouco antes do check-out).
    if (hasAccessPin && !isPreview && accessUnlocked) {
      const { propertyTimeZone, todayInTZ } = await import("@/lib/property-timezone");
      const { resolveAccessPinWindow } = await import("@/lib/access-pin-window.server");
      const tz = propertyTimeZone(prop.city as string | null, prop.country as string | null);
      const today = todayInTZ(tz);
      const win = await resolveAccessPinWindow(
        supabaseAdmin,
        prop.id as string,
        tz,
        (prop as any).checkin_time,
        (prop as any).checkout_time,
        today,
      );
      if (win.hasData && !win.released) accessUnlocked = false;
    }

    // Strip the PIN out of the payload no matter what.
    const { access_codes_pin: _omit, wifi_password, lock_code, gate_code, ...credsPublic } = (creds ?? {}) as Record<string, unknown> & {
      access_codes_pin?: string | null;
      wifi_password?: string | null;
      lock_code?: string | null;
      gate_code?: string | null;
    };
    // Only reveal protected codes when the visitor has unlocked them.
    const isDemo = data.demo === true;
    if (isDemo) accessUnlocked = true;
    /* SENHAS SÓ COM RESERVA COMPROVADA (16/09/2026).
     *
     * Nos guias com código de reserva, a exigência vivia só na tela: esta
     * função entregava Wi-Fi, portão e fechadura para qualquer chamada direta
     * — e o sitemap lista o link de todo guia público. Agora esses três campos
     * NÃO saem daqui nesses guias; o guia os pede a `revealGuideAccessCodes`
     * com o código da reserva que o hóspede já informou no formulário. Os
     * sinalizadores `*_set` continuam indo, então a tela não muda. */
    const codesNeedReservation =
      !isPreview && !isDemo && guestAccess.isReservationGated(prop as never);
    const protectedCodes = isDemo
      ? { wifi_password: "demo-2026", lock_code: "0000", gate_code: "0000" }
      : accessUnlocked && !codesNeedReservation
        ? { wifi_password: wifi_password ?? null, lock_code: lock_code ?? null, gate_code: gate_code ?? null }
        : { wifi_password: null, lock_code: null, gate_code: null };
    if (isDemo && credsPublic["host_phone"]) credsPublic["host_phone"] = "+55 (00) 00000-0000";
    // Booleans so the UI can render gated/masked slots even before unlock.
    const setFlags = {
      wifi_password_set: !!(wifi_password && String(wifi_password).trim()),
      lock_code_set: !!(lock_code && String(lock_code).trim()),
      gate_code_set: !!(gate_code && String(gate_code).trim()),
    };

    // owner_id é uso interno (plano/dono) e nunca deve chegar ao hóspede.
    // `airbnb_ical_url` só serve para decidir a regra acima: é o feed privado
    // do calendário do anfitrião e nunca vai ao navegador.
    const {
      owner_id: _ownerId,
      airbnb_ical_url: _ical,
      ...propPublic
    } = prop as Record<string, unknown>;
    const safeProp = {
      ...propPublic,
      ...credsPublic,
      ...protectedCodes,
      ...setFlags,
      hasAccessPin,
      accessUnlocked,
      codesNeedReservation,
    };
    // Vitrine (landing): é apenas um ESPELHO do guia. Nada que identifique ou
    // dê acesso ao imóvel real pode sair daqui — endereço, mapa, coordenadas,
    // rede de wi-fi e qualquer número longo dentro das instruções.
    const demoProp = safeProp as Record<string, unknown>;
    if (isDemo) {
      const secrets = [wifi_password, lock_code, gate_code, credsPublic["host_phone"]]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      const scrub = (value: unknown) => {
        if (typeof value !== "string") return value;
        return secrets.reduce((text, secret) => text.split(secret).join("0000"), value);
      };
      demoProp["address"] = "Endereço enviado ao hóspede no dia da chegada";
      demoProp["address_note"] = null;
      demoProp["maps_url"] = null;
      demoProp["garage_maps_url"] = null;
      demoProp["lat"] = null;
      demoProp["lng"] = null;
      demoProp["wifi_ssid"] = "Rede da casa";
      demoProp["checkin_instructions"] = scrub(demoProp["checkin_instructions"]);
      demoProp["checkout_instructions"] = scrub(demoProp["checkout_instructions"]);
      demoProp["lock_instructions"] = scrub(demoProp["lock_instructions"]);
      demoProp["gate_instructions"] = scrub(demoProp["gate_instructions"]);
    }
    const children = await loadFullGuide(supabaseAdmin, prop.id);
    // No modo vitrine, nenhum telefone real de contato sai do servidor.
    if (isDemo) {
      for (const c of children.emergency as Array<{ phone?: string | null }>) {
        if (c.phone) c.phone = "+55 (00) 00000-0000";
      }
    }
    const { signPropertyImages } = await import("@/lib/storage.server");
    const signedProp = await signPropertyImages(supabaseAdmin, safeProp);
    // Resolve owner plan to gate AI chat in the public guide UI.
    const { resolveOwnerPlanAdmin } = await import("@/lib/plan-guard.server");
    const ownerPlan = await resolveOwnerPlanAdmin(supabaseAdmin as any, (prop as any).owner_id as string);
    const aiEnabled = !!ownerPlan.features.guestChat;

    // Referências macro da cidade — escopo POR IMÓVEL OU POR GRUPO de guias
    // vinculados. Nunca compartilhamos por city_key (causava vazamento entre
    // guias da mesma cidade).
    let cityReferences: any[] = [];
    const { data: membership } = await supabaseAdmin
      .from("city_reference_group_members")
      .select("group_id")
      .eq("property_id", prop.id)
      .maybeSingle();
    const groupId = (membership as { group_id: string } | null)?.group_id ?? null;
    {
      let q = supabaseAdmin
        .from("city_references")
        .select("id, category, type, name, note, address, rating, user_ratings_total, image_url, maps_url, opening_hours, lat, lng, place_id, display_order")
        .eq("is_hidden", false)
        .order("type")
        .order("display_order")
        .order("user_ratings_total", { ascending: false });
      if (groupId) q = q.eq("group_id", groupId);
      else q = q.eq("property_id", prop.id).is("group_id", null);
      const { data } = await q;
      cityReferences = data ?? [];
    }


    return { status: "ok" as const, property: signedProp, ...children, aiEnabled, cityReferences };
  });

const AccessPinSubmit = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  pin: z.string().min(1).max(32),
});

export const submitAccessPin = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => AccessPinSubmit.parse(i))
  .handler(async ({ data }) => {
    // Sem limite, um PIN numérico curto caía por tentativa e erro (16/09/2026).
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const ip = clientIpFrom(getRequest());
    if (
      !allowPublicRate(`access-pin:${ip}`, 10, 10 * 60_000) ||
      !allowPublicRate(`access-pin-slug:${data.slug}`, 60, 10 * 60_000)
    ) {
      return { ok: false as const, reason: "rate_limited" };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop, error } = await supabaseAdmin
      .from("properties")
      .select("id, access_codes_pin, wifi_password, lock_code, gate_code, city, country, checkin_time, checkout_time, tagline, airbnb_ical_url")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    if (!prop) return { ok: false as const, reason: "not_found" };
    const stored = ((prop as any).access_codes_pin ?? "").toString().trim();
    if (!stored) return { ok: false as const, reason: "not_required" };
    const { safeEqual, signPinCookie, pinCookieName, isReservationGated } =
      await import("@/lib/guest-access.server");
    if (!safeEqual(stored, data.pin.trim())) return { ok: false as const, reason: "wrong" };
    // Nos guias com código de reserva, o PIN libera a visualização mas as
    // senhas continuam vindo de `revealGuideAccessCodes` (prova da reserva).
    const gated = isReservationGated(prop as never);
    // Mesma janela de liberação aplicada em getPublicGuide (ver comentário
    // lá e em src/lib/access-pin-window.server.ts): PIN correto não basta se
    // a reserva vigente do imóvel já passou do check-out, ou ainda não
    // chegou nas 24h que antecedem o check-in.
    {
      const { propertyTimeZone, todayInTZ } = await import("@/lib/property-timezone");
      const { resolveAccessPinWindow } = await import("@/lib/access-pin-window.server");
      const tz = propertyTimeZone((prop as any).city ?? null, (prop as any).country ?? null);
      const today = todayInTZ(tz);
      const win = await resolveAccessPinWindow(
        supabaseAdmin,
        prop.id as string,
        tz,
        (prop as any).checkin_time,
        (prop as any).checkout_time,
        today,
      );
      if (win.hasData && !win.released) return { ok: false as const, reason: "window_closed" };
    }
    const accessMaxAge = 60 * 60 * 24;
    setCookie(
      pinCookieName("accesscodes", prop.id as string),
      await signPinCookie("accesscodes", prop.id as string, stored, accessMaxAge),
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: accessMaxAge,
      },
    );
    const codes = prop as {
      wifi_password?: string | null;
      lock_code?: string | null;
      gate_code?: string | null;
    };
    return {
      ok: true as const,
      wifi_password: gated ? null : (codes.wifi_password ?? null),
      lock_code: gated ? null : (codes.lock_code ?? null),
      gate_code: gated ? null : (codes.gate_code ?? null),
    };
  });


const PinSubmit = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  pin: z.string().min(1).max(20),
});

export const submitPin = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => PinSubmit.parse(i))
  .handler(async ({ data }) => {
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const ip = clientIpFrom(getRequest());
    if (
      !allowPublicRate(`guide-pin:${ip}`, 10, 10 * 60_000) ||
      !allowPublicRate(`guide-pin-slug:${data.slug}`, 60, 10 * 60_000)
    ) {
      return { ok: false as const, reason: "rate_limited" };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop, error } = await supabaseAdmin
      .from("properties")
      .select("id, pin_code, pin_expires_at, access_mode")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    if (!prop || prop.access_mode !== "pin") return { ok: false as const, reason: "not_found" };
    if (prop.pin_expires_at && new Date(prop.pin_expires_at) < new Date()) {
      return { ok: false as const, reason: "expired" };
    }
    const { safeEqual, signPinCookie, pinCookieName } = await import("@/lib/guest-access.server");
    if (!prop.pin_code || !safeEqual(String(prop.pin_code), data.pin)) {
      return { ok: false as const, reason: "wrong" };
    }
    // maxAge alinhado com pin_expires_at: o cookie expira junto com o guia.
    // Fallback de 24h quando não há data de expiração configurada.
    const expiresAt = prop.pin_expires_at ? new Date(prop.pin_expires_at).getTime() : null;
    const maxAge = expiresAt
      ? Math.max(60, Math.floor((expiresAt - Date.now()) / 1000))
      : 60 * 60 * 24;
    setCookie(
      pinCookieName("pin", prop.id as string),
      await signPinCookie("pin", prop.id as string, String(prop.pin_code), maxAge),
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge,
      },
    );
    return { ok: true as const };
  });

const RevealCodesInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  property_id: z.string().uuid().optional(),
  code: z.string().trim().min(4).max(40),
});

/**
 * Entrega Wi-Fi / portão / fechadura ao hóspede que PROVOU a reserva
 * (16/09/2026). É o par de `getPublicGuide`, que deixou de mandar esses campos
 * nos guias com código de reserva. Mesma prova do formulário de acesso: o
 * código precisa estar ativo no iCal do imóvel, e o acesso cai sozinho quando
 * a reserva termina ou é cancelada.
 */
export const revealGuideAccessCodes = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => RevealCodesInput.parse(i))
  .handler(async ({ data }) => {
    const empty = { ok: false as const, wifi_password: null, lock_code: null, gate_code: null };
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guide-reveal:${clientIpFrom(getRequest())}`, 30, 60_000)) return empty;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("properties")
      .select("id, tagline, airbnb_ical_url, access_codes_pin, wifi_password, lock_code, gate_code")
      .eq("slug", data.slug)
      .eq("published", true);
    if (data.property_id) q = q.eq("id", data.property_id);
    const { data: prop } = await q.maybeSingle();
    if (!prop) return empty;

    const guestAccess = await import("@/lib/guest-access.server");
    // Guia sem código de reserva: nada a liberar aqui (segue a regra antiga).
    if (!guestAccess.isReservationGated(prop as never)) return empty;
    const res = await guestAccess.lookupReservationByCode(data.slug, prop.id as string, data.code);
    if (!res.ok) return empty;

    // Com PIN de visualização configurado, o PIN continua valendo por cima.
    const pin = ((prop as { access_codes_pin?: string | null }).access_codes_pin ?? "").trim();
    if (pin) {
      const ok = await guestAccess.verifyPinCookie(
        "accesscodes",
        prop.id as string,
        pin,
        getCookie(guestAccess.pinCookieName("accesscodes", prop.id as string)) ?? null,
      );
      if (!ok) return empty;
    }

    const p = prop as {
      wifi_password?: string | null;
      lock_code?: string | null;
      gate_code?: string | null;
    };
    return {
      ok: true as const,
      wifi_password: p.wifi_password ?? null,
      lock_code: p.lock_code ?? null,
      gate_code: p.gate_code ?? null,
    };
  });
