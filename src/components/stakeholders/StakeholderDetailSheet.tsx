import { PhoneActionButton } from "@/components/PhoneActionButton";
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
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { formatTaxId, formatIntlPhone, toWhatsappNumber } from "@/lib/masks";
import {
  getStakeholderDetail,
  addStakeholderNote,
  linkPropertyToOwner,
} from "@/lib/stakeholders.functions";
import { getStakeholderIntegrationFeed } from "@/lib/stakeholder-feed.functions";
import { getStakeholderSystemTrail } from "@/lib/stakeholder-trail.functions";
import { getClicksignDocumentUrl, extractClicksignPartyData } from "@/lib/clicksign.functions";
import { CopyButton } from "@/components/CopyButton";
import { getStakeholderAccess } from "@/lib/stakeholder-access.functions";
import { UserAccess } from "@/components/admin-pages/PermissionCenterPage";
import { listProviderCategories } from "@/lib/provider-categories.functions";
import { getMyClicksignConfig } from "@/lib/clicksign.functions";
import { listStakeholderOptions } from "@/lib/stakeholder-links.functions";
import { PropertyQuickEditDialog } from "@/components/admin/PropertyQuickEditDialog";
import { useRealtimeInvalidate } from "@/hooks/useRealtimeInvalidate";
import type { StakeholderKind } from "./StakeholderDirectory";
import { EmptyState } from "@/components/ds/EmptyState";
import { StakeholderStatusControl } from "./StakeholderStatusControl";
import { effectiveStatus, statusText } from "@/lib/stakeholder-status";

/** Aba do segmented control: full width, 46px, ativa com o gradiente da marca. */
const SEG_TAB =
  "min-h-[46px] !flex-none !rounded-[0.3rem] px-4 text-[13px] font-semibold data-[state=active]:bg-[linear-gradient(135deg,#7C1AD8,#E82DAE)] data-[state=active]:text-white data-[state=active]:shadow-none";

type PreviewTarget = { name: string; url?: string | null; docId?: string } | null;

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

// Mesmo formato "dd/mm/aaaa" usado no card da listagem (fmtDateBR).
function fmtDateBR(d: string | null | undefined) {
  if (!d) return "—";
  try {
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  } catch {
    return d;
  }
}




