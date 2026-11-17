import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Loader2, Lock, RotateCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import { ActionButton } from "@/components/admin-pages/admin-mobile-ui";
import { Switch } from "@/components/ui/switch";
import { UField, UINPUT_BARE, UROW } from "@/components/admin-pages/profile-fields";
import { formatBRPhone, formatCNPJ } from "@/lib/masks";
import {
  getMyCompany,
  lookupMyCompany,
  saveMyCompany,
  setMyCompanyChoice,
} from "@/lib/company-profile.functions";
import {
  TAX_REGIME_LABEL,
  missingCompanyFields,
  situationChip,
  situationWord,
  type CompanyData,
  type CompanyFieldKey,
  type CompanyLookupResult,
  type TaxRegime,
} from "@/lib/company-profile.shared";

/**
 * Perfil · "Somos uma Empresa (CNPJ)" + quadrante Empresa (mockups aprovados em 17/11/2026, desktop e celular).
 *  · A chave é OPCIONAL (nem todo cliente tem empresa); ligada, abre o quadrante Empresa abaixo do quadrante Pessoa Física.
 *  · O CNPJ SEMPRE passa pela consulta na Receita (ativo/inativo). Os dados que ela devolve entram bloqueados;
 *    só ficam abertos os que a Receita não informa (inscrição municipal e, quando faltarem, e-mail, telefone etc.).
 *  · Nada é preenchido à mão: se a Receita não responde, os campos ficam bloqueados e há "Tentar de novo".
 *  · Depois de validado e gravado, o CNPJ e os campos da Receita só mudam via suporte (como o CPF).
 */

const EMPTY: CompanyData = {
  cnpj: "",
  situation: "",
  legalName: "",
  tradeName: "",
  email: "",
  phone: "",
  cep: "",
  street: "",
  number: "",
  city: "",
  state: "",
  taxRegime: "",
  municipalRegistration: "",
};

type Phase =
  | "idle"
  | "loading"
  | "ok"
  | "inactive"
  | "not_found"
  | "invalid"
  | "in_use"
  | "unavailable";

