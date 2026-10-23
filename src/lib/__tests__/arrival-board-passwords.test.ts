import { describe, expect, it } from "vitest";
import {
  addSeen,
  messageHasAccessCode,
  newPasswordSeen,
  registerPasswordEvent,
  resolveViewedPasswords,
  sawPasswords,
} from "@/lib/arrival-passwords";

const PID = "prop-1";
const BOTH: Array<"lock" | "gate"> = ["lock", "gate"];

const base = {
  checkinDone: false,
  accessCodes: BOTH,
  propertyId: PID,
  name: "Maria Silva",
  phone: "+55 45 99999-1234",
};

describe("viewedPasswords — falsos 'Não viu as senhas'", () => {
  it("sem nenhum registro e check-in pendente: continua pendente (alerta legítimo)", () => {
    const seen = newPasswordSeen();
    expect(resolveViewedPasswords({ ...base, seen })).toBe(false);
  });

  it("concluiu a etapa de senhas do onboarding → viu fechadura E portão", () => {
    const seen = newPasswordSeen();
    registerPasswordEvent(seen, "senhas:onboarding", PID, "Maria Silva", "+55 45 99999-1234");
    expect(resolveViewedPasswords({ ...base, seen })).toBe(true);
    // cada tipo também fica registrado
    expect(sawPasswords(["lock"], seen, PID, "Maria Silva", null)).toBe(true);
    expect(sawPasswords(["gate"], seen, PID, "Maria Silva", null)).toBe(true);
  });

  it("viu só a fechadura (👁) já basta — não penaliza quem viu em lote", () => {
    const seen = newPasswordSeen();
    registerPasswordEvent(seen, "senhas:lock", PID, "Maria Silva", null);
    expect(resolveViewedPasswords({ ...base, seen })).toBe(true);
  });

  it("evento legado 'senhas' continua valendo", () => {
    const seen = newPasswordSeen();
    registerPasswordEvent(seen, "senhas", PID, "Maria Silva", null);
    expect(resolveViewedPasswords({ ...base, seen })).toBe(true);
  });

  it("reserva SEM guide_access_logs: cruza pelo nome/telefone da própria reserva", () => {
    const seen = newPasswordSeen();
    // o evento do guia foi gravado com o telefone da reserva
    registerPasswordEvent(seen, "senhas:onboarding", PID, null, "(45) 99999-1234");
    expect(
      resolveViewedPasswords({
        ...base,
        name: "Reserva Airbnb", // nome genérico, sem match por nome
        phone: "+55 45 99999-1234", // mesmo telefone (8 últimos dígitos)
        seen,
      }),
    ).toBe(true);

    const seenByName = newPasswordSeen();
    registerPasswordEvent(seenByName, "senhas:lock", PID, "maria silva", null);
    expect(resolveViewedPasswords({ ...base, phone: null, seen: seenByName })).toBe(true);
  });

  it("evento de OUTRO imóvel ou de OUTRO hóspede não conta", () => {
    const seen = newPasswordSeen();
    registerPasswordEvent(seen, "senhas:onboarding", "outro-imovel", "Maria Silva", "+55 45 99999-1234");
    registerPasswordEvent(seen, "senhas:onboarding", PID, "João Souza", "+55 11 98888-0000");
    expect(resolveViewedPasswords({ ...base, seen })).toBe(false);
  });

  it("check-in concluído (done) NUNCA reporta false, mesmo sem nenhum evento", () => {
    const seen = newPasswordSeen();
    expect(resolveViewedPasswords({ ...base, checkinDone: true, seen })).toBe(true);
    expect(resolveViewedPasswords({ ...base, checkinDone: true, accessCodes: ["lock"], name: null, phone: null, seen })).toBe(true);
  });

  it("imóvel sem senha de acesso: nada a alertar", () => {
    expect(resolveViewedPasswords({ ...base, accessCodes: [], seen: newPasswordSeen() })).toBe(true);
  });

  it("credencial entregue no chat reconhece as senhas como vistas", () => {
    // por reserva (conversa ligada à reserva)
    expect(resolveViewedPasswords({ ...base, seen: newPasswordSeen(), chatDeliveredToReservation: true })).toBe(true);

    // por nome do hóspede da conversa (sem reservation_id)
    const seen = newPasswordSeen();
    addSeen(seen.chat, PID, "Maria Silva", null);
    expect(resolveViewedPasswords({ ...base, phone: null, seen })).toBe(true);
  });
});

describe("messageHasAccessCode", () => {
  it("detecta o código da fechadura ou do portão na mensagem", () => {
    expect(messageHasAccessCode("A senha da porta é 4821#, bem-vindo!", ["4821#", "9090"])).toBe(true);
    expect(messageHasAccessCode("Portão: 9090", ["4821#", "9090"])).toBe(true);
  });
  it("ignora mensagens sem código, vazias e códigos curtos demais", () => {
    expect(messageHasAccessCode("Bem-vindo! Qualquer dúvida é só chamar.", ["4821#"])).toBe(false);
    expect(messageHasAccessCode("", ["4821#"])).toBe(false);
    expect(messageHasAccessCode(null, ["4821#"])).toBe(false);
    expect(messageHasAccessCode("chegue às 15h", ["15"])).toBe(false);
    expect(messageHasAccessCode("qualquer coisa", [null, undefined, ""])).toBe(false);
  });
  it("não diferencia maiúsculas de minúsculas", () => {
    expect(messageHasAccessCode("Código: ABC123", ["abc123"])).toBe(true);
  });
});