export function StakeholderDetailSheet({
  kind,
  id,
  accountOwnerId,
  onEdit,
}: {
  kind: StakeholderKind;
  id: string;
  accountOwnerId?: string | null;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const detailFn = useServerFn(getStakeholderDetail);
  const noteFn = useServerFn(addStakeholderNote);
  const linkFn = useServerFn(linkPropertyToOwner);
  const stakeholderOptionsFn = useServerFn(listStakeholderOptions);

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget>(null);
  const [extracting, setExtracting] = useState(false);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [transferPropertyId, setTransferPropertyId] = useState<string | null>(null);
  const [transferTargetId, setTransferTargetId] = useState<string>("");
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

  const extractFn = useServerFn(extractClicksignPartyData);

  async function runExtract() {
    setExtracting(true);
    try {
      const res = await extractFn({ data: { kind, id } });
      const parts: string[] = [];
      if (res.updated > 0) parts.push(`Dados extraídos do contrato: ${res.fields.join(", ")}`);
      if (res.contractStart?.status === "filled") {
        parts.push(`Início do contrato definido como ${fmtDateBR(res.contractStart.suggested)}`);
      }
      if (parts.length > 0) {
        toast.success(`${parts.join(". ")}.`);
        qc.invalidateQueries({ queryKey });
        qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
      } else if (res.contractStart?.status === "conflict") {
        toast.info(
          `O ClickSign sugere início de contrato em ${fmtDateBR(res.contractStart.suggested)}, diferente da data já cadastrada (${fmtDateBR(res.contractStart.current)}). Resolva em Configurações → Integrações → ClickSign → Atualizar Dados.`,
        );
      } else {
        toast.info("Nada novo encontrado no quadro CONTRATANTE do contrato.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler o contrato.");
    } finally {
      setExtracting(false);
    }
  }

  const queryKey = ["stakeholder-detail", accountOwnerId ?? "self", kind, id];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => detailFn({ data: { kind, id, accountOwnerId } }),
    // O refetchInterval de 20s continua como rede de segurança — o Realtime
    // abaixo já cobre o caso comum (instantâneo), isto só cobre eventos que
    // por algum motivo não chegaram pelo canal (rede instável, por exemplo).
    refetchInterval: 20_000,
  });

  // Instantâneo pra quem estiver com ESTA MESMA ficha aberta: os próprios
  // dados do proprietário mudando (outra pessoa editou) ou um imóvel sendo
  // vinculado/desvinculado/editado — sem esperar o poll de 20s.
  useRealtimeInvalidate(
    `stakeholder-live:${kind}:${id}`,
    kind === "owner"
      ? [
          { table: "property_owners", filter: `id=eq.${id}` },
          { table: "properties", filter: `owner_contact_id=eq.${id}` },
        ]
      : [{ table: "service_providers", filter: `id=eq.${id}` }],
    [queryKey],
  );

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
      await noteFn({ data: { kind, id, accountOwnerId, message: note.trim() } });
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
      await linkFn({ data: { ownerId: id, propertyId, link, accountOwnerId } });
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
      // Bidirecional: se o editor do imóvel (aba "A casa") estiver aberto em
      // outra aba, ele precisa refletir o vínculo/desvínculo imediatamente,
      // sem esperar um refresh manual.
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
      qc.invalidateQueries({ queryKey: ["my-properties"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Um imóvel sempre precisa ter um proprietário responsável — por isso não
  // existe mais "desvincular" puro. A única forma de tirar um imóvel deste
  // proprietário é transferindo para outro, na mesma ação.
  const otherOwnersQuery = useQuery({
    queryKey: ["stakeholder-options", "owner", id],
    queryFn: () => stakeholderOptionsFn(),
    enabled: !!transferPropertyId,
    select: (all) => all.filter((o) => o.type === "owner" && o.id !== id),
  });

  async function handleTransfer(propertyId: string) {
    if (!transferTargetId) return;
    setBusy(true);
    try {
      await linkFn({ data: { ownerId: transferTargetId, propertyId, link: true, accountOwnerId } });
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
      qc.invalidateQueries({ queryKey: ["my-properties"] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "stakeholder-detail" });
      setTransferPropertyId(null);
      setTransferTargetId("");
      toast.success("Imóvel transferido para o novo proprietário.");
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
  

  // Vigência do contrato exibida no cabeçalho, na cor do status (mesma regra
  // do card da listagem: cancelado/cancelando sem data final usa a data em
  // que o cancelamento foi efetivado).
  const effStatus = effectiveStatus(row.status, row.status_changed_at);
  const contractEnd =
    row.contract_end ??
    ((effStatus === "canceled" || effStatus === "canceling") && row.status_changed_at
      ? String(row.status_changed_at).slice(0, 10)
      : null);
  const contractRange = row.contract_start
    ? `${fmtDateBR(row.contract_start)} → ${contractEnd ? fmtDateBR(contractEnd) : "momento"}`
    : null;


  const timeline = [
    ...events.map((ev: any) => ({
      key: `n:${ev.id}`,
      at: ev.created_at as string,
      icon: Pin,
      title: ev.message as string,
      badge: "Registro",
      author: (ev.author_name as string | null) ?? "Sistema",
      body: null as React.ReactNode,
    })),
    ...feedEvents.map((ev) => ({
      key: `g:${ev.id}`,
      at: ev.at ?? "",
      icon: CalendarDays,
      title: ev.title,
      badge: ev.calendarName || "Agenda",
      author: "Sistema",
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
      author: "Sistema",
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
    ...(trail.data?.items ?? [])
      .filter((ev) => ev.macro)
      .map((ev) => ({
        key: `t:${ev.id}`,
        at: ev.at ?? "",
        icon: ev.severity === "error" || ev.severity === "critical" ? Unlink : MessageCircle,
        title: ev.title,
        badge: ev.badge,
        author: "Sistema",
        body:
          ev.details.length > 0 ? (
            <ul className="space-y-0.5">
              {ev.details.map((d, i) => (
                <li key={i} className="ds-meta break-words">
                  {d}
                </li>
              ))}
            </ul>
          ) : null,
      })),

  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));


  return (
    <div className="flex flex-col gap-5 px-5 py-6 sm:px-6">
      {/* ---------- Cabeçalho: fio de marca + eyebrow + nome + metadados ---------- */}
      <header className="relative pt-4">
        <span
          aria-hidden
          className="absolute left-0 right-12 top-0 h-[2px] bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE]"
        />

        {/* Linha 1: eyebrow + ações (nome ganha a largura toda) */}
        <div className="flex items-center justify-between gap-3">
          <span className="ds-eyebrow block truncate text-muted-foreground">
            {kind === "owner" ? "Proprietário" : "Prestador"}
          </span>

          {/* Ações: botões-ícone 36px, uma linha só, sem cortar na margem */}
          <div className="ds-scroll-x shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onEdit}
              aria-label="Editar cadastro"
              title="Editar cadastro"
              className="grid size-9 place-items-center rounded-[0.3rem] border border-border text-foreground hover:bg-secondary transition-colors"
            >
              <Pencil className="size-4" />
            </button>
            {clicksignActive && (
              <button
                type="button"
                onClick={runExtract}
                disabled={extracting}
                aria-label="Importar dados do contrato"
                title="Importar dados do contrato"
                className="grid size-9 place-items-center rounded-[0.3rem] border border-border text-foreground hover:bg-secondary transition-colors disabled:opacity-60"
              >
                {extracting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setDataOpen((o) => !o)}
              aria-expanded={dataOpen}
              aria-label="Dados pessoais"
              title="Dados pessoais"
              className="grid size-9 place-items-center rounded-[0.3rem] border border-border text-foreground hover:bg-secondary transition-colors"
            >
              <ChevronDown className={`size-4 transition-transform ${dataOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
        </div>

        {/* Linha 2: nome em linha única, menor */}
        <h2
          className="mt-2 truncate font-display text-[20px] font-bold leading-tight tracking-[-0.01em]"
          title={displayName}
        >
          {displayName}
        </h2>

        {/* Linha 3: metadados com separadores verticais, rolagem horizontal */}
        <div className="ds-scroll-x mt-2 gap-3 ds-meta">
          <StakeholderStatusControl
            kind={kind}
            id={id}
            accountOwnerId={accountOwnerId}
            status={row.status}
            statusChangedAt={row.status_changed_at}
            variant="compact"
            invalidateQueryKeys={[queryKey]}
          />
          <span className="h-3 w-px bg-border" aria-hidden />
          <span className="whitespace-nowrap">
            {String(row.person_type ?? "pf").toUpperCase() === "PJ"
              ? "Pessoa Jurídica"
              : "Pessoa Física"}
          </span>
          {contractRange && (
            <>
              <span className="h-3 w-px bg-border" aria-hidden />
              <span className={`whitespace-nowrap tabular-nums ${statusText(effStatus)}`}>
                {contractRange}
              </span>
            </>
          )}
        </div>

        {categoryLabels.length > 0 && (
          <p className="mt-1.5 ds-meta truncate">{categoryLabels.join(" · ")}</p>
        )}
      </header>

      {/* ---------- Dados pessoais (recolhível, fechado por padrão) ---------- */}
      {dataOpen && (
        <section className="ds-surface bg-card p-4">
          <dl className="grid gap-4 sm:grid-cols-2">
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
                      {[row.address, row.district].filter(Boolean).join(" · ")}
                      {[row.city, row.state].filter(Boolean).length > 0 && (
                        <>
                          <br />
                          {[row.city, row.state].filter(Boolean).join(" / ")}
                        </>
                      )}
                    </span>
                  </p>
                </Field>
              </div>
            )}
          </dl>
        </section>
      )}


      <Tabs defaultValue="visao">
        <TabsList className="w-full gap-0 !rounded-[0.3rem] border-0 bg-foreground/5 p-0">
          <TabsTrigger className={SEG_TAB} value="visao">Visão Geral</TabsTrigger>
          {kind === "owner" && <TabsTrigger className={SEG_TAB} value="imoveis">Imóveis</TabsTrigger>}
          <TabsTrigger className={SEG_TAB} value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger className={SEG_TAB} value="documentos">Documentos</TabsTrigger>
          <TabsTrigger className={SEG_TAB} value="acessos">Acessos</TabsTrigger>
          <TabsTrigger className={SEG_TAB} value="log">Log</TabsTrigger>

        </TabsList>



        {/* -------------------- Acessos -------------------- */}
        <TabsContent value="acessos" className="mt-5 space-y-4">
          {!stakeholderEmail ? (
            <p className="ds-surface bg-card p-5 text-sm text-muted-foreground">
              Cadastre um e-mail nesta ficha para poder liberar o acesso ao sistema.
            </p>
          ) : accessQuery.isLoading ? (
            <p className="p-5 text-sm text-muted-foreground">Carregando acessos...</p>
          ) : accessQuery.data?.status === "active" && accessQuery.data.userId ? (
            <UserAccess userId={accessQuery.data.userId} />
          ) : (
            <p className="ds-surface bg-card p-5 text-sm text-muted-foreground">
              {accessQuery.data?.status === "pending"
                ? "Convite enviado. As permissões por área ficam disponíveis assim que a pessoa aceitar o convite e entrar no sistema."
                : "Esta pessoa ainda não tem acesso ao sistema. Ative “Permitir acesso ao sistema” na edição do cadastro para enviar o convite."}
            </p>
          )}
        </TabsContent>

        {/* -------------------- Log -------------------- */}
        <TabsContent value="log" className="mt-5 space-y-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <h3 className="ds-section-title truncate">Log de atividades</h3>
            {trail.isLoading && (
              <span className="flex items-center gap-1.5 ds-meta shrink-0">
                <Loader2 className="size-3 animate-spin" /> Carregando…
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Detalhes de tudo o que a pessoa fez no sistema: páginas abertas, botões clicados e informações preenchidas.
          </p>
          {(trail.data?.items ?? []).length === 0 ? (
            <Placeholder
              icon={Pin}
              title="Sem atividades registradas"
              desc="Assim que a pessoa usar o sistema, cada passo aparece aqui."
            />
          ) : (
            <ul className="space-y-2">
              {(trail.data?.items ?? []).map((ev) => (
                <li key={ev.id} className="ds-surface bg-card px-4 py-3">
                  <p className="ds-card-title">{ev.title}</p>
                  <p className="ds-meta">{ev.badge}</p>
                  {ev.details.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {ev.details.map((d, i) => (
                        <li key={i} className="ds-meta break-words">
                          {d}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground/80">{ev.at ? fmt(ev.at) : "Sem data"}</p>
                </li>
              ))}
            </ul>
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
              <h3 className="ds-section-title truncate">Linha do Tempo</h3>
              {feed.isLoading && (
                <span className="flex items-center gap-1.5 ds-meta shrink-0">
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
                      <div className="ds-surface bg-card px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <Icon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="ds-card-title">{item.title}</p>
                            <p className="ds-meta">{item.badge}</p>
                            {item.body}
                            <p className="ds-meta opacity-80">
                              {item.at ? fmt(item.at) : "Sem data"} · {item.author}
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
                <h3 className="ds-section-title truncate">Imóveis vinculados</h3>
                <span className="ds-meta shrink-0">
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
                  {properties.map((p: any) => {
                    const status = p.published
                      ? { label: "Publicado", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" }
                      : p.guide_created
                      ? { label: "Guia em edição", cls: "border-amber-500/30 bg-amber-500/10 text-amber-500" }
                      : { label: "Sem guia", cls: "border-border text-muted-foreground" };
                    return (
                    <div
                      key={p.id}
                      className="ds-surface bg-card p-4 space-y-2"
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <p className="ds-card-title">{p.name}</p>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${status.cls}`}
                        >
                          {status.label}
                        </span>
                      </div>
                      <p className="flex items-center gap-1.5 ds-meta">
                        <MapPin className="size-3 shrink-0" />
                        {[p.city, p.state].filter(Boolean).join(" / ") || "Sem localização"}
                      </p>
                      <div className="ds-scroll-x items-center gap-1 pt-1">
                        <button
                          type="button"
                          onClick={() => setEditingPropertyId(p.id)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        >
                          <Pencil className="size-3" /> Editar
                        </button>
                        <Link
                          to="/admin/properties/$id"
                          params={{ id: p.id }}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          title="Abrir o editor completo do guia (checkin, checkout, FAQ, recomendações)"
                        >
                          <ExternalLink className="size-3" /> Guia completo
                        </Link>

                        {transferPropertyId === p.id ? (
                          <div className="flex items-center gap-1.5 w-full mt-1.5">
                            <Select value={transferTargetId} onValueChange={setTransferTargetId}>
                              <SelectTrigger className="h-8 text-xs flex-1 min-w-0">
                                <SelectValue placeholder="Transferir para..." />
                              </SelectTrigger>
                              <SelectContent>
                                {(otherOwnersQuery.data ?? []).map((o) => (
                                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                                ))}
                                {otherOwnersQuery.data?.length === 0 && (
                                  <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum outro proprietário cadastrado.</div>
                                )}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              className="h-8 shrink-0"
                              disabled={busy || !transferTargetId}
                              onClick={() => handleTransfer(p.id)}
                            >
                              Confirmar
                            </Button>
                            <button
                              type="button"
                              onClick={() => { setTransferPropertyId(null); setTransferTargetId(""); }}
                              className="text-muted-foreground hover:text-foreground shrink-0"
                              aria-label="Cancelar transferência"
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setTransferPropertyId(p.id)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                            title="Um imóvel sempre precisa de um proprietário — transfira para outro em vez de apenas desvincular."
                          >
                            <Unlink className="size-3" /> Transferir
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </section>

            {editingPropertyId && (
              <PropertyQuickEditDialog
                propertyId={editingPropertyId}
                open={!!editingPropertyId}
                onOpenChange={(o) => { if (!o) setEditingPropertyId(null); }}
              />
            )}

            {available.length > 0 && (
              <section className="ds-surface border-dashed p-5 space-y-2">
                <p className="ds-eyebrow">
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
          <div className="ds-surface bg-card overflow-hidden">
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
              <h3 className="ds-section-title truncate">Contratos e aditivos</h3>
              <span className="ds-meta shrink-0">{feedDocs.length} documento(s)</span>
            </div>
            {feed.isLoading ? (
              <p className="flex items-center gap-1.5 ds-meta">
                <Loader2 className="size-3 animate-spin" /> Buscando documentos…
              </p>
            ) : feedDocs.length === 0 ? (
              <Placeholder
                icon={Upload}
                title="Nenhum contrato vinculado"
                desc="Contratos importados do ClickSign com este CPF/CNPJ, e-mail ou nome aparecem aqui automaticamente."
              />
            ) : (
              <ul className="divide-y divide-border ds-surface bg-card">
                {feedDocs.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="ds-card-title truncate">{d.name}</p>
                      {/* Antes mostrava só uma data (finished_at OU synced_at,
                          sem rótulo) — parecia "assinado em tal data" mesmo
                          quando era só a data de IMPORTAÇÃO, com a assinatura
                          ainda pendente. É exatamente essa confusão que fazia
                          a Vigência parecer "travada" sem explicação: aqui
                          embaixo fica claro qual dos dois é. */}
                      <p className="ds-meta">
                        {d.status ?? "—"}
                        {d.finishedAt
                          ? ` · Assinatura concluída em ${fmt(d.finishedAt)}`
                          : d.syncedAt
                            ? ` · Importado em ${fmt(d.syncedAt)} (assinatura ainda não concluída)`
                            : ""}
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
        <dt className="ds-eyebrow">{label}</dt>
        {copy && <CopyButton value={copy} size={11} />}
      </div>
      <dd className={`mt-0.5 text-sm break-words ${mono ? "font-mono tabular-nums" : ""}`}>
        {children ?? value}
      </dd>
    </div>
  );
}


function WhatsAppLink({ phone, country }: { phone?: string | null; country?: string | null }) {
  return <PhoneActionButton phone={phone} country={country} size={14} showNumber />;
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
    <div className="min-w-0 ds-surface bg-card px-3 py-3 sm:px-4 sm:py-4">
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
    <div className="ds-surface bg-card px-4 py-3 min-w-0">
      <p className="ds-eyebrow">{label}</p>
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
  return <EmptyState icon={Icon} title={title} description={desc} />;
}
