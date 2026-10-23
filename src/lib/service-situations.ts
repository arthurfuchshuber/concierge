// Situações da aba Serviços (Dashboard › Financeiro) — tipos e helpers puros,
// usados no cliente e no servidor.
//
// As quatro do sistema (Limpeza, Manutenção, Danos, Outro) não têm lápis nem
// lixeira. As demais são criadas pelo usuário ("Adicionar situação").
export type SystemSituationKey = "cleaning" | "maintenance" | "damage" | "other";

export const SYSTEM_SITUATIONS: ReadonlyArray<{
  key: SystemSituationKey;
  name: string;
  detail: string;
}> = [
  { key: "cleaning", name: "Limpeza", detail: "Nova limpeza de um imóvel ou reserva" },
  { key: "maintenance", name: "Manutenção", detail: "Reparo ou serviço no imóvel" },
  { key: "damage", name: "Danos", detail: "Cobrança por dano causado" },
  { key: "other", name: "Outro", detail: "Outra situação financeira" },
];

export type ServiceSituation = {
  /** Chave do sistema ou uuid da situação própria. */
  id: string;
  name: string;
  detail: string | null;
  system: boolean;
};

export const SITUATION_NAME_MAX = 60;
export const SITUATION_DETAIL_MAX = 300;

const LOWER_WORDS = new Set(["de", "da", "do", "das", "dos", "e"]);

/** "troca de lampada e fechadura" → "Troca de Lampada e Fechadura". */
export function titleCaseSituation(raw: string): string {
  const words = raw.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  return words
    .map((w, i) => {
      const lw = w.toLocaleLowerCase("pt-BR");
      if (i > 0 && LOWER_WORDS.has(lw)) return lw;
      return lw.charAt(0).toLocaleUpperCase("pt-BR") + lw.slice(1);
    })
    .join(" ");
}

export function isSystemSituation(id: string): id is SystemSituationKey {
  return SYSTEM_SITUATIONS.some((s) => s.key === id);
}

/** Uma ocorrência de serviço (não-limpeza) concluída — alimenta tabela do dia. */
export type ExtraServiceItem = {
  id: string;
  date: string;
  propertyId: string;
  propertyName: string;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
  situation: string;
  situationName: string;
  title: string;
  priceCents: number | null;
  concludedAt: string | null;
  doneByName: string | null;
  logId: string | null;
  reservationId: string | null;
};
