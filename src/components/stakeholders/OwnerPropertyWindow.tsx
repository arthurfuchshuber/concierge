import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Check,
  ChevronDown,
  Coins,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Home,
  Key,
  LifeBuoy,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Sparkles,
  User,
  Users,
  Wifi,
  X,
  Calendar,
  Flame,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { Stepper } from "@/components/editor/Stepper";
import {
  ACTION_BAR,
  ACTION_SEGMENT,
  ACTION_BUTTON_TONE,
  ACTION_ICON,
} from "@/components/dashboard/panel-chrome";
import { CARD_OWNER, ownerLabel } from "@/components/dashboard/card-colors";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { GroupList, GroupRow, GroupTitle, StatusTrail, CHIP_BTN } from "./owner-ui";

/**
 * IMÓVEL DENTRO DO PROPRIETÁRIO (mockups Prop3 e Prop4, 13/10/2026).
 *
 * Regra: o que PODEMOS informar no guia do hóspede é PÚBLICO; o que não
 * podemos é CONFIDENCIAL. Cada linha mostra a situação do preenchimento; as
 * linhas abrem a parte correspondente do editor (`focus`) ou, nas Senhas,
 * expandem aqui mesmo para nomear e editar cada uma.
 */

const COLS =
  "id, name, city, state, address, hero_image_url, airbnb_listing_url, airbnb_listing_last_synced_at, airbnb_ical_url, lock_code, lock_label, gate_code, gate_label, wifi_ssid, wifi_password, checkin_time, checkout_time, host_phone, house_rules, cleaning_price_normal_cents, cleaning_duration_normal_minutes";

type Focus = "house" | "airbnb" | "guide" | "checkin" | "faq" | "recs";

type RowDef = {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
  /** undefined = sem como medir (sem selo) */
  ok?: boolean;
  missing?: string;
  focus?: Focus;
  soon?: boolean;
};

type Slot = "gate" | "lock";
const SLOT_DEFAULT: Record<Slot, string> = { gate: "Portaria", lock: "Fechadura da porta" };

