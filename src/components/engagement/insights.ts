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

export function computeInsights(a: EngagementAnalytics): Insight[] {
  const out: Insight[] = [];

  // Tendência de queda
  if (typeof a.kpis.accessesDelta === "number") {
    if (a.kpis.accessesDelta <= -25) {
      out.push({
        severity: "warn",
        title: `Acessos caíram ${Math.abs(a.kpis.accessesDelta)}%`,
        detail: "Comparado ao período anterior. Vale investigar mudanças recentes no envio do guia aos hóspedes.",
      });
    } else if (a.kpis.accessesDelta >= 30) {
      out.push({
        severity: "positive",
        title: `Acessos subiram ${a.kpis.accessesDelta}%`,
        detail: "Ótimo momento para revisar destaques do guia — mais gente lendo.",
      });
    }
  }

  // Auto-resolução
  if (a.kpis.totalAccesses >= 20) {
    if (a.kpis.autoResolveRate >= 90) {
      out.push({
        severity: "positive",
        title: `Guia resolve ${a.kpis.autoResolveRate}% das visitas sem chat`,
        detail: "Excelente autonomia. Cheque o que está funcionando para replicar em outros imóveis.",
      });
    } else if (a.kpis.chatRate >= 50) {
      out.push({
        severity: "warn",
        title: `${a.kpis.chatRate}% das visitas viram conversa`,
        detail: "Sinal de que o conteúdo do guia está deixando dúvidas óbvias em aberto. Reforce as seções mais buscadas.",
      });
    }
  }

  // Feedback backlog
  if (a.kpis.openFeedback >= 5) {
    out.push({
      severity: "critical",
      title: `${a.kpis.openFeedback} respostas da IA marcadas como não úteis`,
      detail: "Ensine a IA a partir dessas conversas para reduzir insatisfação futura.",
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

  // Hotspot
  const hot = a.sections[0];
  if (hot && hot.opens >= 10) {
    out.push({
      severity: "info",
      title: `"${labelFor(hot.section)}" é a seção mais consumida`,
      detail: `${hot.opens} aberturas — mantenha essa informação impecável e destacada.`,
    });
  }

  // Imóvel com atrito alto (perProperty)
  const noisy = a.perProperty.find((p) => p.accesses >= 15 && p.chatRate >= 55);
  if (noisy) {
    out.push({
      severity: "warn",
      title: `${noisy.name}: ${noisy.chatRate}% das visitas viram conversa`,
      detail: "Hóspedes desse imóvel dependem muito do chat. Reforce conteúdo do guia local.",
    });
  }

  // Guia completo mas pouco usado
  const overlooked = a.perProperty.find((p) => p.completeness >= 80 && p.accesses <= 2);
  if (overlooked) {
    out.push({
      severity: "info",
      title: `${overlooked.name}: guia completo, pouco acessado`,
      detail: `Completude ${overlooked.completeness}/100 mas só ${overlooked.accesses} acesso(s). Verifique o envio do link ao hóspede.`,
    });
  }

  // Guia com muitos acessos mas baixa completude
  const underinvested = a.perProperty.find((p) => p.completeness <= 40 && p.accesses >= 10);
  if (underinvested) {
    out.push({
      severity: "warn",
      title: `${underinvested.name}: demanda real, conteúdo escasso`,
      detail: `${underinvested.accesses} acessos, completude ${underinvested.completeness}/100. Vale investir tempo nesse guia primeiro.`,
    });
  }

  return out;
}
