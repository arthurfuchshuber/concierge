import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Home, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";

/**
 * Imóvel dentro do proprietário (layout novo — mockups "Públicas/Confidenciais").
 *
 * Regra: o que PODEMOS informar no guia é público; o que não podemos é
 * confidencial. Cada linha mostra a situação do preenchimento e abre a parte
 * correspondente do editor (`focus`), então nada do que já existia se perde.
 */

type Row = {
  key: string;
  label: string;
  hint: string;
  focus: "house" | "airbnb" | "guide" | "checkin" | "faq" | "recs";
  /** true = completo, false = pendente, null = sem como medir aqui */
  ok: boolean | null;
};

const COLS =
  "id, name, city, state, address, hero_image_url, airbnb_listing_url, airbnb_ical_url, lock_code, gate_code, pin_code, access_codes_pin, wifi_ssid, checkin_time, checkout_time, host_name, host_phone, house_rules, cleaning_price_normal_cents, cleaning_duration_normal_minutes";

function buildRows(p: Record<string, any>): { pub: Row[]; conf: Row[] } {
  const has = (v: unknown) => (typeof v === "string" ? v.trim().length > 0 : v != null);
  const pub: Row[] = [
    {
      key: "id",
      label: "Identificação e endereço",
      hint: "Nome, endereço e localização",
      focus: "house",
      ok: has(p.name) && has(p.address),
    },
    {
      key: "airbnb",
      label: "Anúncio Airbnb",
      hint: "Link e conexão do anúncio",
      focus: "airbnb",
      ok: has(p.airbnb_listing_url),
    },
    {
      key: "senhas",
      label: "Senhas de acesso",
      hint: "Fechadura, portaria e portão",
      focus: "checkin",
      ok: has(p.lock_code) || has(p.gate_code) || has(p.pin_code) || has(p.access_codes_pin),
    },
    { key: "wifi", label: "Wi-Fi", hint: "Rede e senha", focus: "house", ok: has(p.wifi_ssid) },
    {
      key: "horarios",
      label: "Chegada e saída",
      hint: "Horários e instruções",
      focus: "checkin",
      ok: has(p.checkin_time) && has(p.checkout_time),
    },
    {
      key: "faq",
      label: "FAQ e emergência",
      hint: "Perguntas e contatos",
      focus: "faq",
      ok: has(p.host_phone),
    },
    {
      key: "regras",
      label: "Regras e manual da casa",
      hint: "Regras, manual e detalhes",
      focus: "house",
      ok: has(p.house_rules),
    },
  ];
  const conf: Row[] = [
    {
      key: "fin",
      label: "Financeiro",
      hint: "Em breve — aguardando o mapeamento da conexão",
      focus: "house",
      ok: null,
    },
    {
      key: "prest",
      label: "Prestadores",
      hint: "Quem atende este imóvel",
      focus: "house",
      ok: null,
    },
    {
      key: "limp",
      label: "Limpeza: custos e duração",
      hint: "Valores e tempo por tipo de limpeza",
      focus: "house",
      ok: p.cleaning_price_normal_cents != null && p.cleaning_duration_normal_minutes != null,
    },
    {
      key: "ical",
      label: "Calendário (iCal)",
      hint: "Sincronização das reservas",
      focus: "house",
      ok: has(p.airbnb_ical_url),
    },
    {
      key: "hosp",
      label: "Dados do hóspede",
      hint: "O que coletamos na chegada",
      focus: "checkin",
      ok: null,
    },
    {
      key: "docs",
      label: "Contrato e documentos",
      hint: "Ficam na aba Documentos do proprietário",
      focus: "house",
      ok: null,
    },
  ];
  return { pub, conf };
}

function RowList({
  rows,
  propertyId,
  returnTo,
}: {
  rows: Row[];
  propertyId: string;
  returnTo: string;
}) {
  return (
    <ul className={`${PANEL_SHELL} divide-y divide-border`}>
      {rows.map((r) => {
        const soon = r.key === "fin";
        const inner = (
          <>
            <span
              aria-hidden
              className={`size-2 shrink-0 rounded-full ${r.ok === true ? "bg-emerald-500" : r.ok === false ? "bg-amber-500" : "bg-foreground/20"}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-foreground">{r.label}</span>
              <span className="block truncate ds-meta">{r.hint}</span>
            </span>
            <span
              className={`shrink-0 text-[11px] font-semibold ${r.ok === true ? "ds-ok" : r.ok === false ? "ds-atencao" : "ds-faint"}`}
            >
              {soon
                ? "Em breve"
                : r.ok === true
                  ? "Completo"
                  : r.ok === false
                    ? "Pendente"
                    : "Abrir"}
            </span>
            {!soon && (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
          </>
        );
        return (
          <li key={r.key}>
            {soon ? (
              <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 opacity-70">
                {inner}
              </div>
            ) : (
              <Link
                to="/admin/properties/$id"
                params={{ id: propertyId }}
                search={{ focus: r.focus, returnTo }}
                className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/60"
              >
                {inner}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function OwnerPropertyWindow({
  propertyId,
  onClose,
  returnTo,
}: {
  propertyId: string | null;
  onClose: () => void;
  returnTo: string;
}) {
  const q = useQuery({
    queryKey: ["owner-property-window", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select(COLS)
        .eq("id", propertyId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as Record<string, any> | null;
    },
  });
  const p = q.data;
  const { pub, conf } = p ? buildRows(p) : { pub: [], conf: [] };
  const measurable = [...pub, ...conf].filter((r) => r.ok !== null);
  const done = measurable.filter((r) => r.ok).length;
  const pct = measurable.length ? Math.round((done / measurable.length) * 100) : 0;

  return (
    <Dialog open={!!propertyId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[75dvh] w-[calc(100%-1.25rem)] max-w-[520px] flex-col gap-4 overflow-y-auto p-5">
        <DialogHeader className="space-y-0 text-left">
          <div className="flex items-center gap-3">
            <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[0.6rem] bg-secondary">
              {p?.hero_image_url ? (
                <img src={p.hero_image_url} alt="" className="size-full object-cover" />
              ) : (
                <Home className="size-5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate font-display text-[17px]">
                {p?.name ?? "Imóvel"}
              </DialogTitle>
              <DialogDescription className="truncate ds-meta">
                {[p?.city, p?.state].filter(Boolean).join(" / ") || "Sem localização"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {q.isLoading || !p ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between ds-meta">
                <span>Preenchimento</span>
                <span className="tabular-nums">{pct}%</span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            <Tabs defaultValue="publicas" className="min-w-0">
              <TabsList className="ds-segmented h-auto w-full !rounded-[0.3rem] border-0 bg-card p-0 shadow-[inset_0_0_0_1px_var(--border)]">
                <TabsTrigger
                  value="publicas"
                  className="min-h-[44px] !flex-1 !rounded-[0.3rem] text-[13px] font-semibold data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  Públicas
                </TabsTrigger>
                <TabsTrigger
                  value="confidenciais"
                  className="min-h-[44px] !flex-1 !rounded-[0.3rem] text-[13px] font-semibold data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  Confidenciais
                </TabsTrigger>
              </TabsList>
              <TabsContent value="publicas" className="mt-3 space-y-2">
                <p className="ds-meta">O que podemos informar no guia do hóspede.</p>
                <RowList rows={pub} propertyId={p.id} returnTo={returnTo} />
              </TabsContent>
              <TabsContent value="confidenciais" className="mt-3 space-y-2">
                <p className="ds-meta">Uso interno — nunca aparece no guia.</p>
                <RowList rows={conf} propertyId={p.id} returnTo={returnTo} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
