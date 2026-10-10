import type { ReactNode } from "react";
import { Copy, Link as LinkIcon, MapPin, Share2 } from "lucide-react";
import { toast } from "sonner";
import { addressWithComplement, type LocationComplementInput } from "@/lib/property-location";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * O BOTÃO DO MAPS DOS CARDS — um componente só.
 *
 * Regra (17/09 e 23/09/2026, pedido explícito): "todo e qualquer lugar que
 * tiver o nome do anúncio do imóvel precisa, obrigatoriamente, carregar o
 * nome do proprietário e o botão do maps que já implementamos". O botão é
 * SEMPRE este: "Copiar Link do Maps" / "Copiar Endereço" / "Abrir App", com
 * a garagem tendo prioridade sobre o endereço (logística).
 *
 * Extraído do `ArrivalCard` sem mudar nada (30/09/2026) porque o quadrante
 * "Acesso" da chave do card de limpeza também mostra o nome do imóvel — e,
 * pela regra acima, precisa do MESMO botão, não de uma cópia que divergiria
 * na primeira mudança.
 */
export function PropertyMapsButton({
  propertyName,
  propertyAddress,
  mapsUrl,
  garageMapsUrl,
  trigger,
  complement,
}: {
  propertyName: string | null;
  propertyAddress: string | null;
  mapsUrl: string | null;
  garageMapsUrl: string | null;
  /**
   * Outro GATILHO para o mesmo menu (01/10/2026): no editor de guia o Maps é a
   * metade "Localização" da peça partida ao meio (mockup aprovado). O menu e
   * o comportamento são os mesmos — só a cara do botão muda.
   */
  trigger?: ReactNode;
  /**
   * Local dentro do prédio (01/10/2026): com o condomínio ligado, "Copiar
   * Endereço" leva o apartamento, o andar, as vagas e o elevador na linha de
   * baixo. O link do Maps e o "Abrir App" não mudam.
   */
  complement?: LocationComplementInput | null;
}) {
  // Prefer garage address when available for logistics
  const mapsHref = propertyMapsHref({ propertyAddress, mapsUrl, garageMapsUrl });
  const copyText = mapsHref ?? propertyAddress ?? "";
  const copyLink = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };
  const copyAddress = async () => {
    if (!propertyAddress) return;
    try {
      await navigator.clipboard.writeText(addressWithComplement(propertyAddress, complement));
      toast.success("Endereço copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };
  // "Abrir App": deixa o próprio sistema oferecer os apps instalados no
  // celular (Google Maps, Waze, Uber, 99 etc.) via o share sheet nativo —
  // pedido explícito, substitui o antigo "Abrir o Google Maps" fixo.
  // Sem suporte a Web Share (ex.: desktop), cai de volta pro Google Maps.
  const openWithApp = () => {
    if (!mapsHref) return;
    if (typeof navigator.share === "function") {
      navigator
        .share({
          title: propertyName ?? "Endereço",
          text: propertyAddress ?? undefined,
          url: mapsHref,
        })
        .catch(() => {
          // Cancelado pelo usuário ou não suportado neste contexto — sem fallback forçado.
        });
      return;
    }
    window.open(mapsHref, "_blank", "noopener,noreferrer");
  };

  if (!mapsHref) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label="Opções do Maps"
            title={garageMapsUrl ? "Garagem no Maps" : "Endereço no Maps"}
            className="grid shrink-0 place-items-center rounded-[0.3rem] bg-[var(--chip-bg)] border border-border/50 hover:bg-primary/[0.08] size-7"
          >
            <MapPin className="size-3.5" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuItem onClick={copyLink} disabled={!copyText}>
          <LinkIcon className="size-3.5 shrink-0" /> Copiar Link do Maps
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copyAddress} disabled={!propertyAddress}>
          <Copy className="size-3.5 shrink-0" /> Copiar Endereço
        </DropdownMenuItem>
        <DropdownMenuItem onClick={openWithApp}>
          <Share2 className="size-3.5 shrink-0" /> Abrir App
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mesmo link que o botão usa — para a mensagem de WhatsApp do quadrante "Acesso". */
export function propertyMapsHref(p: {
  propertyAddress: string | null;
  mapsUrl: string | null;
  garageMapsUrl: string | null;
}): string | null {
  return (
    p.garageMapsUrl ??
    p.mapsUrl ??
    (p.propertyAddress
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.propertyAddress)}`
      : null)
  );
}
