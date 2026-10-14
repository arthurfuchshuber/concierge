import { PhoneActionButton } from "@/components/PhoneActionButton";
import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Loader2,
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { formatTaxId, formatIntlPhone, toWhatsappNumber } from "@/lib/masks";
import {
  getStakeholderDetail,
  addStakeholderNote,
  linkPropertyToOwner,
  linkPropertyToProvider,
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
import { periodShort } from "@/lib/period-short";
import { OwnerFinancePanel } from "./OwnerFinancePanel";
import {
  deleteOwnerLooseDoc,
  getOwnerLooseDocFile,
  listOwnerLooseDocs,
  uploadOwnerLooseDoc,
} from "@/lib/owner-finance.functions";
import { OwnerPropertiesPanel } from "./OwnerPropertiesPanel";
import { SearchActionRow } from "@/components/dashboard/SearchActionRow";
import { SortMenu } from "@/components/dashboard/SortMenu";
import { humanizeEventMessage } from "@/lib/stakeholder-event-message";
import { describeRecord } from "@/lib/owner-timeline-record";
import { MultiLinkPicker } from "./MultiLinkPicker";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import { OwnerPropertyWindow } from "./OwnerPropertyWindow";
import { OwnerAccessList } from "./OwnerAccessList";
import { Stepper } from "@/components/editor/Stepper";
import {
  ACTION_BAR,
  ACTION_SEGMENT,
  ACTION_BUTTON_TONE,
  ACTION_ICON,
  PanelHeading,
  CountPill,
} from "@/components/dashboard/panel-chrome";
import {
  AddPill,
  GroupTitle,
  GroupList,
  GroupRow,
  StatusTrail,
  StatsStrip,
  OwnerEmpty,
  CHIP_BTN,
} from "./owner-ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CARD_OWNER, ownerLabel } from "@/components/dashboard/card-colors";
import {
  Coins,
  StickyNote,
  Check,
  User,
  Activity,
  Filter,
  Trash2,
  ArrowLeft,
  MoreVertical,
} from "lucide-react";

/** Aba do segmented control: adapta-se à largura da tela (anti-corte), 46px.
 *  !flex-none sobrescreve o !flex-1 padrão de TabsTrigger (ui/tabs.tsx) — aqui
 *  cada aba precisa manter a largura do próprio rótulo (min-w-max) e deixar o
 *  ds-segmented rolar na horizontal quando não couberem todas, em vez de
 *  espremer/cortar "Acessos" tentando dividir a largura em partes iguais. */
const SEG_TAB =
  "min-h-[46px] !flex-none !rounded-[0.3rem] text-[13px] font-semibold data-[state=active]:bg-[linear-gradient(135deg,#7C1AD8,#E82DAE)] data-[state=active]:text-white data-[state=active]:shadow-none";

/** Abas do layout novo (mockup aprovado): sem rosa, aba ativa neutra com fio de marca. */
const SEG_TAB_NEW =
  "min-h-[46px] !flex-none !rounded-[0.3rem] text-[13px] font-semibold data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground data-[state=active]:shadow-none";

const MONTHS_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** Agrupa itens (já ordenados do mais novo ao mais antigo) por mês ("outubro de 2026") ou dia. */
function groupByPeriod<T extends { at: string }>(items: T[], by: "month" | "day") {
  const groups: { label: string; items: T[] }[] = [];
  for (const it of items) {
    const d = it.at ? new Date(it.at) : null;
    const ok = d && !Number.isNaN(d.getTime());
    const label = !ok
      ? "Sem data"
      : by === "month"
        ? `${MONTHS_PT[d!.getMonth()]} de ${d!.getFullYear()}`
        : d!.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }
  return groups;
}

function GroupLabel({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="ds-eyebrow capitalize text-muted-foreground">{children}</span>
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span className="ds-meta tabular-nums">{count}</span>
    </div>
  );
}

type PreviewTarget = { name: string; url?: string | null; docId?: string; looseId?: string } | null;

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

const MONTHS_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
function shortDate(iso: string, withTime = false) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "Sem data";
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return withTime
    ? `${base}, ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    : base;
}
/** "2 set · 14:32" (mockup da timeline). */
function shortDateTime(iso: string) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "Sem data";
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}
/** Reais sem centavos, sempre arredondados para cima (pedido 13/10/2026). */
function brlCeil(v: number) {
  return Math.ceil(v).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}
function capitalize(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
/** Selo de situação do imóvel (mockup `.pl`). */
function PropPill({ tone, children }: { tone: "ok" | "at" | "nu"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "ds-ok bg-[color-mix(in_oklab,currentColor_8%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_25%,transparent)]"
      : tone === "at"
        ? "ds-atencao bg-[color-mix(in_oklab,currentColor_8%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)]"
        : "text-muted-foreground bg-foreground/[0.05] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent)]";
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10px] font-extrabold ${cls}`}
    >
      {children}
    </span>
  );
}
function logIcon(title: string) {
  const t = title.toLowerCase();
  if (/abriu|visualiz|ver /.test(t)) return Eye;
  if (/renome|edit|alter|atualiz|salv|defin/.test(t)) return Pencil;
  if (/entrou|login|acess/.test(t)) return User;
  if (/aceit|conclu|cri(ou|ad)/.test(t)) return Check;
  return Activity;
}