const fmtDate = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString("pt-BR");
};
const fmtCep = (v: string) => {
  const d = v.replace(/\D+/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

/** Linha de campo: bloqueada (cadeado), aberta (input) ou vazia ("—") conforme a fase. */
function FieldRow({
  phase,
  locked,
  label,
  k,
  value,
  onChange,
  placeholder,
  inputMode,
  maxLength,
  format,
  children,
}: {
  phase: Phase;
  locked: CompanyFieldKey[];
  label: string;
  k: CompanyFieldKey;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "tel" | "email" | "text";
  maxLength?: number;
  format?: (v: string) => string;
  children?: React.ReactNode;
}) {
  const shown = format ? format(value) : value;
  if (phase !== "ok") {
    return (
      <UField label={label} required>
        <div aria-disabled="true" className={`${UROW} text-[var(--faint)]`}>
          —
        </div>
      </UField>
    );
  }
  if (locked.includes(k)) {
    return (
      <UField label={label} required>
        <div aria-disabled="true" className={`${UROW} cursor-not-allowed text-muted-foreground`}>
          <span className="min-w-0 flex-1 truncate">{shown}</span>
          <span
            role="img"
            aria-label="Alteração apenas via suporte"
            title="Alteração apenas via suporte"
            className="flex cursor-help text-[var(--faint)]"
          >
            <Lock className="size-3.5" />
          </span>
        </div>
      </UField>
    );
  }
  return (
    <UField label={label} required>
      <div className={UROW}>
        {children ?? (
          <input
            value={shown}
            onChange={(e) => onChange(e.target.value)}
            inputMode={inputMode}
            maxLength={maxLength}
            placeholder={placeholder}
            className={UINPUT_BARE}
            aria-label={label}
          />
        )}
      </div>
    </UField>
  );
}

export function CompanySection({ ownerId }: { ownerId: string | null }) {
  const getFn = useServerFn(getMyCompany);
  const choiceFn = useServerFn(setMyCompanyChoice);
  const lookupFn = useServerFn(lookupMyCompany);
  const saveFn = useServerFn(saveMyCompany);
  const qc = useQueryClient();
  const key = ["account-company", ownerId] as const;

  const q = useQuery({
    queryKey: key,
    queryFn: () => getFn({ data: { ownerId } }),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const [on, setOn] = useState(false);
  const [cnpjMasked, setCnpjMasked] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [situation, setSituation] = useState("");
  const [form, setForm] = useState<CompanyData>(EMPTY);
  const [locked, setLocked] = useState<CompanyFieldKey[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const savedCnpj = q.data?.company?.cnpj ?? "";
  const hydrated = useRef(false);

  // Hidrata com o que já está gravado (uma vez por carga).
  useEffect(() => {
    if (!q.data) return;
    setOn(q.data.isCompany === true);
    if (q.data.company) {
      setCnpjMasked(formatCNPJ(q.data.company.cnpj));
      setForm(q.data.company);
      setLocked(q.data.locked);
      setCheckedAt(q.data.checkedAt);
      setPhase("ok");
    }
    hydrated.current = true;
  }, [q.data]);

  const choice = useMutation({
    mutationFn: (isCompany: boolean) => choiceFn({ data: { isCompany, ownerId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => {
      toast.error((e as Error).message);
      setOn(true);
    },
  });

  function onToggle(next: boolean) {
    if (savedCnpj) return; // depois de validado, só o suporte altera
    setOn(next);
    if (!next) {
      setCnpjMasked("");
      setPhase("idle");
      setForm(EMPTY);
      setLocked([]);
    }
    choice.mutate(next);
  }

  // Consulta a Receita assim que o CNPJ completa 14 dígitos (nunca com o CNPJ já gravado).
  const digits = cnpjMasked.replace(/\D+/g, "");
  const token = useRef(0);
  useEffect(() => {
    if (!on || savedCnpj) return;
    if (digits.length !== 14) {
      if (phase !== "idle") {
        setPhase("idle");
        setForm(EMPTY);
        setLocked([]);
      }
      return;
    }
    const my = ++token.current;
    setPhase("loading");
    setForm({ ...EMPTY, cnpj: digits });
    setLocked([]);
    lookupFn({ data: { cnpj: digits, ownerId } })
      .then((r: CompanyLookupResult) => {
        if (my !== token.current) return;
        if (r.ok) {
          setForm(r.data);
          setLocked(r.locked);
          setCheckedAt(r.checkedAt);
          setPhase("ok");
        } else {
          setSituation(r.situation ?? "");
          setPhase(
            r.code === "inactive"
              ? "inactive"
              : r.code === "not_found"
                ? "not_found"
                : r.code === "invalid"
                  ? "invalid"
                  : r.code === "in_use"
                    ? "in_use"
                    : "unavailable",
          );
        }
      })
      .catch(() => {
        if (my === token.current) setPhase("unavailable");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits, on, retry, savedCnpj]);

  const set = <K extends keyof CompanyData>(k: K, v: CompanyData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const isLocked = (k: CompanyFieldKey) => locked.includes(k);

  const missing = useMemo(() => (phase === "ok" ? missingCompanyFields(form) : []), [phase, form]);

  // Salvamento automático: só quando a Receita validou e todos os campos estão completos.
  const snapshot = JSON.stringify([
    form.tradeName,
    form.email,
    form.phone,
    form.cep,
    form.street,
    form.number,
    form.city,
    form.state,
    form.taxRegime,
    form.municipalRegistration,
  ]);
  const lastSaved = useRef<string>("");
  useEffect(() => {
    if (!q.data?.company) return;
    const c = q.data.company;
    lastSaved.current = JSON.stringify([
      c.tradeName,
      c.email,
      c.phone,
      c.cep,
      c.street,
      c.number,
      c.city,
      c.state,
      c.taxRegime,
      c.municipalRegistration,
    ]);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ownerId,
          cnpj: form.cnpj,
          tradeName: form.tradeName,
          email: form.email,
          phone: form.phone,
          cep: form.cep,
          street: form.street,
          number: form.number,
          city: form.city,
          state: form.state,
          taxRegime: (form.taxRegime || null) as TaxRegime | null,
          municipalRegistration: form.municipalRegistration,
        },
      }),
    onSuccess: () => {
      lastSaved.current = snapshot;
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["account-profile", ownerId] });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  useEffect(() => {
    if (phase !== "ok" || missing.length > 0 || save.isPending) return;
    if (savedCnpj && snapshot === lastSaved.current) return;
    const t = setTimeout(() => save.mutate(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, missing.length, snapshot, savedCnpj]);

  const frozen = !!savedCnpj; // CNPJ já gravado: só o suporte muda

  const openOnlyMunicipal = phase === "ok" && missing.every((m) => m === "municipalRegistration");
  const note: React.ReactNode =
    phase === "loading" ? (
      "Conferindo se o CNPJ está ativo e buscando os dados na Receita Federal."
    ) : phase === "ok" ? (
      <>
        Dados da Receita Federal (consulta de {fmtDate(checkedAt)}) ficam bloqueados. Alteração
        apenas via suporte.{" "}
        {missing.length === 0
          ? ""
          : openOnlyMunicipal
            ? "Preencha só a inscrição municipal."
            : "Preencha os campos abertos."}
      </>
    ) : phase === "inactive" ? (
      <span className="text-[#c0392b]">
        Este CNPJ está <b>{situationWord(situation)}</b> na Receita Federal. Informe um CNPJ ativo.
      </span>
    ) : phase === "not_found" ? (
      <span className="text-[#c0392b]">
        CNPJ não encontrado na Receita Federal. Confira os números.
      </span>
    ) : phase === "invalid" ? (
      <span className="text-[#c0392b]">CNPJ inválido. Confira os números.</span>
    ) : phase === "in_use" ? (
      <span className="text-[#c0392b]">Este CNPJ já está em uso em outra conta.</span>
    ) : phase === "idle" ? (
      "Digite o CNPJ: consultamos a Receita Federal e preenchemos os dados."
    ) : null;

  return (
    <>
      {/* Chave opcional "Somos uma Empresa (CNPJ)". */}
      <section className={`${PANEL_SHELL} flex items-center justify-between gap-3 px-4 py-3.5`}>
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold leading-tight">Somos uma Empresa (CNPJ)</div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            {frozen
              ? "CNPJ validado na Receita Federal. Alteração apenas via suporte."
              : on
                ? "Preencha os dados da empresa abaixo."
                : "Ligue se você emite nota ou contrata como empresa."}
          </div>
        </div>
        <Switch
          checked={on}
          disabled={frozen || choice.isPending || q.isLoading}
          onCheckedChange={onToggle}
          aria-label="Somos uma Empresa (CNPJ)"
        />
      </section>

      {on ? (
        <section className={`${PANEL_SHELL} px-4 pb-[18px] pt-4`}>
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="grid size-11 shrink-0 place-items-center rounded-full text-[#fbf6f1]"
              style={{ background: "linear-gradient(135deg,#a11d1d,#2b1747)" }}
            >
              <Building2 className="size-[22px]" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-[14px] font-bold leading-[1.3]">
                Empresa
              </div>
              <div className="mt-px truncate text-[12px] text-muted-foreground">
                Todos os campos são obrigatórios
              </div>
            </div>
          </div>
          <div className="mb-1 mt-4 border-t border-foreground/[0.07]" />

          {phase === "unavailable" ? (
            <div className="mb-2 mt-3.5 flex items-start gap-2.5 rounded-[10px] bg-[#f7efd9] px-3.5 py-3 ring-1 ring-inset ring-[#9a6a00]/20 dark:bg-[#3a2f12] dark:ring-[#c9a962]/25">
              <TriangleAlert
                className="mt-px size-[18px] shrink-0 text-[#9a6a00] dark:text-[#c9a962]"
                strokeWidth={2}
              />
              <div className="min-w-0">
                <div className="text-[12.5px] font-bold leading-[1.3] text-[#7a5200] dark:text-[#e2c77a]">
                  Receita Federal indisponível
                </div>
                <div className="mt-[3px] text-[11.5px] leading-[1.45] text-muted-foreground">
                  Não conseguimos consultar o CNPJ agora. Os campos{" "}
                  <br className="hidden lg:block" />
                  ficam bloqueados: os dados só entram pela consulta.
                </div>
                <ActionButton
                  className="mt-2.5"
                  icon={<RotateCw className="size-3" strokeWidth={2.2} />}
                  onClick={() => setRetry((n) => n + 1)}
                >
                  Tentar de novo
                </ActionButton>
              </div>
            </div>
          ) : note ? (
            <p className="px-0 pb-0.5 pt-2.5 text-[11.5px] leading-[1.4] text-muted-foreground">
              {note}
            </p>
          ) : null}

          <div className="mt-1 flex flex-col gap-3">
            {/* CNPJ: sempre passa pela Receita. Validado ⇒ bloqueado; antes disso, digitável. */}
            <UField label="CNPJ" required>
              {phase === "ok" ? (
                <div
                  aria-disabled="true"
                  className={`${UROW} cursor-not-allowed text-muted-foreground`}
                >
                  <span className="min-w-0 flex-1 truncate">{formatCNPJ(form.cnpj)}</span>
                  <span className="rounded-full bg-[rgba(127,183,154,0.16)] px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.04em] text-[#1f7a4d]">
                    Ativa
                  </span>
                  <span
                    role="img"
                    aria-label="Alteração apenas via suporte"
                    title="Alteração apenas via suporte"
                    className="flex cursor-help text-[var(--faint)]"
                  >
                    <Lock className="size-3.5" />
                  </span>
                </div>
              ) : (
                <div className={UROW}>
                  <input
                    value={cnpjMasked}
                    onChange={(e) =>
                      setCnpjMasked(formatCNPJ(e.target.value.replace(/\D+/g, "").slice(0, 14)))
                    }
                    inputMode="numeric"
                    placeholder="00.000.000/0000-00"
                    className={UINPUT_BARE}
                    aria-label="CNPJ"
                    disabled={phase === "loading"}
                  />
                  {phase === "loading" ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Consultando a Receita…
                    </span>
                  ) : phase === "inactive" ? (
                    <span className="shrink-0 rounded-full bg-[#fbe6e3] px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.04em] text-[#b3261e]">
                      {situationChip(situation)}
                    </span>
                  ) : phase === "unavailable" ? (
                    <span className="shrink-0 rounded-full bg-[#f7ecd0] px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.04em] text-[#9a6a00]">
                      Sem resposta
                    </span>
                  ) : null}
                </div>
              )}
            </UField>

            <FieldRow
              phase={phase}
              locked={locked}
              label="Razão social"
              k="legalName"
              value={form.legalName}
              onChange={(v) => set("legalName", v)}
              maxLength={160}
            />
            <FieldRow
              phase={phase}
              locked={locked}
              label="Nome fantasia"
              k="tradeName"
              value={form.tradeName}
              onChange={(v) => set("tradeName", v)}
              maxLength={120}
              placeholder="Ex.: Sigma Turismo"
            />
            <FieldRow
              phase={phase}
              locked={locked}
              label="E-mail"
              k="email"
              value={form.email}
              onChange={(v) => set("email", v)}
              inputMode="email"
              maxLength={160}
              placeholder="contato@empresa.com.br"
            />
            <FieldRow
              phase={phase}
              locked={locked}
              label="Telefone"
              k="phone"
              value={form.phone}
              onChange={(v) => set("phone", v.replace(/\D+/g, "").slice(0, 11))}
              format={(v) => formatBRPhone(v)}
              inputMode="tel"
              placeholder="(11) 3000-0000"
            />
            <FieldRow
              phase={phase}
              locked={locked}
              label="CEP"
              k="cep"
              value={form.cep}
              onChange={(v) => set("cep", v.replace(/\D+/g, "").slice(0, 8))}
              format={fmtCep}
              inputMode="numeric"
              placeholder="00000-000"
            />
            <FieldRow
              phase={phase}
              locked={locked}
              label="Rua"
              k="street"
              value={form.street}
              onChange={(v) => set("street", v)}
              maxLength={160}
            />
            <FieldRow
              phase={phase}
              locked={locked}
              label="Nº"
              k="number"
              value={form.number}
              onChange={(v) => set("number", v)}
              maxLength={20}
            />
            <FieldRow
              phase={phase}
              locked={locked}
              label="Cidade"
              k="city"
              value={form.city}
              onChange={(v) => set("city", v)}
              maxLength={80}
            />
            <FieldRow
              phase={phase}
              locked={locked}
              label="UF"
              k="state"
              value={form.state}
              onChange={(v) => set("state", v.toUpperCase().slice(0, 2))}
              maxLength={2}
              placeholder="PR"
            />
            {/* A Receita não informa a inscrição municipal: é o único campo sempre aberto. */}
            {phase === "ok" ? (
              <UField label="Inscrição municipal" required>
                <div className={UROW}>
                  <input
                    value={form.municipalRegistration}
                    onChange={(e) =>
                      set("municipalRegistration", e.target.value.replace(/\D+/g, "").slice(0, 20))
                    }
                    inputMode="numeric"
                    placeholder="Somente números — não consta na Receita"
                    className={UINPUT_BARE}
                    aria-label="Inscrição municipal"
                  />
                </div>
              </UField>
            ) : (
              <UField label="Inscrição municipal" required>
                <div aria-disabled="true" className={`${UROW} text-[var(--faint)]`}>
                  —
                </div>
              </UField>
            )}
            <FieldRow
              phase={phase}
              locked={locked}
              label="Regime tributário"
              k="taxRegime"
              value={form.taxRegime}
              onChange={() => {}}
              format={(v) => TAX_REGIME_LABEL[v as TaxRegime] ?? v}
            >
              <select
                value={form.taxRegime}
                onChange={(e) => set("taxRegime", e.target.value as TaxRegime | "")}
                className={UINPUT_BARE}
                aria-label="Regime tributário"
              >
                <option value="">Selecione…</option>
                {(Object.keys(TAX_REGIME_LABEL) as TaxRegime[])
                  .filter((r) => r !== "simples_nacional" && r !== "mei")
                  .map((r) => (
                    <option key={r} value={r}>
                      {TAX_REGIME_LABEL[r]}
                    </option>
                  ))}
              </select>
            </FieldRow>
          </div>
        </section>
      ) : null}
    </>
  );
}
