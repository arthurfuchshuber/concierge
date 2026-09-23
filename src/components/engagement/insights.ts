import type { EngagementAnalytics } from "@/lib/engagement-analytics.functions";

export type Insight = {
  severity: "positive" | "info" | "warn" | "critical";
  title: string;
  detail: string;
};

const SECTION_LABEL: Record<string, string> = {
  wifi: "Wi-Fi", checkin: "Check-in", checkout: "Check-out",
  house_rules: "Regras da casa", manual: "Manual", faqs: "FAQs",
  emergency: "Contatos de emergência", recommendations: "Recomendações",
  nearby: "Aqui pertinho", city: "Cidade", marketplace: "Parceiros", chat: "Chat IA",
};

export function labelFor(section: string): string {
  return SECTION_LABEL[section] ?? section.replace(/[_-]/g, " ");
}

// Insights gerenciais — sem "acessos subiram X%" nem "guia menos acessado".
export function computeInsights(a: EngagementAnalytics): Insight[] {
  const out: Insight[] = [];

  // Backlog crítico de IA
  if (a.kpis.openFeedback >= 3) {
    out.push({
      severity: "critical",
      title: `${a.kpis.openFeedback} respostas da IA marcadas como não úteis`,
      detail: "Ensine a IA a partir dessas conversas para reduzir insatisfação futura.",
    });
  }

  // Atrito alto no chat
  if (a.kpis.totalAccesses >= 20 && a.kpis.chatRate >= 50) {
    out.push({
      severity: "warn",
      title: `${a.kpis.chatRate}% das visitas viram conversa`,
      detail: "Sinal de que o guia deixa dúvidas óbvias em aberto. Reforce as seções mais buscadas.",
    });
  }

  // Sessões muito curtas
  if (a.kpis.uniqueSessions >= 20 && a.kpis.avgSessionSeconds > 0 && a.kpis.avgSessionSeconds < 45) {
    out.push({
      severity: "warn",
      title: `Sessão típica com apenas ${a.kpis.avgSessionSeconds}s`,
      detail: "Hóspedes abrem o guia mas saem rapidamente. Vale revisar hero, título e destaques.",
    });
  }

  // Guia auto-suficiente
  if (a.kpis.totalAccesses >= 30 && a.kpis.autoResolveRate >= 85) {
    out.push({
      severity: "positive",
      title: `Guia resolve ${a.kpis.autoResolveRate}% das visitas sem chat`,
      detail: "Excelente autonomia. Cheque o que está funcionando para replicar em outros imóveis.",
    });
  }

  // Seções silenciosas
  if (a.silentSections.length > 0) {
    out.push({
      severity: "info",
      title: `${a.silentSections.length} seção(ões) nunca acessadas no período`,
      detail: `Não receberam aberturas: ${a.silentSections.slice(0, 4).map(labelFor).join(", ")}${a.silentSections.length > 4 ? "…" : ""}.`,
    });
  }

  // Imóvel de alto atrito
  const noisy = a.perProperty.find((p) => p.sessions >= 10 && p.chatRate >= 55);
  if (noisy) {
    out.push({
      severity: "warn",
      title: `${noisy.name}: ${noisy.chatRate}% das visitas viram conversa`,
      detail: "Hóspedes desse imóvel dependem muito do chat. Reforce conteúdo do guia local.",
    });
  }

  return out;
}
