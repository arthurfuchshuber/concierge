import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMyProperty, upsertProperty } from "@/lib/properties.functions";
import { enrichFromMapsLink } from "@/lib/maps.functions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Sparkles, Plus, Trash2, MapPin, ArrowLeft, FileText, KeyRound, Home, Compass, LifeBuoy, Check } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/properties/$id")({
  component: PropertyEditor,
});

type RecItem = {
  scope: "nearby" | "city";
  type: string;
  name: string;
  category?: string | null;
  rating?: number | null;
  distance_text?: string | null;
  distance_meters?: number | null;
  drive_minutes?: number | null;
  note?: string | null;
  image_url?: string | null;
  maps_url?: string | null;
  place_id?: string | null;
};

type FormState = {
  property: {
    name: string;
    slug: string;
    tagline: string;
    hero_image_url: string;
    gallery_images: string[];
    address: string;
    maps_url: string;
    lat: number | null;
    lng: number | null;
    city: string;
    country: string;
    checkin_time: string;
    checkout_time: string;
    lock_code: string;
    gate_code: string;
    address_note: string;
    wifi_ssid: string;
    wifi_password: string;
    host_name: string;
    host_phone: string;
    access_mode: "public" | "pin";
    pin_code: string;
    pin_expires_at: string;
    default_language: "pt" | "en";
    published: boolean;
  };
  manual: { title: string; description: string; body: string }[];
  emergency: { label: string; number: string }[];
  faqs: { question: string; answer: string }[];
  checkout: { label: string }[];
  recommendations: RecItem[];
};

