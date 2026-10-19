import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { speakWithAgent } = await import("./src/lib/ai/outbound/speak.server");
const pergunta = "Pedro solicitou R$ 800 por 3 diárias (30/10 a 02/11) no Studio 104. Como deseja responder à proposta?";
const r = await speakWithAgent({
  supabase: admin as never,
  conversationId: "ca5df48d-a71c-4e33-b1d4-501b6cecf448",
  reason: "human_answer",
  pushTitle: "Resposta sobre o seu pedido",
  instruction:
    `A equipe respondeu internamente à sua pergunta "${pergunta}": "Recusar e manter valor padrão". ` +
    "Trate essa escolha como FATO verdadeiro, não como o texto a enviar. Responda como concierge de alto padrão: releia a conversa inteira e a pergunta real do hóspede, combine a decisão com os dados reais do imóvel e da reserva e conduza a conversa: se houver próximo passo natural, ofereça-o. Seja conciso e elegante, sem inventar nada fora das fontes. Não diga que consultou ninguém, não mencione equipe nem transferência.",
});
console.log(JSON.stringify({ sent: r.sent, skipped: r.skipped, messageId: r.messageId, text: r.text }));
if (r.sent) await admin.from("ai_human_escalations").update({ applied_to_guest: true }).eq("id", "a524fd65-4ca6-4be9-a575-a837430ef0ae");
