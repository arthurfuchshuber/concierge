/** Regras determinísticas para situações em que o modelo não pode decidir sozinho. */
export type GuestSafetyDecision =
  | { kind: "none"; reply: "" }
  | { kind: "credential_guidance"; reply: string }
  | { kind: "access_incident"; reply: string };

const ACCESS_INCIDENT =
  /\b(estou (?:no|na) port[aã]o|sem acesso|n[aã]o consigo (?:entrar|acessar)|(?:porta|port[aã]o|fechadura|cadeado|senha|c[oó]digo|pin)\s*(?:n[aã]o|nao)\s*(?:abre|abriu|funciona|aceita)|trancad[oa])\b/i;

const CREDENTIAL_REQUEST =
  /\b(senha(?: do)? (?:wi-?fi|port[aã]o|port[aã]ozinho|cadeado|cofre)|c[oó]digo(?: de)? (?:acesso|port[aã]o|fechadura|cofre)|pin|ver senha|qual (?:a )?senha)\b/i;

function guideLink(slug: string): string {
  return `/g/${encodeURIComponent(slug)}#senhas-acesso`;
}

export function guestSafetyDecision(message: string, propertySlug: string): GuestSafetyDecision {
  const link = guideLink(propertySlug);
  if (ACCESS_INCIDENT.test(message)) {
    return {
      kind: "access_incident",
      reply:
        `Entendi que você está sem acesso. Eu não consigo abrir portões, confirmar abertura remota ou validar códigos pelo chat. Consulte [Chegada e senhas de acesso](${link}) e siga as instruções de check-in exibidas ali; a equipe responsável acompanhará esta ocorrência por aqui.`,
    };
  }
  if (CREDENTIAL_REQUEST.test(message)) {
    return {
      kind: "credential_guidance",
      reply:
        `Para proteger seu acesso, não envio senhas ou códigos pelo chat. Abra [Ver senhas e códigos no guia](${link}) e siga as instruções de chegada mostradas ali — elas informam como o anfitrião libera a visualização.`,
    };
  }
  return { kind: "none", reply: "" };
}
