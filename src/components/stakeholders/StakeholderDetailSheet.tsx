import { PhoneActionButton } from "@/components/PhoneActionButton";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useRouterState } from "@tanstack/react-router";
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
import { getClicksignDocumentFile, extractClicksignPartyData } from "@/lib/clicksign.functions";
import { CopyButton } from "@/components/CopyButton";
import { getStakeholderAccess } from "@/lib/stakeholder-access.functions";
import { UserAccess } from "@/components/admin-pages/PermissionCenterPage";
import { listProviderCategories } from "@/lib/provider-categories.functions";
import { getMyClicksignConfig } from "@/lib/clicksign.functions";
import { listStakeholderOptions } from "@/lib/stakeholder-links.functions";
import { useRealtimeInvalidate } from "@/hooks/useRealtimeInvalidate";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { StakeholderKind } from "./StakeholderDirectory";
import { EmptyState } from "@/components/ds/EmptyState";
import { StakeholderStatusControl } from "./StakeholderStatusControl";
import { effectiveStatus, statusText } from "@/lib/stakeholder-status";

/** Aba do segmented control: adapta-se à largura da tela (anti-corte), 46px. */
const SEG_TAB =
  "min-h-[46px] !rounded-[0.3rem] text-[13px] font-semibold data-[state=active]:bg-[linear-gradient(135deg,#7C1AD8,#E82DAE)] data-[state=active]:text-white data-[state=active]:shadow-none";

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
  const [transferPropertyId, setTransferPropertyId] = useState<string | null>(null);
  // Pra onde "Voltar"/"Fechar" leva ao editar a casa de um imóvel a partir
  // daqui — como o editor de imóvel é uma página própria (não um popup),
  // sem isso a pessoa perderia esta ficha do proprietário aberta.
  const returnToHere = useRouterState({ select: (s) => s.location.href });
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
      if ("notice" in res && res.notice) {
        toast.info(res.notice as string);
        return;
      }
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


  // Notas automáticas de bastidor (importação/sincronização/extração) não
  // entram na Linha do Tempo — elas continuam disponíveis no Log.
  const NOISE = /(importa[çc][ãa]o do clicksign|dados extra[íi]dos|sincroniza|cadastro criado pela)/i;

  // Abre o link do Google já na conta conectada à integração (authuser),
  // evitando cair na conta pessoal logada no navegador.
  const gAccount = (feed.data as { accountEmail?: string | null } | undefined)?.accountEmail ?? null;
  function gLink(url: string) {
    if (!gAccount) return url;
    try {
      const u = new URL(url);
      if (!/(^|\.)google\.com$/.test(u.hostname)) return url;
      u.searchParams.set("authuser", gAccount);
      return u.toString();
    } catch {
      return url;
    }
  }

  const timeline = [
    ...events
      .filter((ev: any) => !NOISE.test(String(ev.message ?? "")))
      .map((ev: any) => ({
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
              onClick={() => window.open(gLink(ev.htmlLink as string), "_blank", "noopener")}
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
                  onClick={() => window.open(gLink(a.url), "_blank", "noopener")}
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
    <div className="flex w-full min-w-0 max-w-full flex-col gap-5 overflow-x-hidden px-5 py-6 sm:px-6">
      {/* ---------- Cabeçalho: fio de marca + eyebrow + nome + metadados ---------- */}
      <header className="relative pt-4">
        <span
          aria-hidden
          className="absolute left-0 right-12 top-0 h-[2px] bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE]"
        />

        {/* Linha 1: eyebrow (as ações desceram para a linha de metadados) */}
        <span className="ds-eyebrow block truncate text-muted-foreground">
          {kind === "owner" ? "Proprietário" : "Prestador"}
        </span>

        {/* Linha 2: nome em linha única, espaçamento padrão das demais páginas */}
        <h2
          className="mt-1 truncate font-display text-[20px] font-bold leading-tight tracking-[-0.01em]"
          title={displayName}
        >
          {displayName}
        </h2>

        {/* Linha 3: metadados à esquerda, ações à direita (espaço antes vazio) */}
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="ds-scroll-x gap-3 ds-meta">
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
            </div>

            {contractRange && (
              <p className={`mt-1.5 whitespace-nowrap tabular-nums text-sm ${statusText(effStatus)}`}>
                {contractRange}
              </p>
            )}

            {categoryLabels.length > 0 && (
              <p className="mt-1.5 ds-meta truncate">{categoryLabels.join(" · ")}</p>
            )}
          </div>

          {/* Ações: importar dados vem antes de editar (ordem invertida) */}
          <div className="ds-scroll-x shrink-0 items-center gap-1.5">
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
              onClick={onEdit}
              aria-label="Editar cadastro"
              title="Editar cadastro"
              className="grid size-9 place-items-center rounded-[0.3rem] border border-border text-foreground hover:bg-secondary transition-colors"
            >
              <Pencil className="size-4" />
            </button>
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


      <Tabs defaultValue="visao" className="min-w-0 max-w-full">
        <TabsList className="ds-segmented h-auto w-full max-w-full !rounded-[0.3rem] border-0 bg-foreground/5 p-0">

          <TabsTrigger className={SEG_TAB} value="visao">Timeline</TabsTrigger>
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
                  <p className="text-[13.5px] leading-[1.3] font-normal text-foreground">{ev.title}</p>
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
                            <p className="text-[13.5px] leading-[1.3] font-normal text-foreground">{item.title}</p>
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
          <TabsContent value="imoveis" className="mt-5 space-y-4">
            {/* Portfólio em linhas densas: título + situação do guia na mesma
                linha, localização abaixo e ações discretas em texto. */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div className="min-w-0">
                <h3 className="ds-section-title truncate">Imóveis vinculados</h3>
                <p className="ds-meta">{properties.length} residência(s)</p>
              </div>
              {available.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[0.3rem] border border-border bg-secondary/40 px-3 text-[13px] font-medium transition-colors hover:bg-secondary"
                    >
                      <Plus className="size-4 text-primary" /> Vincular
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
                    {available.map((p: any) => (
                      <DropdownMenuItem
                        key={p.id}
                        disabled={busy}
                        onClick={() => toggleLink(p.id, true)}
                        className="gap-2"
                      >
                        <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{p.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {properties.length === 0 ? (
              <Placeholder
                icon={Home}
                title="Nenhuma residência vinculada"
                desc="Vincule uma residência existente acima ou crie uma nova para este proprietário."
              />
            ) : (
              <div className="space-y-2">
                {properties.map((p: any) => {
                  const status = p.published
                    ? { label: "Publicado", cls: "border-emerald-500/25 bg-emerald-500/10 text-emerald-500" }
                    : p.guide_created
                      ? { label: "Pendente", cls: "border-amber-500/25 bg-amber-500/10 text-amber-500" }
                      : { label: "Sem guia", cls: "border-border text-muted-foreground" };
                  return (
                    <div
                      key={p.id}
                      className="ds-surface bg-card p-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="ds-card-title min-w-0 break-words">{p.name}</p>
                          <span
                            className={`shrink-0 rounded-[0.2rem] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${status.cls}`}
                          >
                            {status.label}
                          </span>
                        </div>
                        <p className="mt-1 flex items-center gap-1.5 ds-meta">
                          <MapPin className="size-3.5 shrink-0" />
                          {[p.city, p.state].filter(Boolean).join(" / ") || "Sem localização"}
                        </p>

                        {transferPropertyId === p.id ? (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <Select value={transferTargetId} onValueChange={setTransferTargetId}>
                              <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
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
                              className="shrink-0 text-muted-foreground hover:text-foreground"
                              aria-label="Cancelar transferência"
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                            <Link
                              to="/admin/properties/$id"
                              params={{ id: p.id }}
                              search={{ houseOnly: true, returnTo: returnToHere }}
                              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-tight text-muted-foreground transition-colors hover:text-foreground"
                              title='Mesma tela da aba "A casa" do editor completo, sem as demais abas.'
                            >
                              <Pencil className="size-3.5" /> Editar
                            </Link>
                            <Link
                              to="/admin/properties/$id"
                              params={{ id: p.id }}
                              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-tight text-muted-foreground transition-colors hover:text-foreground"
                              title="Abrir o editor completo do guia (checkin, checkout, FAQ, recomendações)"
                            >
                              <FileText className="size-3.5" /> Guia
                            </Link>
                          </div>
                        )}
                      </div>

                      {transferPropertyId !== p.id && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setTransferPropertyId(p.id)}
                          className="grid size-8 shrink-0 place-items-center rounded-[0.3rem] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          title="Um imóvel sempre precisa de um proprietário — transfira para outro em vez de apenas desvincular."
                          aria-label="Transferir imóvel"
                        >
                          <Unlink className="size-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <Link
              to="/admin/properties/$id"
              params={{ id: "new" }}
              search={{ returnTo: returnToHere }}
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
                      <p className="text-[13.5px] leading-[1.3] font-normal text-foreground truncate">{d.name}</p>
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
  const fileFn = useServerFn(getClicksignDocumentFile);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["clicksign-doc-file", doc?.docId],
    queryFn: () => fileFn({ data: { id: doc!.docId! } }),
    enabled: !!doc?.docId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const externalUrl = doc?.docId ? null : doc?.url ?? null;

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
            ) : data?.base64 ? (
              <PdfPages base64={data.base64} />
            ) : externalUrl ? (
              <iframe
                src={externalUrl}
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
            {externalUrl && (
              <div className="flex justify-end gap-2 px-5 py-3">
                <a
                  href={externalUrl}
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

function PdfPages({ base64 }: { base64: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    async function renderPdf() {
      try {
        setError(false);
        setPages([]);
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        const rendered: string[] = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(2, 1100 / baseViewport.width);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas indisponível");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
          if (!blob) throw new Error("Falha ao renderizar página");
          const objectUrl = URL.createObjectURL(blob);
          objectUrls.push(objectUrl);
          rendered.push(objectUrl);
          if (!cancelled) setPages([...rendered]);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void renderPdf();
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [base64]);

  if (error) {
    return (
      <div className="flex h-[40vh] items-center justify-center border-t border-border bg-muted px-6 text-center text-sm text-muted-foreground">
        Não foi possível renderizar este documento.
      </div>
    );
  }

  return (
    <div className="h-[70vh] overflow-y-auto border-t border-border bg-muted p-2 sm:p-4">
      {pages.length === 0 && (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Preparando documento…
        </div>
      )}
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {pages.map((page, index) => (
          <img
            key={page}
            src={page}
            alt={`Página ${index + 1}`}
            className="h-auto w-full bg-background shadow-sm"
          />
        ))}
      </div>
    </div>
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
