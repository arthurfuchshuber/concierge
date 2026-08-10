import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Loader2,
  Mail,
  Phone,
  MapPin,
  FileText,
  Plus,
  Pencil,
  Home,
  Link2,
  Unlink,
  ExternalLink,
  CalendarDays,
  Video,
  Download,
  Pin,
  Upload,
  Eye,
  MessageCircle,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { formatTaxId, formatIntlPhone, toWhatsappNumber } from "@/lib/masks";
import {
  getStakeholderDetail,
  addStakeholderNote,
  linkPropertyToOwner,
  setStakeholderStatus,
} from "@/lib/stakeholders.functions";
import { getStakeholderIntegrationFeed } from "@/lib/stakeholder-feed.functions";
import { getStakeholderSystemTrail } from "@/lib/stakeholder-trail.functions";
import { getClicksignDocumentUrl, extractClicksignPartyData } from "@/lib/clicksign.functions";
import { CopyButton } from "@/components/CopyButton";
import { getStakeholderAccess } from "@/lib/stakeholder-access.functions";
import { UserAccess } from "@/components/admin-pages/PermissionCenterPage";
import { listProviderCategories } from "@/lib/provider-categories.functions";
import { getMyClicksignConfig } from "@/lib/clicksign.functions";
import type { StakeholderKind } from "./StakeholderDirectory";

type PreviewTarget = { name: string; url?: string | null; docId?: string } | null;

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}


type StatusValue = "active" | "paused" | "canceled";

const STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  canceled: "Cancelado",
  inactive: "Inativo",
};

const STATUS_STYLE: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  paused: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  canceled: "border-destructive/30 bg-destructive/10 text-destructive",
  inactive: "border-border text-muted-foreground",
};


