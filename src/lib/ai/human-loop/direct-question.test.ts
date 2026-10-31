import { it, expect } from "vitest";
import { directQuestion } from "./handoff-draft.server";
it("directQuestion remove introdução narrativa e sentimento", () => {
  for (const [i,o] of [
   ["Hóspede calmo pergunta sobre check-in antecipado às 12:36. Autoriza?","check-in antecipado às 12:36. Autoriza?"],
   ["Hóspede (ansioso) pergunta sobre o wifi","wifi"],
   ["O hóspede gostaria de saber se pode ficar até 14h","pode ficar até 14h"],
   ["Pergunta da IA: Posso liberar?","Posso liberar?"],
   ["Dúvida: Onde fica o cobertor?","Onde fica o cobertor?"],
  ]) expect(directQuestion(i)).toBe(o);
});