export function OwnerPropertyWindow({
  propertyId,
  onClose,
  returnTo,
  owner,
}: {
  propertyId: string | null;
  onClose: () => void;
  returnTo: string;
  owner?: { name: string | null; phone: string | null; country: string | null };
}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState("publicas");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ slot: Slot; name: string; code: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const q = useQuery({
    queryKey: ["owner-property-window", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const [prop, faqs, provs] = await Promise.all([
        supabase.from("properties").select(COLS).eq("id", propertyId!).maybeSingle(),
        supabase
          .from("property_faqs")
          .select("id", { count: "exact", head: true })
          .eq("property_id", propertyId!),
        supabase
          .from("property_providers")
          .select("id", { count: "exact", head: true })
          .eq("property_id", propertyId!),
      ]);
      if (prop.error) throw new Error(prop.error.message);
      return {
        p: prop.data as Record<string, any> | null,
        faqs: faqs.count ?? 0,
        providers: provs.count ?? 0,
      };
    },
  });
  const p = q.data?.p ?? null;
  const has = (v: unknown) => (typeof v === "string" ? v.trim().length > 0 : v != null);

  const slots = (["gate", "lock"] as Slot[])
    .map((s) => ({
      slot: s,
      name: (p?.[`${s}_label`] as string) || SLOT_DEFAULT[s],
      code: (p?.[`${s}_code`] as string) || "",
    }))
    .filter((s) => !!s.code);
  const freeSlot = (["gate", "lock"] as Slot[]).find((s) => !has(p?.[`${s}_code`]));

  const pub: Array<{ title: string; count: number; rows: RowDef[] }> = p
    ? [
        {
          title: "Sobre o imóvel",
          count: 2,
          rows: [
            {
              key: "id",
              icon: Home,
              title: "Identificação e endereço",
              sub: [p.name, p.city].filter(Boolean).join(" · "),
              ok: has(p.name) && has(p.address),
              missing: "Falta endereço",
              focus: "house",
            },
            {
              key: "airbnb",
              icon: Flame,
              title: "Anúncio Airbnb",
              sub: p.airbnb_listing_last_synced_at ? "Sincronizado" : "Link do anúncio",
              ok: has(p.airbnb_listing_url),
              missing: "Sem anúncio",
              focus: "airbnb",
            },
          ],
        },
        {
          title: "Para o hóspede",
          count: 5,
          rows: [
            {
              key: "senhas",
              icon: Key,
              title: "Senhas de acesso",
              sub: slots.length === 1 ? "1 senha" : `${slots.length} senhas`,
              ok: slots.length > 0,
              missing: "Sem senha",
            },
            {
              key: "wifi",
              icon: Wifi,
              title: "Wi-Fi",
              sub: "Rede e senha",
              ok: has(p.wifi_ssid),
              missing: "Falta rede",
              focus: "house",
            },
            {
              key: "horarios",
              icon: Key,
              title: "Chegada e saída",
              sub: "Horários e instruções",
              ok: has(p.checkin_time) && has(p.checkout_time),
              missing: "Falta horário",
              focus: "checkin",
            },
            {
              key: "faq",
              icon: LifeBuoy,
              title: "FAQ e emergência",
              sub: q.data!.faqs === 1 ? "1 pergunta" : `${q.data!.faqs} perguntas`,
              ok: q.data!.faqs > 0 && has(p.host_phone),
              missing: q.data!.faqs > 0 ? "Falta contato" : "Sem perguntas",
              focus: "faq",
            },
            {
              key: "regras",
              icon: BookOpen,
              title: "Regras e manual da casa",
              sub: "Regras, manual e detalhes",
              ok: has(p.house_rules),
              missing: "Sem regras",
              focus: "house",
            },
          ],
        },
      ]
    : [];

  const conf: Array<{ title: string; count: number; rows: RowDef[] }> = p
    ? [
        {
          title: "Financeiro e equipe",
          count: 3,
          rows: [
            { key: "fin", icon: Coins, title: "Financeiro", sub: "Em breve", soon: true },
            {
              key: "prest",
              icon: Users,
              title: "Prestadores de serviço",
              sub: q.data!.providers === 1 ? "1 vinculado" : `${q.data!.providers} vinculados`,
              ok: q.data!.providers > 0,
              missing: "Sem prestador",
              focus: "house",
            },
            {
              key: "limp",
              icon: Sparkles,
              title: "Limpeza",
              sub: "Custos e duração",
              ok:
                p.cleaning_price_normal_cents != null && p.cleaning_duration_normal_minutes != null,
              missing: "Falta custo",
              focus: "house",
            },
          ],
        },
        {
          title: "Reserva",
          count: 3,
          rows: [
            {
              key: "ical",
              icon: Calendar,
              title: "Calendário do Airbnb",
              sub: "Link iCal",
              ok: has(p.airbnb_ical_url),
              missing: "Sem iCal",
              focus: "house",
            },
            {
              key: "hosp",
              icon: User,
              title: "Dados do hóspede",
              sub: "Reserva atual",
              focus: "checkin",
            },
            {
              key: "docs",
              icon: FileText,
              title: "Contrato e documentos",
              sub: "Em breve",
              soon: true,
            },
          ],
        },
      ]
    : [];

  const measurable = (tab === "publicas" ? pub : conf)
    .flatMap((g) => g.rows)
    .filter((r) => r.ok !== undefined);
  const done = measurable.filter((r) => r.ok).length;
  const pct = measurable.length ? Math.round((done / measurable.length) * 100) : 0;

  async function saveSlot() {
    if (!editing || !propertyId) return;
    if (!editing.code.trim()) return toast.error("Informe a senha.");
    setSaving(true);
    const { error } = await supabase
      .from("properties")
      .update({
        [`${editing.slot}_label`]: editing.name.trim() || SLOT_DEFAULT[editing.slot],
        [`${editing.slot}_code`]: editing.code.trim(),
      } as never)
      .eq("id", propertyId);
    setSaving(false);
    if (error) return toast.error(`Não foi possível salvar: ${error.message}`);
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["owner-property-window", propertyId] });
    qc.invalidateQueries({ queryKey: ["property", propertyId] });
  }

  function rowTrail(r: RowDef) {
    if (r.soon) return <StatusTrail tone="nu">Em breve</StatusTrail>;
    if (r.ok === undefined) return undefined;
    return r.ok ? (
      <StatusTrail tone="ok">Completo</StatusTrail>
    ) : (
      <StatusTrail tone="at">{r.missing ?? "Falta"}</StatusTrail>
    );
  }

  function renderRow(r: RowDef) {
    if (r.key === "senhas") {
      const open = openRow === "senhas";
      return (
        <GroupRow
          key={r.key}
          icon={r.icon}
          title={r.title}
          sub={r.sub}
          trailing={rowTrail(r)}
          open={open}
          onToggle={() => setOpenRow(open ? null : "senhas")}
        >
          {slots.map((s) =>
            editing?.slot === s.slot ? null : (
              <div
                key={s.slot}
                className="flex min-h-11 items-center gap-2.5 rounded-[10px] bg-foreground/[0.03] py-0 pl-3 pr-1 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_6%,transparent)]"
              >
                <b className="flex min-w-0 flex-1 items-center gap-[7px] text-[13px] font-semibold">
                  <span className="truncate">{s.name}</span>
                  <button
                    type="button"
                    aria-label={`Editar ${s.name}`}
                    onClick={() => setEditing({ slot: s.slot, name: s.name, code: s.code })}
                    className="text-[color:var(--faint)] hover:text-foreground"
                  >
                    <Pencil className="size-[11px]" />
                  </button>
                </b>
                <code className="font-mono text-[13px] font-semibold tracking-[0.14em] text-muted-foreground">
                  {reveal[s.slot] ? s.code : "•".repeat(Math.min(Math.max(s.code.length, 6), 10))}
                </code>
                <button
                  type="button"
                  onClick={() => setReveal((m) => ({ ...m, [s.slot]: !m[s.slot] }))}
                  aria-label={reveal[s.slot] ? "Ocultar senha" : "Mostrar senha"}
                  className="grid size-8 place-items-center text-muted-foreground hover:text-foreground"
                >
                  {reveal[s.slot] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
            ),
          )}
          {editing && (
            <div className="grid gap-2 rounded-[10px] bg-foreground/[0.03] p-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_6%,transparent)]">
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Nome da senha (ex.: Portaria principal)"
                maxLength={40}
                className="h-9 rounded-[8px] bg-foreground/[0.04] px-3 text-[13px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)] placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <input
                value={editing.code}
                onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                placeholder="Senha ou código"
                maxLength={40}
                className="h-9 rounded-[8px] bg-foreground/[0.04] px-3 font-mono text-[13px] tracking-[0.1em] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)] placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="h-8 rounded-[8px] px-3 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveSlot}
                  className="flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12px] font-semibold text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] hover:bg-foreground/[0.05] disabled:opacity-40"
                >
                  {saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}{" "}
                  Salvar
                </button>
              </div>
            </div>
          )}
          {!editing && freeSlot && (
            <button
              type="button"
              onClick={() => setEditing({ slot: freeSlot, name: SLOT_DEFAULT[freeSlot], code: "" })}
              className="flex items-center gap-[7px] py-0.5 text-[12px] font-bold text-foreground"
            >
              <Plus className="size-[13px] text-muted-foreground" /> Adicionar senha
            </button>
          )}
        </GroupRow>
      );
    }
    if (r.soon) {
      return (
        <GroupRow
          key={r.key}
          icon={r.icon}
          title={r.title}
          sub={r.sub}
          trailing={rowTrail(r)}
          chevron={false}
        />
      );
    }
    return (
      <GroupRow
        key={r.key}
        icon={r.icon}
        title={r.title}
        sub={r.sub}
        trailing={rowTrail(r)}
        onClick={() =>
          navigate({
            to: "/admin/properties/$id",
            params: { id: p!.id },
            search: { focus: r.focus ?? "house", returnTo },
          })
        }
      />
    );
  }

  const ownerText = ownerLabel(owner?.name ?? null);

  return (
    <Sheet open={!!propertyId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={
          isMobile
            ? "w-full max-h-[75dvh] overflow-y-auto rounded-t-[var(--win-radius)] p-0"
            : "w-full overflow-y-auto p-0 sm:max-w-xl"
        }
      >
        <SheetTitle className="sr-only">{p?.name ?? "Imóvel"}</SheetTitle>
        <SheetDescription className="sr-only">
          Informações públicas e confidenciais do imóvel.
        </SheetDescription>
        <div className="flex w-full min-w-0 flex-col px-4 pb-7 pt-2.5">
          <div
            aria-hidden
            className="mx-auto mb-[18px] h-1 w-9 rounded bg-foreground/[0.18] md:hidden"
          />
          {q.isLoading || !p ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando…
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[linear-gradient(145deg,color-mix(in_oklab,var(--ds-data-color,#cbb87f)_16%,transparent),color-mix(in_oklab,var(--foreground)_3%,transparent))] ds-data shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_12%,transparent),inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
                    {p.hero_image_url ? (
                      <img src={p.hero_image_url} alt="" className="size-full object-cover" />
                    ) : (
                      <Home className="size-5" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="ds-eyebrow text-[10.5px] tracking-[0.2em] text-muted-foreground">
                      Imóvel
                    </p>
                    <h2 className="mt-1 truncate font-display text-[19px] font-bold leading-[1.15] tracking-[-0.01em]">
                      {p.name}
                    </h2>
                    {ownerText && (
                      <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                        <span className={`truncate text-xs ${CARD_OWNER}`}>{ownerText}</span>
                        <PhoneActionButton
                          phone={owner?.phone}
                          country={owner?.country}
                          size={13}
                          alwaysShow
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div className={`${ACTION_BAR} !h-9 !w-auto shrink-0 !rounded-[11px]`}>
                  <Link
                    to="/admin/properties/$id"
                    params={{ id: p.id }}
                    search={{ focus: "house", returnTo }}
                    aria-label="Editar imóvel"
                    title="Editar imóvel"
                    className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE} !w-10 !flex-none !px-0`}
                  >
                    <Pencil className={ACTION_ICON} />
                  </Link>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar"
                    title="Fechar"
                    className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE} !w-10 !flex-none !px-0`}
                  >
                    <ChevronDown className={ACTION_ICON} />
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <Stepper
                  current={tab}
                  onChange={(v) => {
                    setTab(v);
                    setOpenRow(null);
                  }}
                  withIcons
                  steps={[
                    { value: "publicas", label: "Públicas", icon: Globe },
                    { value: "confidenciais", label: "Confidenciais", icon: Lock },
                  ]}
                />
              </div>

              <div className="mt-4 flex items-center gap-3">
                <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">
                  <b className="font-extrabold text-foreground">
                    {done} de {measurable.length}
                  </b>{" "}
                  seções completas
                </span>
                <span className="relative h-[3px] flex-1 overflow-hidden rounded-[3px] bg-foreground/[0.08]">
                  <span
                    className="ds-ok absolute inset-y-0 left-0 rounded-[3px] bg-current"
                    style={{ width: `${pct}%` }}
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </span>
              </div>

              <div className="mt-6 grid gap-6">
                {(tab === "publicas" ? pub : conf).map((g) => (
                  <div key={g.title}>
                    <GroupTitle title={g.title} count={g.count} />
                    <GroupList>{g.rows.map(renderRow)}</GroupList>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