export function StakeholderDetailSheet({
  kind,
  id,
  onEdit,
}: {
  kind: StakeholderKind;
  id: string;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const detailFn = useServerFn(getStakeholderDetail);
  const noteFn = useServerFn(addStakeholderNote);
  const linkFn = useServerFn(linkPropertyToOwner);

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget>(null);
  const [extracting, setExtracting] = useState(false);
  const [statusDraft, setStatusDraft] = useState<{ status: StatusValue; date: string } | null>(null);
  // Dados pessoais sempre começam recolhidos ao abrir a ficha.
  const [dataOpen, setDataOpen] = useState(false);

  const clicksignFn = useServerFn(getMyClicksignConfig);
  const clicksign = useQuery({
    queryKey: ["clicksign-config"],
    queryFn: () => clicksignFn(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const clicksignActive =
    clicksign.data?.status === "active" && Boolean(clicksign.data?.hasToken);

  const catsFn = useServerFn(listProviderCategories);
  const cats = useQuery({
    queryKey: ["provider-categories"],
    queryFn: () => catsFn(),
    staleTime: 5 * 60_000,
    enabled: kind === "provider",
  });

  const statusFn = useServerFn(setStakeholderStatus);
  const extractFn = useServerFn(extractClicksignPartyData);

  function openStatusDialog(status: StatusValue) {
    setStatusDraft({ status, date: new Date().toISOString().slice(0, 10) });
  }

  async function confirmStatus() {
    if (!statusDraft) return;
    setBusy(true);
    try {
      await statusFn({ data: { kind, id, status: statusDraft.status, changed_at: statusDraft.date } });
      setStatusDraft(null);
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
      toast.success("Situação atualizada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar a situação.");
    } finally {
      setBusy(false);
    }
  }

  async function runExtract() {
    setExtracting(true);
    try {
      const res = await extractFn({ data: { kind, id } });
      if (res.updated > 0) {
        toast.success(`Dados preenchidos a partir do contrato: ${res.fields.join(", ")}.`);
        qc.invalidateQueries({ queryKey });
        qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
      } else {
        toast.info("Nada novo encontrado no quadro CONTRATANTE do contrato.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler o contrato.");
    } finally {
      setExtracting(false);
    }
  }

  const queryKey = ["stakeholder-detail", kind, id];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => detailFn({ data: { kind, id } }),
    refetchInterval: 20_000,
  });

  const feedFn = useServerFn(getStakeholderIntegrationFeed);
  const feed = useQuery({
    queryKey: ["stakeholder-feed", kind, id],
    queryFn: () => feedFn({ data: { type: kind, id } }),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Rastro completo: tudo o que a pessoa fez dentro do sistema.
  const trailFn = useServerFn(getStakeholderSystemTrail);
  const trail = useQuery({
    queryKey: ["stakeholder-trail", kind, id],
    queryFn: () => trailFn({ data: { kind, id } }),
    refetchInterval: 60_000,
    retry: false,
  });


  const row = data?.row as Record<string, any> | null | undefined;

  const accessFn = useServerFn(getStakeholderAccess);
  const stakeholderEmail = (row?.email as string | null)?.trim().toLowerCase() ?? "";
  const accessQuery = useQuery({
    queryKey: ["stakeholder-access", stakeholderEmail],
    queryFn: () => accessFn({ data: { email: stakeholderEmail } }),
    enabled: !!stakeholderEmail,
    retry: false,
  });

  async function submitNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await noteFn({ data: { kind, id, message: note.trim() } });
      setNote("");
      qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }




  async function toggleLink(propertyId: string, link: boolean) {
    setBusy(true);
    try {
      await linkFn({ data: { ownerId: id, propertyId, link } });
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !row) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" /> Carregando ficha...
      </div>
    );
  }

  const categorySlugs: string[] =
    kind === "provider"
      ? (Array.isArray(row.categories) && row.categories.length > 0
          ? (row.categories as string[])
          : row.category
            ? [row.category as string]
            : [])
      : [];
  const categoryLabels = categorySlugs.map(
    (slug) => (cats.data ?? []).find((c) => c.slug === slug)?.label ?? slug,
  );

  const feedEvents = feed.data?.events ?? [];
  const feedDocs = feed.data?.documents ?? [];
  const events = data?.events ?? [];
  const properties = data?.properties ?? [];
  const available = data?.availableProperties ?? [];
  const displayName = row.trade_name || row.name;
  const initial = String(displayName ?? "?").trim().charAt(0).toUpperCase();

  const timeline = [
    ...events.map((ev: any) => ({
      key: `n:${ev.id}`,
      at: ev.created_at as string,
      icon: Pin,
      title: ev.message as string,
      badge: "Registro",
      body: null as React.ReactNode,
    })),
    ...feedEvents.map((ev) => ({
      key: `g:${ev.id}`,
      at: ev.at ?? "",
      icon: CalendarDays,
      title: ev.title,
      badge: ev.calendarName || "Agenda",
      body: (
        <>
          {ev.htmlLink && (
            <button
              type="button"
              onClick={() => setPreview({ name: ev.title, url: ev.htmlLink as string })}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Eye className="size-3" /> Abrir convite
            </button>
          )}
          {ev.attendees.length > 0 && (
            <p className="text-xs text-muted-foreground">{ev.attendees.length} participante(s)</p>
          )}
          {ev.attachments.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ev.attachments.map((a) => (
                <button
                  key={a.url}
                  type="button"
                  onClick={() => setPreview({ name: a.title || ev.title, url: a.url })}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {a.kind === "transcript" ? <FileText className="size-2.5" /> : <Video className="size-2.5" />}
                  {a.kind === "transcript" ? "Transcrição" : a.kind === "recording" ? "Gravação" : a.title}
                </button>
              ))}
            </div>
          )}
        </>
      ),

    })),
    ...feedDocs.map((d) => ({
      key: `d:${d.id}`,
      at: d.at ?? "",
      icon: FileText,
      title: d.name,
      badge: "ClickSign",
      body: (
        <>
          <p className="text-xs text-muted-foreground">
            {d.status ?? "—"}
            {d.signers.length > 0 ? ` · ${d.signers.length} signatário(s)` : ""}
          </p>
          <button
            type="button"
            onClick={() => setPreview({ name: d.name, docId: d.id })}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Eye className="size-3" /> Visualizar documento
          </button>
        </>
      ),
    })),
    ...(trail.data?.items ?? []).map((ev) => ({
      key: `t:${ev.id}`,
      at: ev.at ?? "",
      icon: ev.severity === "error" || ev.severity === "critical" ? Unlink : MessageCircle,
      title: ev.title,
      badge: ev.badge,
      body:
        ev.details.length > 0 ? (
          <ul className="space-y-0.5">
            {ev.details.map((d, i) => (
              <li key={i} className="text-[11px] text-muted-foreground break-words">
                {d}
              </li>
            ))}
          </ul>
        ) : null,
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));


  return (
    <div className="flex flex-col gap-5 px-5 py-6 sm:px-6">
      {/* Header card */}
      <section className="rounded-3xl border border-border bg-gradient-to-b from-card to-card/60 p-5 sm:p-6 shadow-sm">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
          <div className="grid size-16 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-2xl text-primary">
            {initial}
          </div>
          <div className="min-w-0">
            <h2
              className="font-display text-xl sm:text-2xl leading-tight truncate"
              title={displayName}
            >
              {displayName}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition hover:opacity-80 ${STATUS_STYLE[String(row.status)] ?? STATUS_STYLE.inactive}`}
                  >
                    {STATUS_LABEL[String(row.status)] ?? "Inativo"}
                    <ChevronDown className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {(["active", "paused", "canceled"] as const).map((s) => (
                    <DropdownMenuItem key={s} onSelect={() => openStatusDialog(s)}>
                      {STATUS_LABEL[s]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {row.status_changed_at && (
                <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
                  desde {new Date(row.status_changed_at).toLocaleDateString("pt-BR")}
                </span>
              )}
              <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground uppercase">
                {String(row.person_type ?? "pf")}
              </span>
              {categoryLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" className="w-full rounded-full" onClick={onEdit}>
            <Pencil className="size-3.5 mr-1.5" /> Editar
          </Button>
          {clicksignActive && (
            <Button
              variant="outline"
              className="w-full rounded-full"
              disabled={extracting}
              onClick={runExtract}
            >
              {extracting ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <FileText className="size-3.5 mr-1.5" />
              )}
              Importar Dados
            </Button>
          )}
        </div>

        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setDataOpen((o) => !o)}
            className="relative flex w-full items-center justify-center gap-2 py-1 text-center"
            aria-expanded={dataOpen}
          >
            <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Dados pessoais
            </span>
            <ChevronDown
              className={`absolute right-0 size-4 shrink-0 text-muted-foreground transition-transform ${dataOpen ? "rotate-180" : ""}`}
            />
          </button>

          {dataOpen && (
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Nome completo" value={row.name} copy={row.name} />
              {row.trade_name && (
                <Field label="Nome fantasia" value={row.trade_name} copy={row.trade_name} />
              )}
              <Field
                label="Tipo de pessoa"
                value={String(row.person_type ?? "pf").toUpperCase() === "PJ" ? "Pessoa jurídica" : "Pessoa física"}
              />
              {row.birth_date && (
                <Field
                  label="Data de nascimento"
                  value={new Date(`${String(row.birth_date).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR")}
                  copy={new Date(`${String(row.birth_date).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR")}
                />
              )}
              {categoryLabels.length > 0 && (
                <Field label="Categorias de serviço" value={categoryLabels.join(", ")} />
              )}
              {row.cep && <Field label="CEP" value={row.cep} mono copy={row.cep} />}
              {row.doc && (
                <Field
                  label={String(row.doc_type ?? "cpf").toUpperCase()}
                  value={formatTaxId(row.doc)}
                  mono
                  copy={formatTaxId(row.doc)}
                />
              )}
              {row.email && (
                <Field label="E-mail" copy={row.email}>
                  <a
                    href={`mailto:${row.email}`}
                    className="inline-flex min-w-0 items-center gap-2 text-sm hover:underline"
                  >
                    <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{row.email}</span>
                  </a>
                </Field>
              )}
              {row.phone && (
                <Field label="Telefone" copy={formatIntlPhone(row.phone, row.phone_country)}>
                  <WhatsAppLink phone={row.phone} country={row.phone_country} />
                </Field>
              )}
              {(row.address || row.city || row.state) && (
                <div className="sm:col-span-2">
                  <Field
                    label="Endereço"
                    copy={[row.address, row.district, [row.city, row.state].filter(Boolean).join(" / ")]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <p className="flex items-start gap-2 text-sm">
                      <MapPin className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 break-words">
                        {[row.address, row.district, [row.city, row.state].filter(Boolean).join(" / ")]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </p>
                  </Field>
                </div>
              )}
            </dl>
          )}
        </div>
      </section>


      <Tabs defaultValue="visao">
        <div className="rounded-2xl border border-border bg-card p-2">
          <TabsList className="w-full bg-transparent gap-1">
            <TabsTrigger value="visao">Visão Geral</TabsTrigger>
            {kind === "owner" && <TabsTrigger value="imoveis">Imóveis</TabsTrigger>}
            <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
            <TabsTrigger value="documentos">Documentos</TabsTrigger>
            <TabsTrigger value="acessos">Acessos</TabsTrigger>
          </TabsList>
        </div>


        {/* -------------------- Acessos -------------------- */}
        <TabsContent value="acessos" className="mt-5 space-y-4">
          {!stakeholderEmail ? (
            <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
              Cadastre um e-mail nesta ficha para poder liberar o acesso ao sistema.
            </p>
          ) : accessQuery.isLoading ? (
            <p className="p-5 text-sm text-muted-foreground">Carregando acessos...</p>
          ) : accessQuery.data?.status === "active" && accessQuery.data.userId ? (
            <UserAccess userId={accessQuery.data.userId} />
          ) : (
            <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
              {accessQuery.data?.status === "pending"
                ? "Convite enviado. As permissões por área ficam disponíveis assim que a pessoa aceitar o convite e entrar no sistema."
                : "Esta pessoa ainda não tem acesso ao sistema. Ative “Permitir acesso ao sistema” na edição do cadastro para enviar o convite."}
            </p>
          )}
        </TabsContent>

        {/* -------------------- Visão Geral -------------------- */}
        <TabsContent value="visao" className="mt-5 space-y-5">
          {kind === "provider" && row.hourly_rate_cents ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoCard
                label="Valor / hora"
                value={(row.hourly_rate_cents / 100).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              />
            </div>
          ) : null}





          {/* Linha do tempo */}
          <section className="space-y-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <h3 className="font-display text-xl truncate">Linha do Tempo</h3>
              {feed.isLoading && (
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
                  <Loader2 className="size-3 animate-spin" /> Sincronizando…
                </span>
              )}
            </div>





            {feed.data?.calendarError && (
              <p className="text-[11px] text-destructive">Google Agenda: {feed.data.calendarError}</p>
            )}

            {timeline.length === 0 ? (
              <Placeholder
                icon={Pin}
                title="Sem registros ainda"
                desc="Notas, convites de agenda e documentos aparecem aqui automaticamente."
              />
            ) : (
              <ol className="relative space-y-3 border-l border-border pl-6">
                {timeline.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.key} className="relative">
                      <span className="absolute -left-[29px] top-4 size-2.5 rounded-full bg-primary/70 ring-4 ring-background" />
                      <div className="rounded-2xl border border-border bg-card px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <Icon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-sm font-medium break-words">{item.title}</p>
                            <p className="text-[11px] text-muted-foreground">{item.badge}</p>
                            {item.body}
                            <p className="text-[11px] text-muted-foreground/80">
                              {item.at ? fmt(item.at) : "Sem data"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </TabsContent>

        {/* -------------------- Imóveis -------------------- */}
        {kind === "owner" && (
          <TabsContent value="imoveis" className="mt-5 space-y-5">
            <section className="space-y-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <h3 className="font-display text-xl truncate">Imóveis vinculados</h3>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {properties.length} residência(s)
                </span>
              </div>

              {properties.length === 0 ? (
                <Placeholder
                  icon={Home}
                  title="Nenhuma residência vinculada"
                  desc="Vincule uma residência existente abaixo ou crie uma nova para este proprietário."
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {properties.map((p: any) => (
                    <div
                      key={p.id}
                      className="rounded-2xl border border-border bg-card p-4 space-y-2"
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <p className="text-sm font-medium break-words">{p.name}</p>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
                            p.published
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {p.published ? "Publicado" : "Rascunho"}
                        </span>
                      </div>
                      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <MapPin className="size-3 shrink-0" />
                        {[p.city, p.state].filter(Boolean).join(" / ") || "Sem localização"}
                      </p>
                      <div className="flex items-center gap-1 pt-1">
                        <Link
                          to="/admin/properties/$id"
                          params={{ id: p.id }}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        >
                          <ExternalLink className="size-3" /> Abrir
                        </Link>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => toggleLink(p.id, false)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Unlink className="size-3" /> Desvincular
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {available.length > 0 && (
              <section className="rounded-2xl border border-dashed border-border p-5 space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Vincular residência existente
                </p>
                {available.map((p: any) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleLink(p.id, true)}
                    className="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary transition-colors"
                  >
                    <span className="truncate">{p.name}</span>
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </section>
            )}

            <Link
              to="/admin/properties/$id"
              params={{ id: "new" }}
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <Plus className="size-3.5" /> Criar nova residência
            </Link>
          </TabsContent>
        )}



        {/* -------------------- Financeiro -------------------- */}
        <TabsContent value="financeiro" className="mt-5 space-y-4">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <MoneyCard label="A receber" value={0} tone="emerald" />
            <MoneyCard label="Recebido" value={0} tone="primary" />
            <MoneyCard label="A pagar" value={0} tone="amber" />
          </div>
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="grid grid-cols-4 gap-3 border-b border-border px-4 py-3 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Tipo</span>
              <span>Descrição</span>
              <span>Vencimento</span>
              <span className="text-right">Valor</span>
            </div>
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nenhum lançamento financeiro para este cadastro.
            </p>
          </div>
        </TabsContent>

        {/* -------------------- Documentos -------------------- */}
        <TabsContent value="documentos" className="mt-5 space-y-6">
          <section className="space-y-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <h3 className="font-display text-xl truncate">Contratos e aditivos</h3>
              <span className="text-[11px] text-muted-foreground shrink-0">{feedDocs.length} documento(s)</span>
            </div>
            {feed.isLoading ? (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Buscando documentos…
              </p>
            ) : feedDocs.length === 0 ? (
              <Placeholder
                icon={Upload}
                title="Nenhum contrato vinculado"
                desc="Contratos importados do ClickSign com este CPF/CNPJ, e-mail ou nome aparecem aqui automaticamente."
              />
            ) : (
              <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                {feedDocs.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{d.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {d.status ?? "—"}
                        {d.at ? ` · ${fmt(d.at)}` : ""}
                        {d.signers.length > 0 ? ` · ${d.signers.length} signatários` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPreview({ name: d.name, docId: d.id })}
                        className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        title="Visualizar"
                      >
                        <Eye className="size-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

            )}
          </section>
        </TabsContent>
      </Tabs>

      <DocPreviewDialog doc={preview} onClose={() => setPreview(null)} />

      <Dialog open={!!statusDraft} onOpenChange={(o) => !o && setStatusDraft(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Marcar como {statusDraft ? STATUS_LABEL[statusDraft.status] : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="status-date">Data da alteração</Label>
            <Input
              id="status-date"
              type="date"
              value={statusDraft?.date ?? ""}
              onChange={(e) =>
                setStatusDraft((d) => (d ? { ...d, date: e.target.value } : d))
              }
            />
            <p className="text-xs text-muted-foreground">
              Pode ser uma data futura, se a mudança ainda vai acontecer.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setStatusDraft(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmStatus} disabled={busy || !statusDraft?.date}>
              {busy && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocPreviewDialog({
  doc,
  onClose,
}: {
  doc: PreviewTarget;
  onClose: () => void;
}) {
  const urlFn = useServerFn(getClicksignDocumentUrl);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["clicksign-doc-url", doc?.docId],
    queryFn: () => urlFn({ data: { id: doc!.docId! } }),
    enabled: !!doc?.docId,
    staleTime: 60_000,
  });
  const url = doc?.docId ? data?.url ?? null : doc?.url ?? null;

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base truncate pr-8">{doc?.name}</DialogTitle>
        </DialogHeader>
        {doc && (
          <>
            {isLoading ? (
              <div className="flex h-[70vh] items-center justify-center gap-2 border-t border-border bg-muted text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Gerando link seguro…
              </div>
            ) : url ? (
              <iframe
                src={url}
                title={doc.name}
                className="h-[70vh] w-full border-t border-border bg-muted"
              />
            ) : (
              <div className="flex h-[40vh] items-center justify-center border-t border-border bg-muted px-6 text-center text-sm text-muted-foreground">
                {isError
                  ? "Não foi possível gerar o link do documento."
                  : "Documento sem arquivo disponível."}
              </div>
            )}
            {url && (
              <div className="flex justify-end gap-2 px-5 py-3">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="size-3.5" /> Abrir em nova aba
                </a>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}


function Field({
  label,
  value,
  mono,
  copy,
  children,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  copy?: string | null;
  children?: React.ReactNode;
}) {
  if (!children && !value) return null;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
        {copy && <CopyButton value={copy} size={11} />}
      </div>
      <dd className={`mt-0.5 text-sm break-words ${mono ? "font-mono tabular-nums" : ""}`}>
        {children ?? value}
      </dd>
    </div>
  );
}


function WhatsAppLink({ phone, country }: { phone?: string | null; country?: string | null }) {
  if (!phone) return null;
  const waNumber = toWhatsappNumber(phone, country);
  if (!waNumber) return null;
  return (
    <a
      href={`https://wa.me/${waNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 text-[11px] font-medium tabular-nums text-emerald-700 dark:text-emerald-400 transition"
    >
      <MessageCircle className="size-3" />
      {formatIntlPhone(phone, country)}
    </a>
  );
}


function MoneyCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "primary" | "amber";
}) {
  const toneCls =
    tone === "emerald" ? "text-emerald-500" : tone === "amber" ? "text-amber-500" : "text-primary";
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card px-3 py-3 sm:px-4 sm:py-4">
      <p className={`text-[10px] uppercase tracking-wide truncate ${toneCls}`}>{label}</p>
      <p className="font-display text-base sm:text-xl tabular-nums mt-1 tracking-tight break-all">
        {(value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </p>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm mt-0.5 break-words">{value}</p>
    </div>
  );
}

function Placeholder({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof Home;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center">
      <Icon className="size-5 mx-auto text-muted-foreground" />
      <p className="text-sm mt-3">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{desc}</p>
    </div>
  );
}