function emptyForm(): FormState {
  return {
    property: {
      name: "", slug: "", tagline: "", hero_image_url: "", address: "", maps_url: "",
      lat: null, lng: null, city: "", country: "", checkin_time: "15:00", checkout_time: "11:00",
      lock_code: "", gate_code: "", address_note: "", wifi_ssid: "", wifi_password: "",
      host_name: "", host_phone: "", access_mode: "public", pin_code: "", pin_expires_at: "",
      default_language: "pt", published: true,
    },
    manual: [],
    emergency: [{ label: "Polícia", number: "190" }, { label: "Bombeiros / SAMU", number: "192" }],
    faqs: [],
    checkout: [],
    recommendations: [],
  };
}

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function PropertyEditor() {
  const { id } = Route.useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const fetchProp = useServerFn(getMyProperty);
  const save = useServerFn(upsertProperty);
  const enrich = useServerFn(enrichFromMapsLink);

  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [step, setStep] = useState<string>("basics");
  const [enriching, setEnriching] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["property", id],
    queryFn: () => fetchProp({ data: { id } }),
    enabled: !isNew,
  });

  useEffect(() => {
    if (!data || isNew) return;
    const p = data.property as Record<string, unknown> | null;
    if (!p) return;
    setForm({
      property: {
        name: (p.name as string) ?? "",
        slug: (p.slug as string) ?? "",
        tagline: (p.tagline as string) ?? "",
        hero_image_url: (p.hero_image_url as string) ?? "",
        address: (p.address as string) ?? "",
        maps_url: (p.maps_url as string) ?? "",
        lat: (p.lat as number) ?? null,
        lng: (p.lng as number) ?? null,
        city: (p.city as string) ?? "",
        country: (p.country as string) ?? "",
        checkin_time: (p.checkin_time as string) ?? "15:00",
        checkout_time: (p.checkout_time as string) ?? "11:00",
        lock_code: (p.lock_code as string) ?? "",
        gate_code: (p.gate_code as string) ?? "",
        address_note: (p.address_note as string) ?? "",
        wifi_ssid: (p.wifi_ssid as string) ?? "",
        wifi_password: (p.wifi_password as string) ?? "",
        host_name: (p.host_name as string) ?? "",
        host_phone: (p.host_phone as string) ?? "",
        access_mode: ((p.access_mode as "public" | "pin") ?? "public"),
        pin_code: (p.pin_code as string) ?? "",
        pin_expires_at: p.pin_expires_at ? new Date(p.pin_expires_at as string).toISOString().slice(0, 16) : "",
        default_language: ((p.default_language as "pt" | "en") ?? "pt"),
        published: (p.published as boolean) ?? true,
      },
      manual: (data.manual ?? []).map((m: Record<string, unknown>) => ({
        title: (m.title as string) ?? "",
        description: (m.description as string) ?? "",
        body: (m.body as string) ?? "",
      })),
      emergency: (data.emergency ?? []).map((m: Record<string, unknown>) => ({
        label: (m.label as string) ?? "",
        number: (m.number as string) ?? "",
      })),
      faqs: (data.faqs ?? []).map((m: Record<string, unknown>) => ({
        question: (m.question as string) ?? "",
        answer: (m.answer as string) ?? "",
      })),
      checkout: (data.checkout ?? []).map((m: Record<string, unknown>) => ({
        label: (m.label as string) ?? "",
      })),
      recommendations: (data.recommendations ?? []).map((r: Record<string, unknown>) => ({
        scope: r.scope as "nearby" | "city",
        type: r.type as string,
        name: (r.name as string) ?? "",
        category: (r.category as string) ?? null,
        rating: (r.rating as number) ?? null,
        distance_text: (r.distance_text as string) ?? null,
        distance_meters: (r.distance_meters as number) ?? null,
        drive_minutes: (r.drive_minutes as number) ?? null,
        note: (r.note as string) ?? null,
        image_url: (r.image_url as string) ?? null,
        maps_url: (r.maps_url as string) ?? null,
        place_id: (r.place_id as string) ?? null,
      })),
    });
  }, [data, isNew]);

  function update<K extends keyof FormState["property"]>(key: K, value: FormState["property"][K]) {
    setForm((f) => ({ ...f, property: { ...f.property, [key]: value } }));
  }

  async function handleEnrich() {
    if (!form.property.maps_url) {
      toast.error("Cole o link do Google Maps primeiro");
      return;
    }
    setEnriching(true);
    try {
      const r = await enrich({ data: { mapsUrl: form.property.maps_url } });
      setForm((f) => ({
        ...f,
        property: {
          ...f.property,
          address: r.address || f.property.address,
          lat: r.lat,
          lng: r.lng,
          city: r.city || f.property.city,
          country: r.country || f.property.country,
          tagline: f.property.tagline || r.tagline || f.property.tagline,
          hero_image_url: f.property.hero_image_url || r.hero_image_url || f.property.hero_image_url,
        },
        recommendations: r.recommendations.map((rec) => ({
          scope: rec.scope,
          type: rec.type,
          name: rec.name,
          category: rec.category,
          rating: rec.rating,
          distance_text: rec.distance_text,
          distance_meters: rec.distance_meters,
          drive_minutes: rec.drive_minutes,
          image_url: rec.image_url,
          maps_url: rec.maps_url,
          place_id: rec.place_id,
          note: null,
        })),
      }));
      const nearby = r.recommendations.filter((x) => x.scope === "nearby").length;
      const city = r.recommendations.filter((x) => x.scope === "city").length;
      const extras: string[] = [];
      if (r.tagline) extras.push("descrição");
      if (r.hero_image_url) extras.push("foto de capa");
      const extraStr = extras.length ? ` · ${extras.join(" + ")}` : "";
      toast.success(`Preenchido! ${nearby} arredores · ${city} pela cidade${extraStr}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enriquecer");
    } finally {
      setEnriching(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        id: isNew ? null : id,
        property: {
          ...form.property,
          slug: form.property.slug || slugify(form.property.name),
          tagline: form.property.tagline || null,
          hero_image_url: form.property.hero_image_url || null,
          address: form.property.address || null,
          maps_url: form.property.maps_url || null,
          city: form.property.city || null,
          country: form.property.country || null,
          checkin_time: form.property.checkin_time || null,
          checkout_time: form.property.checkout_time || null,
          lock_code: form.property.lock_code || null,
          gate_code: form.property.gate_code || null,
          address_note: form.property.address_note || null,
          wifi_ssid: form.property.wifi_ssid || null,
          wifi_password: form.property.wifi_password || null,
          host_name: form.property.host_name || null,
          host_phone: form.property.host_phone || null,
          pin_code: form.property.access_mode === "pin" ? (form.property.pin_code || null) : null,
          pin_expires_at: form.property.access_mode === "pin" && form.property.pin_expires_at
            ? new Date(form.property.pin_expires_at).toISOString()
            : null,
        },
        recommendations: form.recommendations,
        manual: form.manual.filter((m) => m.title),
        emergency: form.emergency.filter((m) => m.label && m.number),
        faqs: form.faqs.filter((m) => m.question && m.answer),
        checkout: form.checkout.filter((m) => m.label),
      };
      const r = await save({ data: payload });
      toast.success("Guia salvo");
      if (isNew) navigate({ to: "/admin/properties/$id", params: { id: r.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (!isNew && isLoading) {
    return <div className="max-w-4xl mx-auto px-6 py-10 text-sm text-muted-foreground">Carregando…</div>;
  }

  const nearbyRecs = form.recommendations.filter((r) => r.scope === "nearby");
  const cityRecs = form.recommendations.filter((r) => r.scope === "city");

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 pb-32">
      <Link to="/admin" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="size-3.5" /> Voltar
      </Link>
      <div className="flex items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">
            {isNew ? "Novo guia" : "Editar guia"}
          </p>
          <h1 className="font-serif text-4xl">{form.property.name || "Sem título"}</h1>
        </div>
      </div>

      <Tabs value={step} onValueChange={setStep}>
        <Stepper
          current={step}
          onChange={setStep}
          steps={[
            { value: "basics", label: "Básico", icon: FileText },
            { value: "access", label: "Acesso", icon: KeyRound },
            { value: "house", label: "A casa", icon: Home },
            { value: "recs", label: "Recomendações", icon: Compass },
            { value: "extras", label: "Extras", icon: LifeBuoy },
          ]}
        />


        <TabsContent value="basics" className="space-y-5 mt-6">
          <Section title="Identificação">
            <Field label="Nome do imóvel" required>
              <Input value={form.property.name} maxLength={120}
                onChange={(e) => { update("name", e.target.value); if (isNew && !form.property.slug) update("slug", slugify(e.target.value)); }} />
            </Field>
            <Field label="URL pública (slug)" hint="Aparece em /g/seu-slug">
              <Input value={form.property.slug} maxLength={60} onChange={(e) => update("slug", slugify(e.target.value))} />
            </Field>
            <Field label="Tagline" hint="Frase curta abaixo do título">
              <Input value={form.property.tagline} maxLength={200} onChange={(e) => update("tagline", e.target.value)} />
            </Field>
            <Field label="URL da imagem hero" hint="Foto principal (URL pública)">
              <Input value={form.property.hero_image_url} onChange={(e) => update("hero_image_url", e.target.value)} placeholder="https://..." />
            </Field>
          </Section>

          <Section title="Endereço e auto-preenchimento" desc="Cole o link do Google Maps do imóvel e clique em 'Auto-preencher' para obter endereço, coordenadas e pontos de interesse.">
            <Field label="Link do Google Maps" required>
              <div className="flex gap-2">
                <Input value={form.property.maps_url} onChange={(e) => update("maps_url", e.target.value)} placeholder="https://maps.app.goo.gl/..." />
                <Button onClick={handleEnrich} disabled={enriching} variant="secondary" className="shrink-0">
                  {enriching ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  <span className="ml-1.5 hidden sm:inline">{enriching ? "Buscando…" : "Auto-preencher"}</span>
                </Button>
              </div>
            </Field>
            <Field label="Endereço">
              <Input value={form.property.address} onChange={(e) => update("address", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cidade"><Input value={form.property.city} onChange={(e) => update("city", e.target.value)} /></Field>
              <Field label="País"><Input value={form.property.country} onChange={(e) => update("country", e.target.value)} /></Field>
            </div>
            <Field label="Observação sobre o endereço" hint="Ponto de referência, instruções para o motorista, etc.">
              <Textarea value={form.property.address_note} maxLength={1000} onChange={(e) => update("address_note", e.target.value)} />
            </Field>
          </Section>
        </TabsContent>

        <TabsContent value="access" className="space-y-5 mt-6">
          <Section title="Visibilidade">
            <div className="flex items-center justify-between border border-border rounded-xl p-4">
              <div>
                <p className="text-sm font-medium">Publicar guia</p>
                <p className="text-xs text-muted-foreground">Quando desativado, o guia não fica acessível para hóspedes.</p>
              </div>
              <Switch checked={form.property.published} onCheckedChange={(v) => update("published", v)} />
            </div>

            <Field label="Modo de acesso">
              <Select value={form.property.access_mode} onValueChange={(v) => update("access_mode", v as "public" | "pin")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">URL pública (qualquer um com o link vê)</SelectItem>
                  <SelectItem value="pin">Protegido por código (PIN)</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {form.property.access_mode === "pin" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Código de acesso" required>
                  <Input value={form.property.pin_code} maxLength={20} onChange={(e) => update("pin_code", e.target.value)} placeholder="ex: 4729" />
                </Field>
                <Field label="Expira em" hint="Deixe em branco para nunca expirar">
                  <Input type="datetime-local" value={form.property.pin_expires_at} onChange={(e) => update("pin_expires_at", e.target.value)} />
                </Field>
              </div>
            )}

            <Field label="Idioma padrão">
              <Select value={form.property.default_language} onValueChange={(v) => update("default_language", v as "pt" | "en")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt">Português</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </Section>
        </TabsContent>

        <TabsContent value="house" className="space-y-5 mt-6">
          <Section title="Horários">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Check-in a partir de"><Input value={form.property.checkin_time} maxLength={5} onChange={(e) => update("checkin_time", e.target.value)} placeholder="15:00" /></Field>
              <Field label="Check-out até"><Input value={form.property.checkout_time} maxLength={5} onChange={(e) => update("checkout_time", e.target.value)} placeholder="11:00" /></Field>
            </div>
          </Section>

          <Section title="Entrada">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Código do portão"><Input value={form.property.gate_code} maxLength={40} onChange={(e) => update("gate_code", e.target.value)} /></Field>
              <Field label="Código da fechadura"><Input value={form.property.lock_code} maxLength={40} onChange={(e) => update("lock_code", e.target.value)} /></Field>
            </div>
          </Section>

          <Section title="Wi-Fi">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rede (SSID)"><Input value={form.property.wifi_ssid} maxLength={64} onChange={(e) => update("wifi_ssid", e.target.value)} /></Field>
              <Field label="Senha"><Input value={form.property.wifi_password} maxLength={64} onChange={(e) => update("wifi_password", e.target.value)} /></Field>
            </div>
          </Section>

          <Section title="Contato do anfitrião">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome"><Input value={form.property.host_name} maxLength={120} onChange={(e) => update("host_name", e.target.value)} /></Field>
              <Field label="Telefone (WhatsApp)"><Input value={form.property.host_phone} maxLength={40} onChange={(e) => update("host_phone", e.target.value)} /></Field>
            </div>
          </Section>

          <Section title="Manual da casa" action={<AddBtn onClick={() => setForm((f) => ({ ...f, manual: [...f.manual, { title: "", description: "", body: "" }] }))} />}>
            {form.manual.map((m, i) => (
              <ItemCard key={i} onRemove={() => setForm((f) => ({ ...f, manual: f.manual.filter((_, j) => j !== i) }))}>
                <Input placeholder="Título (ex: Ar-condicionado)" value={m.title} maxLength={120}
                  onChange={(e) => setForm((f) => ({ ...f, manual: f.manual.map((x, j) => j === i ? { ...x, title: e.target.value } : x) }))} />
                <Input placeholder="Descrição curta" value={m.description} maxLength={300}
                  onChange={(e) => setForm((f) => ({ ...f, manual: f.manual.map((x, j) => j === i ? { ...x, description: e.target.value } : x) }))} />
                <Textarea placeholder="Instruções detalhadas" value={m.body} maxLength={4000}
                  onChange={(e) => setForm((f) => ({ ...f, manual: f.manual.map((x, j) => j === i ? { ...x, body: e.target.value } : x) }))} />
              </ItemCard>
            ))}
          </Section>

          <Section title="Checklist de check-out" action={<AddBtn onClick={() => setForm((f) => ({ ...f, checkout: [...f.checkout, { label: "" }] }))} />}>
            {form.checkout.map((c, i) => (
              <ItemCard key={i} onRemove={() => setForm((f) => ({ ...f, checkout: f.checkout.filter((_, j) => j !== i) }))}>
                <Input placeholder="ex: Trancar a porta" value={c.label} maxLength={200}
                  onChange={(e) => setForm((f) => ({ ...f, checkout: f.checkout.map((x, j) => j === i ? { label: e.target.value } : x) }))} />
              </ItemCard>
            ))}
          </Section>
        </TabsContent>

        <TabsContent value="recs" className="space-y-5 mt-6">
          <p className="text-sm text-muted-foreground">
            Recomendações vêm do auto-preenchimento do Google Maps. Você pode editar, remover ou adicionar manualmente.
          </p>
          <RecGroup
            title="Aqui pertinho (arredores do imóvel)"
            desc="A poucos minutos a pé"
            items={nearbyRecs}
            onChange={(items) => setForm((f) => ({ ...f, recommendations: [...items, ...cityRecs] }))}
            scope="nearby"
          />
          <RecGroup
            title="Pela cidade"
            desc="Vale a visita — alguns minutos de carro"
            items={cityRecs}
            onChange={(items) => setForm((f) => ({ ...f, recommendations: [...nearbyRecs, ...items] }))}
            scope="city"
          />
        </TabsContent>

        <TabsContent value="extras" className="space-y-5 mt-6">
          <Section title="Emergências" action={<AddBtn onClick={() => setForm((f) => ({ ...f, emergency: [...f.emergency, { label: "", number: "" }] }))} />}>
            {form.emergency.map((m, i) => (
              <ItemCard key={i} onRemove={() => setForm((f) => ({ ...f, emergency: f.emergency.filter((_, j) => j !== i) }))}>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Rótulo" value={m.label} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, emergency: f.emergency.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                  <Input placeholder="Número" value={m.number} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, emergency: f.emergency.map((x, j) => j === i ? { ...x, number: e.target.value } : x) }))} />
                </div>
              </ItemCard>
            ))}
          </Section>

          <Section title="FAQ" action={<AddBtn onClick={() => setForm((f) => ({ ...f, faqs: [...f.faqs, { question: "", answer: "" }] }))} />}>
            {form.faqs.map((m, i) => (
              <ItemCard key={i} onRemove={() => setForm((f) => ({ ...f, faqs: f.faqs.filter((_, j) => j !== i) }))}>
                <Input placeholder="Pergunta" value={m.question} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, faqs: f.faqs.map((x, j) => j === i ? { ...x, question: e.target.value } : x) }))} />
                <Textarea placeholder="Resposta" value={m.answer} maxLength={2000} onChange={(e) => setForm((f) => ({ ...f, faqs: f.faqs.map((x, j) => j === i ? { ...x, answer: e.target.value } : x) }))} />
              </ItemCard>
            ))}
          </Section>
        </TabsContent>
      </Tabs>

      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/90 backdrop-blur p-4 z-50">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const order = ["basics", "access", "house", "recs", "extras"];
                const i = order.indexOf(step);
                if (i > 0) setStep(order[i - 1]);
              }}
              disabled={step === "basics"}
            >
              <ArrowLeft className="size-3.5 mr-1" /> Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const order = ["basics", "access", "house", "recs", "extras"];
                const i = order.indexOf(step);
                if (i < order.length - 1) setStep(order[i + 1]);
              }}
              disabled={step === "extras"}
            >
              Próximo <ArrowLeft className="size-3.5 ml-1 rotate-180" />
            </Button>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="ghost" onClick={() => navigate({ to: "/admin" })}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.property.name}>
              {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
              Salvar guia
            </Button>
          </div>
        </div>
      </div>

    </div>
  );
}

function Section({ title, desc, action, children }: { title: string; desc?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
        </div>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label} {required && <span className="text-destructive">*</span>}</Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function AddBtn({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} className="shrink-0">
      <Plus className="size-3.5 mr-1" /> Adicionar
    </Button>
  );
}

function ItemCard({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="bg-secondary/40 rounded-xl p-3 space-y-2 relative">
      {children}
      <button onClick={onRemove} className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

function RecGroup({ title, desc, items, onChange, scope }: { title: string; desc: string; items: RecItem[]; onChange: (i: RecItem[]) => void; scope: "nearby" | "city" }) {
  return (
    <Section
      title={title}
      desc={desc}
      action={<AddBtn onClick={() => onChange([...items, { scope, type: "restaurant", name: "" }])} />}
    >
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Nenhuma recomendação. Use o auto-preenchimento ou adicione manualmente.</p>
      ) : items.map((r, i) => (
        <ItemCard key={i} onRemove={() => onChange(items.filter((_, j) => j !== i))}>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input placeholder="Nome" value={r.name} maxLength={200}
              onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <Select value={r.type} onValueChange={(v) => onChange(items.map((x, j) => j === i ? { ...x, type: v } : x))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["restaurant","bar","cafe","beach","attraction","market","pharmacy","park","nightlife","shopping","other"].map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Distância (texto)" value={r.distance_text ?? ""} maxLength={80}
              onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, distance_text: e.target.value } : x))} />
            <Input placeholder="Link Maps" value={r.maps_url ?? ""} maxLength={2048}
              onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, maps_url: e.target.value } : x))} />
          </div>
          <Textarea placeholder="Nota pessoal (opcional)" value={r.note ?? ""} maxLength={1000}
            onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} />
          {r.image_url && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="size-3" /> {r.category} {r.rating ? `· ★ ${r.rating}` : ""}
            </div>
          )}
        </ItemCard>
      ))}
    </Section>
  );
}

function Stepper({
  steps,
  current,
  onChange,
}: {
  steps: { value: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[];
  current: string;
  onChange: (v: string) => void;
}) {
  const currentIdx = steps.findIndex((s) => s.value === current);
  return (
    <div className="mb-6">
      <div className="overflow-x-auto no-scrollbar -mx-2 px-2">
        <div className="flex items-center gap-2 min-w-max">
          {steps.map((s, i) => {
            const done = i < currentIdx;
            const active = i === currentIdx;
            const Icon = s.icon;
            return (
              <div key={s.value} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChange(s.value)}
                  className={[
                    "group inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-all border",
                    active
                      ? "bg-primary text-primary-foreground border-primary shadow-soft"
                      : done
                      ? "bg-accent/10 text-foreground border-accent/30 hover:bg-accent/15"
                      : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "grid place-items-center size-5 rounded-full shrink-0",
                      active
                        ? "bg-primary-foreground/15"
                        : done
                        ? "bg-accent text-accent-foreground"
                        : "bg-secondary",
                    ].join(" ")}
                  >
                    {done ? (
                      <Check className="size-3" strokeWidth={2.5} />
                    ) : (
                      <Icon className="size-3" strokeWidth={2} />
                    )}
                  </span>
                  {s.label}
                </button>
                {i < steps.length - 1 && (
                  <span
                    className={[
                      "h-px w-6 sm:w-10 shrink-0 transition-colors",
                      i < currentIdx ? "bg-accent/40" : "bg-border",
                    ].join(" ")}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-semibold mt-3">
        Passo {currentIdx + 1} de {steps.length}
      </p>
    </div>
  );
}