export function StakeholderDetailSheet({
  kind,
  id,
  accountOwnerId,
  newLayout = false,
  onEdit,
  onClose,
}: {
  kind: StakeholderKind;
  id: string;
  accountOwnerId?: string | null;
  /** Layout novo (aprovado nos mockups) — liberado só para contas habilitadas. */
  newLayout?: boolean;
  onEdit: () => void;
  /** Fecha a ficha (botão "Voltar" da ficha em tela cheia do proprietário). */
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const detailFn = useServerFn(getStakeholderDetail);
  const noteFn = useServerFn(addStakeholderNote);
  const linkFn = useServerFn(linkPropertyToOwner);
  const linkProviderFn = useServerFn(linkPropertyToProvider);
  const stakeholderOptionsFn = useServerFn(listStakeholderOptions);

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  const [extracting, setExtracting] = useState(false);
  const [transferPropertyId, setTransferPropertyId] = useState<string | null>(null);
  // Pra onde "Voltar"/"Fechar" leva ao editar a casa de um imóvel a partir
  // daqui — como o editor de imóvel é uma página própria (não um popup),
  // sem isso a pessoa perderia esta ficha do proprietário aberta.
  const returnToHere = useRouterState({ select: (s) => s.location.href });
  const [transferTargetId, setTransferTargetId] = useState<string>("");
  // Dados pessoais sempre começam recolhidos ao abrir a ficha.
  const [dataOpen, setDataOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [windowPropertyId, setWindowPropertyId] = useState<string | null>(null);
  const [ownerTab, setOwnerTab] = useState("timeline");
  // Busca/filtros de cada aba do layout novo (mockups P1–P4): ficam por aba.
  const [tlQ, setTlQ] = useState("");
  const [tlTypes, setTlTypes] = useState<string[]>([]);
  const [finQ, setFinQ] = useState("");
  const [docQ, setDocQ] = useState("");
  const [docSit, setDocSit] = useState<string[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const docFileFn = useServerFn(getClicksignDocumentFile);
  const looseListFn = useServerFn(listOwnerLooseDocs);
  const looseUploadFn = useServerFn(uploadOwnerLooseDoc);
  const looseFileFn = useServerFn(getOwnerLooseDocFile);
  const looseDeleteFn = useServerFn(deleteOwnerLooseDoc);
  const looseInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLoose, setUploadingLoose] = useState(false);
  const looseKey = ["owner-loose-docs", accountOwnerId ?? "self", id];
  const looseQuery = useQuery({
    queryKey: looseKey,
    queryFn: () => looseListFn({ data: { ownerId: id, accountOwnerId } }),
    enabled: newLayout && kind === "owner",
  });
  const looseDocs = looseQuery.data?.docs ?? [];

  const clicksignFn = useServerFn(getMyClicksignConfig);
  const clicksign = useQuery({
    queryKey: ["clicksign-config"],
    queryFn: () => clicksignFn(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const clicksignActive = clicksign.data?.status === "active" && Boolean(clicksign.data?.hasToken);

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
      : [
          { table: "service_providers", filter: `id=eq.${id}` },
          { table: "property_providers", filter: `provider_id=eq.${id}` },
        ],
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
      if (kind === "provider") {
        await linkProviderFn({ data: { providerId: id, propertyId, link, accountOwnerId } });
      } else {
        await linkFn({ data: { ownerId: id, propertyId, link, accountOwnerId } });
      }
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

  // Vínculo em lote: o usuário marca várias residências no seletor e todas
  // são vinculadas numa ação só (antes era uma por vez, no menu suspenso).
  async function linkMany(propertyIds: string[]) {
    if (propertyIds.length === 0) return;
    setBusy(true);
    try {
      for (const propertyId of propertyIds) {
        if (kind === "provider") {
          await linkProviderFn({
            data: { providerId: id, propertyId, link: true, accountOwnerId },
          });
        } else {
          await linkFn({ data: { ownerId: id, propertyId, link: true, accountOwnerId } });
        }
        qc.invalidateQueries({ queryKey: ["property", propertyId] });
      }
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
      qc.invalidateQueries({ queryKey: ["my-properties"] });
      toast.success(
        propertyIds.length === 1
          ? "Residência vinculada."
          : `${propertyIds.length} residências vinculadas.`,
      );
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
    enabled: !!transferPropertyId || (newLayout && ownerTab === "imoveis"),
    select: (all) => all.filter((o) => o.type === "owner" && o.id !== id),
  });

  // Baixa o PDF do contrato (mesma fonte da pré-visualização: arquivo seguro do ClickSign).
  async function downloadDoc(docId: string, name: string, loose = false) {
    setDownloadingId(docId);
    try {
      const res = loose
        ? await looseFileFn({ data: { id: docId } })
        : await docFileFn({ data: { id: docId } });
      if (!res?.base64) throw new Error("Documento sem arquivo disponível.");
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = /\.pdf$/i.test(name) ? name : `${name}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível baixar o documento.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function uploadLoose(file: File | undefined) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      toast.error("Escolha um arquivo PDF.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error("O PDF precisa ter até 15 MB.");
      return;
    }
    setUploadingLoose(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      await looseUploadFn({
        data: { ownerId: id, accountOwnerId, name: file.name, base64: btoa(bin) },
      });
      await qc.invalidateQueries({ queryKey: looseKey });
      toast.success("PDF anexado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível anexar o PDF.");
    } finally {
      setUploadingLoose(false);
      if (looseInputRef.current) looseInputRef.current.value = "";
    }
  }
  async function removeLoose(docId: string) {
    try {
      await looseDeleteFn({ data: { id: docId } });
      await qc.invalidateQueries({ queryKey: looseKey });
      toast.success("Documento removido.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível remover.");
    }
  }

  async function handleTransfer(propertyId: string, target: string = transferTargetId) {
    if (!target) return;
    setBusy(true);
    try {
      await linkFn({ data: { ownerId: target, propertyId, link: true, accountOwnerId } });
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
      ? Array.isArray(row.categories) && row.categories.length > 0
        ? (row.categories as string[])
        : row.category
          ? [row.category as string]
          : []
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
  // % do contrato já decorrido (sem data final, ou já encerrado = 100%).
  const vigenciaPct = (() => {
    if (!row.contract_start || !contractEnd) return 100;
    const t0 = new Date(`${row.contract_start}T00:00:00`).getTime();
    const t1 = new Date(`${contractEnd}T00:00:00`).getTime();
    if (!(t1 > t0)) return 100;
    return Math.max(2, Math.min(100, Math.round(((Date.now() - t0) / (t1 - t0)) * 100)));
  })();
  const contractRange = row.contract_start
    ? `${fmtDateBR(row.contract_start)} → ${contractEnd ? fmtDateBR(contractEnd) : "momento"}`
    : null;

  // Notas automáticas de bastidor (importação/sincronização/extração) não
  // entram na Linha do Tempo — elas continuam disponíveis no Log.
  const NOISE =
    /(importa[çc][ãa]o do clicksign|dados extra[íi]dos|sincroniza|cadastro criado pela)/i;

  // Abre o link do Google já na conta conectada à integração (authuser),
  // evitando cair na conta pessoal logada no navegador.
  const gAccount =
    (feed.data as { accountEmail?: string | null } | undefined)?.accountEmail ?? null;
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
      .map((ev: any) => {
        const rec = describeRecord(humanizeEventMessage(ev.message as string));
        return {
          key: `n:${ev.id}`,
          at: ev.created_at as string,
          icon: /resid[êe]ncia|im[óo]vel/i.test(rec.title)
            ? Home
            : rec.kind === "create"
              ? User
              : /contrato/i.test(rec.title)
                ? FileText
                : Pin,
          title: rec.title,
          badge: "Registro",
          author: (ev.author_name as string | null) ?? "Sistema",
          lines: rec.lines,
          body: null as React.ReactNode,
        };
      }),
    ...feedEvents.map((ev) => ({
      key: `g:${ev.id}`,
      at: ev.at ?? "",
      icon: CalendarDays,
      title: ev.title,
      badge: ev.calendarName || "Agenda",
      author: "Sistema",
      lines: [
        { k: "Agenda", v: ev.calendarName || "Agenda" },
        ...(ev.attendees.length > 0
          ? [{ k: "Participantes", v: String(ev.attendees.length) }]
          : []),
      ],
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
          {ev.attachments.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {ev.attachments.map((a) => (
                <button
                  key={a.url}
                  type="button"
                  onClick={() => window.open(gLink(a.url), "_blank", "noopener")}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {a.kind === "transcript" ? (
                    <FileText className="size-2.5" />
                  ) : (
                    <Video className="size-2.5" />
                  )}
                  {a.kind === "transcript"
                    ? "Transcrição"
                    : a.kind === "recording"
                      ? "Gravação"
                      : a.title}
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
      lines: [
        { k: "Status", v: d.status ?? "—" },
        ...(d.signers.length > 0 ? [{ k: "Signatários", v: String(d.signers.length) }] : []),
      ],
      body: (
        <>
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
        // Cada detalhe é UMA informação completa numa linha própria (pedido 13/10/2026).
        lines: ev.details.map((d) => ({ k: "", v: d })),
        body: null as React.ReactNode,
      })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  // ======================= LAYOUT NOVO DO PROPRIETÁRIO =======================
  // Mockups Prop2 a Prop10 (13/10/2026). Só contas liberadas (`newLayout`).
  if (newLayout && kind === "owner") {
    const ownerPhone = row.phone as string | null;
    const ownerCountry = row.phone_country as string | null;
    const accessReady = accessQuery.data?.status === "active" && accessQuery.data.userId;
    const timelineGroups = groupByPeriod(timeline, "month");
    const todayKey = new Date().toDateString();
    const logItems = (trail.data?.items ?? []).map((ev) => ({ ...ev, at: ev.at ?? "" }));
    const logGroups = (() => {
      const groups: { label: string; items: typeof logItems }[] = [];
      for (const it of logItems) {
        const d = it.at ? new Date(it.at) : null;
        const ok = d && !Number.isNaN(d.getTime());
        const label = !ok
          ? "Sem data"
          : d!.toDateString() === todayKey
            ? "Hoje"
            : d!.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.items.push(it);
        else groups.push({ label, items: [it] });
      }
      return groups;
    })();

    // Botão único (padrão dos botões de filtro) com as ações da ficha.
    const ownerMenu = (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Ações do proprietário"
            title="Ações do proprietário"
            disabled={extracting}
            className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
          >
            {extracting ? (
              <Loader2 className={`${ACTION_ICON} animate-spin`} />
            ) : (
              <MoreVertical className={ACTION_ICON} />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDataOpen(true)}>
            <User className="size-3.5" /> Ver Proprietário
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="size-3.5" /> Editar cadastro
          </DropdownMenuItem>
          {clicksignActive && (
            <DropdownMenuItem onSelect={runExtract}>
              <FileText className="size-3.5" /> Importar dados do contrato
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );

    return (
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col overflow-x-hidden px-4 pb-7 pt-[21px]">
        {/* Voltar: o mesmo botão das janelas do Dashboard e das páginas de Guias Digitais.
            A ficha ocupa a tela inteira, então o X do painel fica oculto. */}
        <button
          type="button"
          onClick={onClose}
          className="mb-5 inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Voltar
        </button>

        {/* Cabeçalho: rótulo, nome (1 linha, reticências) com o botão de contato colado e UMA
            linha com situação + vigência. Ações (Ver/Editar) ficam no botão da barra de busca. */}
        <div className="grid gap-2">
          <p className="ds-eyebrow text-[10.5px] leading-[22px] tracking-[0.2em] text-[color:var(--faint)]">
            Proprietário
          </p>
          <div className="flex min-w-0 items-center gap-1">
            <h2 className="ds-page-title min-w-0 truncate !text-lg" title={displayName}>
              {displayName}
            </h2>
            <PhoneActionButton
              phone={ownerPhone}
              country={ownerCountry}
              size={18}
              alwaysShow
              rich
              email={row.email as string | null}
              className="shrink-0"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-[7px] gap-y-1.5 text-[12px] leading-none text-muted-foreground">
            <StakeholderStatusControl
              kind={kind}
              id={id}
              accountOwnerId={accountOwnerId}
              status={row.status}
              statusChangedAt={row.status_changed_at}
              variant="plain"
              invalidateQueryKeys={[queryKey]}
            />
            {row.contract_start && (
              <span>
                · contrato há{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {periodShort(row.contract_start, contractEnd)}
                </span>
              </span>
            )}
          </div>
          {row.contract_start && (
            <div className="mt-1 grid gap-[7px]">
              {/* Barra de vigência: do início até hoje (ou até o fim, se já definido). */}
              <div
                className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]"
                role="img"
                aria-label={`Vigência de ${fmtDateBR(row.contract_start)} até ${
                  contractEnd ? fmtDateBR(contractEnd) : "hoje"
                }`}
              >
                <div
                  className={`h-full rounded-full bg-current ${statusText(effStatus)}`}
                  style={{ width: `${vigenciaPct}%` }}
                />
              </div>
              <div className="flex justify-between gap-2 text-[12px] leading-none tabular-nums text-muted-foreground">
                <span>
                  Início{" "}
                  <span className="font-semibold text-foreground">
                    {fmtDateBR(row.contract_start)}
                  </span>
                </span>
                <span>
                  {contractEnd ? "Fim" : "Hoje"}{" "}
                  <span className="font-semibold text-foreground">
                    {contractEnd
                      ? fmtDateBR(contractEnd)
                      : fmtDateBR(new Date().toISOString().slice(0, 10))}
                  </span>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* "Ver Proprietário": janela ao meio da tela com os dados detalhados. */}
        <Dialog open={dataOpen} onOpenChange={setDataOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="ds-section-title truncate pr-8" title={displayName}>
                {displayName}
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              {(
                [
                  { l: "Nome completo", v: row.name, wide: true },
                  row.trade_name ? { l: "Nome fantasia", v: row.trade_name, wide: true } : null,
                  row.doc
                    ? { l: String(row.doc_type ?? "cpf").toUpperCase(), v: formatTaxId(row.doc) }
                    : null,
                  row.birth_date
                    ? {
                        l: "Nascimento",
                        v: new Date(
                          `${String(row.birth_date).slice(0, 10)}T12:00:00`,
                        ).toLocaleDateString("pt-BR"),
                      }
                    : null,
                  row.phone
                    ? { l: "Telefone", v: formatIntlPhone(row.phone, row.phone_country) }
                    : null,
                  row.email ? { l: "E-mail", v: row.email } : null,
                ] as Array<{ l: string; v: string; wide?: boolean } | null>
              )
                .filter((x): x is { l: string; v: string; wide?: boolean } => !!x && !!x.v)
                .map((f) => (
                  <div key={f.l} className={`min-w-0 ${f.wide ? "col-span-2" : ""}`}>
                    <p className="ds-eyebrow mb-1.5 text-[10.5px] tracking-[0.2em] text-[color:var(--faint)]">
                      {f.l}
                    </p>
                    <p className="break-words text-[13px] font-medium leading-[1.4] text-foreground">
                      {f.v}
                    </p>
                  </div>
                ))}
              {(row.address || row.city || row.state || row.cep) && (
                <div className="col-span-2 min-w-0">
                  <p className="ds-eyebrow mb-1.5 text-[10.5px] tracking-[0.2em] text-[color:var(--faint)]">
                    Endereço
                  </p>
                  <p className="break-words text-[13px] font-medium leading-[1.4] text-foreground">
                    {[row.address, row.district].filter(Boolean).join(" · ")}
                    <br />
                    <span className="text-muted-foreground">
                      {[[row.city, row.state].filter(Boolean).join(" / "), row.cep]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Abas (mockup `.tabs`): a mesma barra do Dashboard, só abas inteiras (anti-corte). */}
        <div className="mt-5">
          <Stepper
            compact
            current={ownerTab}
            onChange={setOwnerTab}
            steps={[
              { value: "timeline", label: "Timeline", icon: Pin },
              { value: "imoveis", label: "Imóveis", icon: Home, count: properties.length },
              { value: "financeiro", label: "Financeiro", icon: Coins },
              {
                value: "documentos",
                label: "Documentos",
                icon: FileText,
                count: feedDocs.length + looseDocs.length,
              },
              { value: "acessos", label: "Acessos", icon: User },
              { value: "log", label: "Log", icon: Activity },
            ]}
          />
        </div>

        <div className="mt-3.5 grid">
          {/* ---------------- Timeline (mockup P1) ---------------- */}
          {ownerTab === "timeline" &&
            (() => {
              const TL_TYPES = [
                { value: "n", label: "Registros" },
                { value: "g", label: "Agenda" },
                { value: "d", label: "Documentos" },
                { value: "t", label: "Atividade do sistema" },
              ];
              const term = tlQ.trim().toLowerCase();
              const visible = timeline.filter((it) => {
                if (tlTypes.length > 0 && !tlTypes.includes(it.key.charAt(0))) return false;
                if (!term) return true;
                return [it.title, it.author, ...it.lines.map((l) => `${l.k} ${l.v}`)]
                  .join(" ")
                  .toLowerCase()
                  .includes(term);
              });
              const visibleGroups = groupByPeriod(visible, "month");
              const countOf = (v: string) => timeline.filter((it) => it.key.charAt(0) === v).length;
              return (
                <>
                  <SearchActionRow
                    value={tlQ}
                    onChange={setTlQ}
                    placeholder="Buscar na timeline…"
                    actions={
                      <>
                        {ownerMenu}
                        <button
                          type="button"
                          onClick={() => setNoteOpen((o) => !o)}
                          aria-label="Nova nota"
                          title="Nova nota"
                          className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
                        >
                          <Plus className={`${ACTION_ICON} text-accent`} />
                        </button>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              aria-label="Filtrar a timeline"
                              title="Filtrar a timeline"
                              className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE} relative data-[state=open]:bg-foreground/[0.06]`}
                            >
                              <Filter className={ACTION_ICON} />
                              {tlTypes.length > 0 && (
                                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" />
                              )}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="end"
                            className="w-[240px] rounded-[14px] border-0 bg-popover/95 p-2 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_10%,transparent),inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent),0_24px_48px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl"
                            onOpenAutoFocus={(e) => e.preventDefault()}
                          >
                            <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1.5">
                              <span className="ds-eyebrow">Tipo</span>
                              {tlTypes.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setTlTypes([])}
                                  className="text-[11px] text-muted-foreground hover:text-foreground"
                                >
                                  Limpar
                                </button>
                              )}
                            </div>
                            {TL_TYPES.map((t) => {
                              const on = tlTypes.length === 0 || tlTypes.includes(t.value);
                              return (
                                <button
                                  key={t.value}
                                  type="button"
                                  onClick={() =>
                                    setTlTypes((cur) => {
                                      const base =
                                        cur.length === 0 ? TL_TYPES.map((x) => x.value) : cur;
                                      const next = base.includes(t.value)
                                        ? base.filter((x) => x !== t.value)
                                        : [...base, t.value];
                                      return next.length === 0 || next.length === TL_TYPES.length
                                        ? []
                                        : next;
                                    })
                                  }
                                  className={`flex min-h-[38px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[12.5px] font-semibold transition-colors ${
                                    on && tlTypes.length > 0
                                      ? "bg-foreground/[0.06]"
                                      : "hover:bg-foreground/[0.04]"
                                  }`}
                                >
                                  <span
                                    aria-hidden
                                    className={`grid size-4 shrink-0 place-items-center rounded-[5px] ${
                                      on
                                        ? "bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] text-white"
                                        : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_25%,transparent)]"
                                    }`}
                                  >
                                    {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
                                  </span>
                                  {t.label}
                                  <em className="ml-auto text-[11px] font-bold not-italic tabular-nums text-muted-foreground">
                                    {countOf(t.value)}
                                  </em>
                                </button>
                              );
                            })}
                          </PopoverContent>
                        </Popover>
                      </>
                    }
                  />
                  <div className="mt-[26px]">
                    {feed.isLoading && (
                      <p className="mb-3 flex items-center gap-1.5 ds-meta">
                        <Loader2 className="size-3 animate-spin" /> Buscando agenda e documentos…
                      </p>
                    )}
                    {noteOpen && (
                      <div className={`${PANEL_SHELL} mb-5 space-y-2 p-3`}>
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          rows={3}
                          maxLength={1000}
                          placeholder="Escreva uma nota sobre este proprietário…"
                          className="w-full resize-none rounded-[8px] bg-foreground/[0.04] px-3 py-2 text-[13px] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)] placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setNote("");
                              setNoteOpen(false);
                            }}
                            className="h-9 rounded-[8px] px-3 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            disabled={busy || !note.trim()}
                            onClick={async () => {
                              await submitNote();
                              setNoteOpen(false);
                            }}
                            className="h-9 rounded-[8px] px-3.5 text-[12px] font-semibold text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] hover:bg-foreground/[0.05] disabled:opacity-40"
                          >
                            Salvar nota
                          </button>
                        </div>
                      </div>
                    )}
                    {feed.data?.calendarError && (
                      <p className="mb-3 text-[11px] text-destructive">
                        Google Agenda: {feed.data.calendarError}
                      </p>
                    )}
                    {visible.length === 0 ? (
                      <OwnerEmpty
                        icon={StickyNote}
                        title={timeline.length === 0 ? "Sem registros ainda" : "Nada encontrado"}
                        text={
                          timeline.length === 0
                            ? "Notas, convites de agenda e documentos aparecem aqui automaticamente."
                            : "Nenhum registro bate com a busca ou o filtro."
                        }
                      />
                    ) : (
                      <div className="grid gap-5">
                        {visibleGroups.map((g) => (
                          <div key={g.label} className="grid gap-2.5">
                            <p className="ds-eyebrow text-[10.5px] tracking-[0.2em] text-[color:var(--faint)]">
                              {capitalize(g.label).replace(" de ", " ")}
                            </p>
                            <div className={`${PANEL_SHELL} divide-y divide-border`}>
                              {g.items.map((item) => {
                                const Ico = item.icon === Pin ? StickyNote : item.icon;
                                const when = new Date(item.at);
                                const hhmm = Number.isNaN(when.getTime())
                                  ? ""
                                  : when.toLocaleTimeString("pt-BR", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    });
                                return (
                                  <div
                                    key={item.key}
                                    className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3.5"
                                  >
                                    <span className="grid size-9 place-items-center rounded-lg bg-foreground/[0.06] text-muted-foreground">
                                      <Ico className="size-4" />
                                    </span>
                                    <div className="min-w-0">
                                      <p className="font-display text-[13.5px] font-bold leading-[1.3] text-foreground [overflow-wrap:anywhere]">
                                        {item.title}
                                      </p>
                                      {/* UMA informação completa por linha (pedido 13/10/2026). */}
                                      {item.lines.length > 0 && (
                                        <div className="mt-1 grid gap-y-0.5">
                                          {item.lines.map((l, li) => (
                                            <p
                                              key={li}
                                              className="break-words text-[12px] leading-[1.4] text-muted-foreground"
                                            >
                                              {l.k ? <>{l.k}: </> : null}
                                              <span className="font-semibold text-foreground">
                                                {l.v}
                                              </span>
                                            </p>
                                          ))}
                                        </div>
                                      )}
                                      {item.body && (
                                        <div className="mt-2 space-y-1 text-[12px]">
                                          {item.body}
                                        </div>
                                      )}
                                      <p className="mt-1.5 text-[12px] text-muted-foreground">
                                        Por {item.author !== "Sistema" ? item.author : item.badge}
                                      </p>
                                    </div>
                                    {/* Data em cima, hora embaixo — alinhadas à primeira linha do título. */}
                                    <div className="grid justify-items-end gap-0.5 text-[12px] leading-[1.3] tabular-nums text-muted-foreground">
                                      <span className="pt-[1px]">{shortDate(item.at)}</span>
                                      <span>{hhmm}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

          {/* ---------------- Imóveis (mockups P2, P5, P6, R1) ---------------- */}
          {ownerTab === "imoveis" && (
            <OwnerPropertiesPanel
              properties={properties as any}
              accountProperties={(data?.accountProperties ?? []) as any}
              connections={data?.connections ?? []}
              ownersById={data?.ownersById ?? {}}
              ownerId={id}
              owner={{ name: row.name, phone: ownerPhone, phone_country: ownerCountry }}
              busy={busy}
              otherOwners={otherOwnersQuery.data}
              onOpen={(pid) => setWindowPropertyId(pid)}
              onTransfer={(pid, target) => handleTransfer(pid, target)}
              accountOwnerId={accountOwnerId}
              menuAction={ownerMenu}
              onChanged={() => {
                qc.invalidateQueries({ queryKey });
                qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
                qc.invalidateQueries({ queryKey: ["my-properties"] });
              }}
            />
          )}

          {/* ---------------- Financeiro (mockup P3) ---------------- */}
          {ownerTab === "financeiro" && (
            <OwnerFinancePanel
              menuAction={ownerMenu}
              ownerId={id}
              accountOwnerId={accountOwnerId}
              properties={properties.map((p) => ({ id: p.id, name: p.name }))}
            />
          )}

          {/* ---------------- Documentos (mockup P4) ---------------- */}
          {ownerTab === "documentos" &&
            (() => {
              const term = docQ.trim().toLowerCase();
              const docs = feedDocs.filter((d) => {
                if (docSit.length > 0 && !docSit.includes(d.finishedAt ? "signed" : "pending"))
                  return false;
                return !term || d.name.toLowerCase().includes(term);
              });
              const looseShown = looseDocs.filter(
                (d) =>
                  (docSit.length === 0 || docSit.includes("loose")) &&
                  (!term || d.name.toLowerCase().includes(term)),
              );
              const totalDocs = feedDocs.length + looseDocs.length;
              return (
                <>
                  <SearchActionRow
                    value={docQ}
                    onChange={setDocQ}
                    placeholder="Buscar contrato…"
                    actions={
                      <>
                        {ownerMenu}
                        <input
                          ref={looseInputRef}
                          type="file"
                          accept="application/pdf,.pdf"
                          className="hidden"
                          onChange={(e) => uploadLoose(e.target.files?.[0])}
                        />
                        <button
                          type="button"
                          disabled={uploadingLoose}
                          onClick={() => looseInputRef.current?.click()}
                          aria-label="Anexar PDF"
                          title="Anexar um PDF avulso"
                          className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE} disabled:opacity-40`}
                        >
                          {uploadingLoose ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Plus className={`${ACTION_ICON} text-accent`} />
                          )}
                        </button>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              aria-label="Filtrar contratos"
                              title="Filtrar contratos"
                              className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE} relative data-[state=open]:bg-foreground/[0.06]`}
                            >
                              <Filter className={ACTION_ICON} />
                              {docSit.length > 0 && (
                                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" />
                              )}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="end"
                            className="w-[240px] rounded-[14px] border-0 bg-popover/95 p-2 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_10%,transparent),inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent),0_24px_48px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl"
                            onOpenAutoFocus={(e) => e.preventDefault()}
                          >
                            <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1.5">
                              <span className="ds-eyebrow">Situação</span>
                              {docSit.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setDocSit([])}
                                  className="text-[11px] text-muted-foreground hover:text-foreground"
                                >
                                  Limpar
                                </button>
                              )}
                            </div>
                            {[
                              { value: "signed", label: "Assinados" },
                              { value: "pending", label: "Pendentes" },
                              { value: "loose", label: "Anexados" },
                            ].map((t) => {
                              const on = docSit.length === 0 || docSit.includes(t.value);
                              return (
                                <button
                                  key={t.value}
                                  type="button"
                                  onClick={() =>
                                    setDocSit((cur) => {
                                      const base =
                                        cur.length === 0 ? ["signed", "pending", "loose"] : cur;
                                      const next = base.includes(t.value)
                                        ? base.filter((x) => x !== t.value)
                                        : [...base, t.value];
                                      return next.length === 0 || next.length === 3 ? [] : next;
                                    })
                                  }
                                  className={`flex min-h-[38px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[12.5px] font-semibold transition-colors ${
                                    on && docSit.length > 0
                                      ? "bg-foreground/[0.06]"
                                      : "hover:bg-foreground/[0.04]"
                                  }`}
                                >
                                  <span
                                    aria-hidden
                                    className={`grid size-4 shrink-0 place-items-center rounded-[5px] ${
                                      on
                                        ? "bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] text-white"
                                        : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_25%,transparent)]"
                                    }`}
                                  >
                                    {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
                                  </span>
                                  {t.label}
                                  <em className="ml-auto text-[11px] font-bold not-italic tabular-nums text-muted-foreground">
                                    {t.value === "loose"
                                      ? looseDocs.length
                                      : feedDocs.filter(
                                          (d) => (d.finishedAt ? "signed" : "pending") === t.value,
                                        ).length}
                                  </em>
                                </button>
                              );
                            })}
                          </PopoverContent>
                        </Popover>
                      </>
                    }
                  />
                  <div className="mt-[26px] grid gap-2">
                    {feed.isLoading ? (
                      <p className="flex items-center gap-1.5 ds-meta">
                        <Loader2 className="size-3 animate-spin" /> Buscando documentos…
                      </p>
                    ) : docs.length === 0 && looseShown.length === 0 ? (
                      <OwnerEmpty
                        icon={FileText}
                        title={totalDocs === 0 ? "Nenhum contrato vinculado" : "Nada encontrado"}
                        text={
                          totalDocs === 0
                            ? "Contratos do ClickSign com este CPF/CNPJ, e-mail ou nome aparecem aqui automaticamente. Para um PDF avulso, use o botão +."
                            : "Nenhum contrato bate com a busca."
                        }
                      />
                    ) : (
                      [
                        ...looseShown.map((d) => (
                          <div
                            key={`loose-${d.id}`}
                            className="relative grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-[3px] rounded-[12px] bg-foreground/[0.03] py-3 pl-3 pr-2 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]"
                          >
                            <span className="row-span-2 grid size-8 self-start place-items-center rounded-[10px] bg-foreground/[0.05] text-muted-foreground">
                              <FileText className="size-[15px]" />
                            </span>
                            <b className="truncate text-[13px] font-bold" title={d.name}>
                              {d.name}
                            </b>
                            <span className="flex items-center">
                              <button
                                type="button"
                                onClick={() => setPreview({ name: d.name, looseId: d.id })}
                                aria-label="Visualizar documento"
                                title="Visualizar documento"
                                className="grid size-7 place-items-center text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <Eye className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={downloadingId === d.id}
                                onClick={() => downloadDoc(d.id, d.name, true)}
                                aria-label="Baixar documento"
                                title="Baixar documento"
                                className="grid size-7 place-items-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                              >
                                {downloadingId === d.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Download className="size-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeLoose(d.id)}
                                aria-label="Remover documento"
                                title="Remover documento"
                                className="grid size-7 place-items-center text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </span>
                            <small className="col-span-2 text-[11px] leading-[1.35] text-muted-foreground">
                              Anexado · {shortDate(d.created_at)}{" "}
                              {new Date(d.created_at).getFullYear()}
                            </small>
                          </div>
                        )),
                        ...docs.map((d) => {
                          const signed = !!d.finishedAt;
                          const n = d.signers.length;
                          const done = d.signers.filter((x) =>
                            /sign|assin|finish|conclu/i.test(String(x.status ?? "")),
                          ).length;
                          return (
                            <div
                              key={d.id}
                              className="relative grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-[3px] rounded-[12px] bg-foreground/[0.03] py-3 pl-3 pr-2 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]"
                            >
                              <span className="row-span-2 grid size-8 self-start place-items-center rounded-[10px] bg-foreground/[0.05] text-muted-foreground">
                                <FileText className="size-[15px]" />
                              </span>
                              <b className="truncate text-[13px] font-bold" title={d.name}>
                                {d.name}
                              </b>
                              <span className="flex items-center">
                                <button
                                  type="button"
                                  onClick={() => setPreview({ name: d.name, docId: d.id })}
                                  aria-label="Visualizar documento"
                                  title="Visualizar documento"
                                  className="grid size-7 place-items-center text-muted-foreground transition-colors hover:text-foreground"
                                >
                                  <Eye className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={downloadingId === d.id}
                                  onClick={() => downloadDoc(d.id, d.name)}
                                  aria-label="Baixar documento"
                                  title="Baixar documento"
                                  className="grid size-7 place-items-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                                >
                                  {downloadingId === d.id ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Download className="size-3.5" />
                                  )}
                                </button>
                              </span>
                              <small className="col-span-2 text-[11px] leading-[1.35] text-muted-foreground">
                                {signed ? (
                                  <>
                                    Assinado
                                    {n ? ` · ${n} de ${n}` : ""} ·{" "}
                                    {shortDate(d.finishedAt as string)}{" "}
                                    {new Date(d.finishedAt as string).getFullYear()}
                                  </>
                                ) : (
                                  <>
                                    <span className="ds-atencao">
                                      Pendente{n ? ` · ${done} de ${n}` : ""}
                                    </span>
                                    {d.syncedAt
                                      ? ` · importado ${shortDate(d.syncedAt)}`
                                      : d.status
                                        ? ` · ${d.status}`
                                        : ""}
                                  </>
                                )}
                              </small>
                            </div>
                          );
                        }),
                      ]
                    )}
                  </div>
                </>
              );
            })()}

          {(ownerTab === "acessos" || ownerTab === "log") && (
            <div className="mb-[10px] flex justify-end">
              <div className={`${ACTION_BAR} !h-9 !w-auto !rounded-[11px]`}>{ownerMenu}</div>
            </div>
          )}

          {/* ---------------- Acessos (Prop9) ---------------- */}
          {ownerTab === "acessos" &&
            (!stakeholderEmail ? (
              <OwnerEmpty
                icon={User}
                title="Sem e-mail cadastrado"
                text="Cadastre um e-mail nesta ficha para poder liberar o acesso ao sistema."
              />
            ) : accessQuery.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando acessos…
              </p>
            ) : accessReady ? (
              <OwnerAccessList
                userId={accessQuery.data!.userId as string}
                email={stakeholderEmail}
                status="active"
              />
            ) : (
              <OwnerEmpty
                icon={User}
                title={
                  accessQuery.data?.status === "pending"
                    ? "Convite enviado"
                    : "Sem acesso ao sistema"
                }
                text={
                  accessQuery.data?.status === "pending"
                    ? "As permissões ficam disponíveis assim que a pessoa aceitar o convite e entrar no sistema."
                    : "Ative “Permitir acesso ao sistema” na edição do cadastro para liberar."
                }
              />
            ))}

          {/* ---------------- Log (Prop10) ---------------- */}
          {ownerTab === "log" &&
            (logItems.length === 0 ? (
              trail.isLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Carregando…
                </p>
              ) : (
                <OwnerEmpty
                  icon={Activity}
                  title="Sem atividades registradas"
                  text="Assim que a pessoa usar o sistema, cada passo aparece aqui."
                />
              )
            ) : (
              <div className="grid gap-6">
                {logGroups.map((g) => (
                  <div key={g.label}>
                    <GroupTitle title={g.label} />
                    <GroupList>
                      {g.items.map((ev) => (
                        <GroupRow
                          key={ev.id}
                          icon={logIcon(ev.title)}
                          title={ev.title}
                          titleWeight={500}
                          sub={ev.details.length > 0 ? ev.details.join(" · ") : undefined}
                          minH={56}
                          chevron={false}
                          trailing={
                            <span className="shrink-0 text-[11.5px] text-[color:var(--faint)]">
                              {ev.at
                                ? new Date(ev.at).toLocaleTimeString("pt-BR", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "—"}
                            </span>
                          }
                        />
                      ))}
                    </GroupList>
                  </div>
                ))}
              </div>
            ))}
        </div>

        <DocPreviewDialog doc={preview} onClose={() => setPreview(null)} />
        <OwnerPropertyWindow
          propertyId={windowPropertyId}
          onClose={() => setWindowPropertyId(null)}
          returnTo={returnToHere}
          owner={{ name: row.name, phone: ownerPhone, country: ownerCountry }}
        />
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-5 overflow-x-hidden px-5 py-6 sm:px-6">
      {/* ---------- Cabeçalho: glow de marca (aprovado — proposta B do mockup)
          + eyebrow + nome + metadados ---------- */}
      <header className="relative overflow-hidden pt-4">
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

        {/* Linha 3: metadados à esquerda, ações à direita (espaço antes vazio).
            Situação + vigência ficam na mesma linha (com separador) — o
            "Pessoa Física/Jurídica" saiu daqui, não carregava informação que
            já não estivesse na ficha (aprovado no mockup do cabeçalho). */}
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
          </div>

          {/* Ações: "Importar dados" e "Editar cadastro" viram um só botão
              (Editar), com as duas opções num menuzinho — em vez de 2
              quadrados separados (aprovado no mockup do cabeçalho). "Dados
              pessoais" continua com seu próprio botão. */}
          <div className="ds-scroll-x shrink-0 items-center gap-1.5">
            {clicksignActive ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Editar"
                    title="Editar"
                    disabled={extracting}
                    className="grid size-9 place-items-center rounded-[0.3rem] border border-border text-foreground hover:bg-secondary transition-colors disabled:opacity-60"
                  >
                    {extracting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Pencil className="size-4" />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil className="size-3.5" /> Editar cadastro
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={runExtract}>
                    <FileText className="size-3.5" /> Importar dados do contrato
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                type="button"
                onClick={onEdit}
                aria-label="Editar cadastro"
                title="Editar cadastro"
                className="grid size-9 place-items-center rounded-[0.3rem] border border-border text-foreground hover:bg-secondary transition-colors"
              >
                <Pencil className="size-4" />
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
              <ChevronDown
                className={`size-4 transition-transform ${dataOpen ? "rotate-180" : ""}`}
              />
            </button>
          </div>
        </div>
      </header>

      {/* ---------- Dados pessoais (recolhível, fechado por padrão) ---------- */}
      {dataOpen && (
        <section className={newLayout ? `${PANEL_SHELL} p-4` : "ds-surface bg-card p-4"}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome completo" value={row.name} copy={row.name} />
            {row.trade_name && (
              <Field label="Nome fantasia" value={row.trade_name} copy={row.trade_name} />
            )}
            <Field
              label="Tipo de pessoa"
              value={
                String(row.person_type ?? "pf").toUpperCase() === "PJ"
                  ? "Pessoa jurídica"
                  : "Pessoa física"
              }
            />
            {row.birth_date && (
              <Field
                label="Data de nascimento"
                value={new Date(
                  `${String(row.birth_date).slice(0, 10)}T12:00:00`,
                ).toLocaleDateString("pt-BR")}
                copy={new Date(
                  `${String(row.birth_date).slice(0, 10)}T12:00:00`,
                ).toLocaleDateString("pt-BR")}
              />
            )}
            {categoryLabels.length > 0 && (
              <Field label="Categorias de serviço" value={categoryLabels.join(", ")} />
            )}
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
                  className="inline-flex min-w-0 items-center text-sm hover:underline"
                >
                  <span className="truncate">{row.email}</span>
                </a>
              </Field>
            )}
            {row.phone && (
              <Field label="Telefone" copy={formatIntlPhone(row.phone, row.phone_country)}>
                <WhatsAppLink phone={row.phone} country={row.phone_country} />
              </Field>
            )}
            {(row.address || row.city || row.state || row.cep) && (
              <div className="sm:col-span-2">
                {/* Linha 1: endereço + bairro. Linha 2: cidade + estado + CEP
                    (o CEP deixou de ter um Field próprio — mora aqui). Sem
                    ícones de localização/e-mail (removidos a pedido). */}
                <Field
                  label="Endereço"
                  copy={[
                    row.address,
                    row.district,
                    [row.city, row.state].filter(Boolean).join(" / "),
                    row.cep,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  <p className="text-sm">
                    <span className="min-w-0 break-words">
                      {[row.address, row.district].filter(Boolean).join(" · ")}
                      {[row.city, row.state, row.cep].filter(Boolean).length > 0 && (
                        <>
                          <br />
                          {[[row.city, row.state].filter(Boolean).join(" / "), row.cep]
                            .filter(Boolean)
                            .join(" · ")}
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
        <TabsList
          className={`ds-segmented h-auto w-full max-w-full !rounded-[0.3rem] border-0 p-0 ${newLayout ? "bg-card shadow-[inset_0_0_0_1px_var(--border)]" : "bg-foreground/5"}`}
        >
          <TabsTrigger className={newLayout ? SEG_TAB_NEW : SEG_TAB} value="visao">
            Timeline
          </TabsTrigger>
          {(kind === "owner" || kind === "provider") && (
            <TabsTrigger className={newLayout ? SEG_TAB_NEW : SEG_TAB} value="imoveis">
              Imóveis
            </TabsTrigger>
          )}
          <TabsTrigger className={newLayout ? SEG_TAB_NEW : SEG_TAB} value="financeiro">
            Financeiro
          </TabsTrigger>
          <TabsTrigger className={newLayout ? SEG_TAB_NEW : SEG_TAB} value="documentos">
            Documentos
          </TabsTrigger>
          <TabsTrigger className={newLayout ? SEG_TAB_NEW : SEG_TAB} value="acessos">
            Acessos
          </TabsTrigger>
          <TabsTrigger className={newLayout ? SEG_TAB_NEW : SEG_TAB} value="log">
            Log
          </TabsTrigger>
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
            Detalhes de tudo o que a pessoa fez no sistema: páginas abertas, botões clicados e
            informações preenchidas.
          </p>
          {(trail.data?.items ?? []).length === 0 ? (
            <Placeholder
              icon={Pin}
              title="Sem atividades registradas"
              desc="Assim que a pessoa usar o sistema, cada passo aparece aqui."
            />
          ) : newLayout ? (
            <div className="space-y-4">
              {groupByPeriod(
                (trail.data?.items ?? []).map((ev) => ({ ...ev, at: ev.at ?? "" })),
                "day",
              ).map((g) => (
                <div key={g.label} className="space-y-2">
                  <GroupLabel count={g.items.length}>{g.label}</GroupLabel>
                  <ul className={`${PANEL_SHELL} divide-y divide-border`}>
                    {g.items.map((ev) => (
                      <li key={ev.id} className="px-4 py-3">
                        <p className="text-[13.5px] leading-[1.3] text-foreground">{ev.title}</p>
                        <p className="ds-meta">
                          {ev.badge} ·{" "}
                          {ev.at
                            ? new Date(ev.at).toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </p>
                        {ev.details.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {ev.details.map((d, i) => (
                              <li key={i} className="ds-meta break-words">
                                {d}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <ul className="space-y-2">
              {(trail.data?.items ?? []).map((ev) => (
                <li key={ev.id} className="ds-surface bg-card px-4 py-3">
                  <p className="text-[13.5px] leading-[1.3] font-normal text-foreground">
                    {ev.title}
                  </p>
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
                  <p className="mt-1 text-[11px] text-muted-foreground/80">
                    {ev.at ? fmt(ev.at) : "Sem data"}
                  </p>
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
              {newLayout && !feed.isLoading && (
                <button
                  type="button"
                  onClick={() => setNoteOpen((o) => !o)}
                  aria-expanded={noteOpen}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[0.3rem] border border-border bg-secondary/40 px-3 text-[13px] font-medium transition-colors hover:bg-secondary"
                >
                  <Plus className="size-4 text-primary" /> Nova nota
                </button>
              )}
              {feed.isLoading && (
                <span className="flex items-center gap-1.5 ds-meta shrink-0">
                  <Loader2 className="size-3 animate-spin" /> Sincronizando…
                </span>
              )}
            </div>

            {newLayout && noteOpen && (
              <div className={`${PANEL_SHELL} space-y-2 p-3`}>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Escreva uma nota sobre este proprietário…"
                  className="w-full resize-none rounded-[0.3rem] border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNote("");
                      setNoteOpen(false);
                    }}
                    className="h-9 rounded-[0.3rem] px-3 text-[13px] text-muted-foreground hover:text-foreground"
                  >
                    Cancelar
                  </button>
                  <Button
                    size="sm"
                    disabled={busy || !note.trim()}
                    onClick={async () => {
                      await submitNote();
                      setNoteOpen(false);
                    }}
                  >
                    Salvar nota
                  </Button>
                </div>
              </div>
            )}

            {feed.data?.calendarError && (
              <p className="text-[11px] text-destructive">
                Google Agenda: {feed.data.calendarError}
              </p>
            )}

            {timeline.length === 0 ? (
              <Placeholder
                icon={Pin}
                title="Sem registros ainda"
                desc="Notas, convites de agenda e documentos aparecem aqui automaticamente."
              />
            ) : // Recuo maior entre a linha e os cartões (pl-11, era pl-9) e
            // mais respiro entre a própria linha e a borda esquerda da
            // tela (ml-2) — o -left do ponto acompanha o pl, pra
            // continuar centralizado em cima da linha. Cartões em
            // w-full (ocupam a largura toda do quadrante) e com mais
            // espaço entre um evento e outro (space-y-4, era space-y-3).
            newLayout ? (
              <div className="space-y-4">
                {groupByPeriod(timeline, "month").map((g) => (
                  <div key={g.label} className="space-y-2">
                    <GroupLabel count={g.items.length}>{g.label}</GroupLabel>
                    <ul className="space-y-2">
                      {g.items.map((item) => (
                        <li key={item.key} className={`${PANEL_SHELL} flex gap-3 px-4 py-3`}>
                          <item.icon
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-[13.5px] leading-[1.4] text-foreground">
                              {item.title}
                            </p>
                            {item.body}
                            <p className="ds-meta">
                              {item.badge} · {item.at ? fmt(item.at) : "Sem data"} · {item.author}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <ol className="relative ml-2 w-full space-y-4 border-l border-border pl-11">
                {timeline.map((item) => (
                  <li key={item.key} className="relative w-full">
                    <span className="absolute -left-[49px] top-4 size-2.5 rounded-full bg-primary/70 ring-4 ring-background" />
                    <div className="ds-surface w-full bg-card px-4 py-3.5">
                      <div className="min-w-0 space-y-1.5">
                        <p className="text-[13.5px] leading-[1.4] font-normal text-foreground">
                          {item.title}
                        </p>
                        <p className="ds-meta">{item.badge}</p>
                        {item.body}
                        <p className="ds-meta opacity-80">
                          {item.at ? fmt(item.at) : "Sem data"} · {item.author}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </TabsContent>

        {/* -------------------- Imóveis -------------------- */}
        {(kind === "owner" || kind === "provider") && (
          <TabsContent value="imoveis" className="mt-5 space-y-4">
            {/* Portfólio em linhas densas: título + situação do guia na mesma
                linha, localização abaixo e ações discretas em texto. */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div className="min-w-0">
                <h3 className="ds-section-title truncate">
                  {kind === "owner" ? "Imóveis vinculados" : "Imóveis atendidos"}
                </h3>
                <p className="ds-meta">{properties.length} residência(s)</p>
              </div>
              {available.length > 0 && (
                <button
                  type="button"
                  onClick={() => setLinkPickerOpen(true)}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[0.3rem] border border-border bg-secondary/40 px-3 text-[13px] font-medium transition-colors hover:bg-secondary"
                >
                  <Plus className="size-4 text-primary" /> Vincular
                </button>
              )}
            </div>

            <MultiLinkPicker
              open={linkPickerOpen}
              onOpenChange={setLinkPickerOpen}
              title={kind === "owner" ? "Vincular residências" : "Vincular imóveis atendidos"}
              description="Marque quantas residências quiser — todas são vinculadas de uma vez."
              options={available.map((p: any) => ({
                id: p.id,
                label: p.name,
                hint: [p.city, p.state].filter(Boolean).join(" / ") || null,
              }))}
              initialSelected={[]}
              confirmLabel="Vincular selecionados"
              emptyText="Nenhuma residência disponível."
              onConfirm={(ids) => linkMany(ids)}
            />

            {properties.length === 0 ? (
              <Placeholder
                icon={Home}
                title="Nenhuma residência vinculada"
                desc={
                  kind === "owner"
                    ? "Vincule uma residência existente acima ou crie uma nova para este proprietário."
                    : "Vincule uma residência existente acima para que este prestador passe a atendê-la."
                }
              />
            ) : (
              <div className="space-y-2">
                {properties.map((p: any) => {
                  const status = p.published
                    ? {
                        label: "Publicado",
                        cls: "border-emerald-500/25 bg-emerald-500/10 text-emerald-500",
                      }
                    : p.guide_created
                      ? {
                          label: "Pendente",
                          cls: "border-amber-500/25 bg-amber-500/10 text-amber-500",
                        }
                      : { label: "Sem guia", cls: "border-border text-muted-foreground" };
                  return (
                    <div
                      key={p.id}
                      className="ds-surface bg-card p-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {newLayout && kind === "owner" ? (
                            <button
                              type="button"
                              onClick={() => setWindowPropertyId(p.id)}
                              className="ds-card-title min-w-0 break-words text-left hover:underline"
                            >
                              {p.name}
                            </button>
                          ) : (
                            <p className="ds-card-title min-w-0 break-words">{p.name}</p>
                          )}
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
                                  <SelectItem key={o.id} value={o.id}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                                {otherOwnersQuery.data?.length === 0 && (
                                  <div className="px-3 py-2 text-xs text-muted-foreground">
                                    Nenhum outro proprietário cadastrado.
                                  </div>
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
                              onClick={() => {
                                setTransferPropertyId(null);
                                setTransferTargetId("");
                              }}
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

                      {kind === "provider" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => toggleLink(p.id, false)}
                          className="grid size-8 shrink-0 place-items-center rounded-[0.3rem] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          title="Desvincular este imóvel do prestador."
                          aria-label="Desvincular imóvel"
                        >
                          <Unlink className="size-4" />
                        </button>
                      ) : (
                        transferPropertyId !== p.id && (
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
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {kind === "owner" && (
              <Link
                to="/admin/properties/$id"
                params={{ id: "new" }}
                search={{ returnTo: returnToHere, ownerId: row?.id }}
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Plus className="size-3.5" /> Criar nova residência
              </Link>
            )}
          </TabsContent>
        )}

        {/* -------------------- Financeiro -------------------- */}
        <TabsContent value="financeiro" className="mt-5 space-y-4">
          {newLayout ? (
            <>
              <div className={`${PANEL_SHELL} grid grid-cols-3 divide-x divide-border`}>
                {(
                  [
                    ["A receber", "ds-ok"],
                    ["Recebido", "ds-data"],
                    ["A pagar", "ds-atencao"],
                  ] as const
                ).map(([l, c]) => (
                  <div key={l} className="min-w-0 px-3 py-3 sm:px-4">
                    <p
                      className={`truncate text-[10px] font-semibold uppercase tracking-wide ${c}`}
                    >
                      {l}
                    </p>
                    <p className="mt-1 break-all font-display text-base tabular-nums tracking-tight sm:text-lg">
                      {(0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </p>
                  </div>
                ))}
              </div>
              <EmptyState
                icon={FileText}
                title="Nenhum lançamento ainda"
                description="Repasses, taxas e cobranças deste proprietário aparecem aqui."
              />
            </>
          ) : (
            <>
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
            </>
          )}
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
                      <p className="text-[13.5px] leading-[1.3] font-normal text-foreground truncate">
                        {d.name}
                      </p>
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

function DocPreviewDialog({ doc, onClose }: { doc: PreviewTarget; onClose: () => void }) {
  const fileFn = useServerFn(getClicksignDocumentFile);
  const looseFn = useServerFn(getOwnerLooseDocFile);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["clicksign-doc-file", doc?.docId ?? doc?.looseId],
    queryFn: () =>
      doc!.looseId
        ? looseFn({ data: { id: doc!.looseId } })
        : fileFn({ data: { id: doc!.docId! } }),
    enabled: !!(doc?.docId || doc?.looseId),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const externalUrl = doc?.docId ? null : (doc?.url ?? null);

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
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.92),
          );
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
