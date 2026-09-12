// Detecção heurística de idioma (leve, client-safe) apenas para decidir se
// mostramos o botão "Traduzir". A tradução em si é feita pela IA.

const WORDS: Record<string, string[]> = {
  pt: ["não", "sim", "você", "obrigado", "obrigada", "por favor", "bom dia", "boa tarde", "boa noite", "chegada", "quarto", "está", "então", "com", "para", "muito", "aqui", "banheiro", "senha", "onde", "posso", "gostaria", "amanhã", "hoje"],
  es: ["gracias", "buenos días", "buenas tardes", "habitación", "está", "dónde", "puedo", "por favor", "mañana", "hola", "muchas", "quiero", "necesito", "también"],
  en: ["the", "thanks", "thank you", "please", "hello", "hi", "room", "where", "can i", "check in", "check-in", "tomorrow", "today", "would", "need", "we're", "i'm", "good morning"],
  fr: ["merci", "bonjour", "s'il vous plaît", "chambre", "où", "je peux", "demain", "aujourd'hui", "nous", "avec"],
  it: ["grazie", "buongiorno", "camera", "dove", "posso", "domani", "oggi", "per favore"],
  de: ["danke", "guten tag", "zimmer", "wo ist", "morgen", "heute", "bitte", "können"],
};

export function detectLanguage(input: string): string | null {
  const text = (input || "").toLowerCase().trim();
  if (text.length < 3) return null;

  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";

  const scores: Record<string, number> = {};
  for (const [lang, words] of Object.entries(WORDS)) {
    let score = 0;
    for (const w of words) {
      if (w.includes(" ")) {
        if (text.includes(w)) score += 2;
      } else if (new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "u").test(text)) {
        score += 1;
      }
    }
    scores[lang] = score;
  }
  // sinais ortográficos
  if (/[ãõçá-úâêô]/.test(text)) scores.pt = (scores.pt ?? 0) + 1;
  if (/[¿¡ñ]/.test(text)) scores.es = (scores.es ?? 0) + 2;
  if (/[àèùœç]/.test(text)) scores.fr = (scores.fr ?? 0) + 1;
  if (/[äöüß]/.test(text)) scores.de = (scores.de ?? 0) + 1;

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 2) return null;
  return best[0];
}

export function normalizeLang(tag: string | null | undefined): string {
  return (tag || "pt").toLowerCase().split(/[-_]/)[0];
}

/** Idioma do sistema/navegador do usuário. */
export function userLanguage(): string {
  if (typeof navigator === "undefined") return "pt";
  return normalizeLang(navigator.language);
}

export const LANG_NAMES: Record<string, string> = {
  pt: "português",
  en: "inglês",
  es: "espanhol",
  fr: "francês",
  it: "italiano",
  de: "alemão",
  ru: "russo",
  ar: "árabe",
  ja: "japonês",
  ko: "coreano",
  zh: "chinês",
};
