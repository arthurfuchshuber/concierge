import { describe, it, expect } from "vitest";
import { ASAAS_ITEM_ID, asaasItem, formatBankAccount, onlyBanks, pickMainAccount } from "../bank-account-label";

describe("formatBankAccount", () => {
  it("separa agência e conta do transferNumber", () => {
    expect(formatBankAccount({ malvo_item_id: "a", bank_data: { transferNumber: "0050/00877408-7" } })).toBe(
      "Ag. 0050 · 00877408-7",
    );
  });
  it("sem barra devolve o número como veio", () => {
    expect(formatBankAccount({ malvo_item_id: "a", number: "409849764-4" })).toBe("409849764-4");
  });
  it("usa number quando não há transferNumber", () => {
    expect(formatBankAccount({ malvo_item_id: "a", number: "0001/409849764-4", bank_data: {} })).toBe(
      "Ag. 0001 · 409849764-4",
    );
  });
  it("sem dados devolve null", () => {
    expect(formatBankAccount({ malvo_item_id: "a" })).toBeNull();
  });
});

describe("pickMainAccount", () => {
  it("prefere a conta corrente do item", () => {
    const accs = [
      { malvo_item_id: "a", type: "CREDIT", subtype: "CREDIT_CARD", number: "9366" },
      { malvo_item_id: "a", type: "BANK", subtype: "CHECKING_ACCOUNT", number: "0050/1" },
      { malvo_item_id: "b", type: "BANK", subtype: "CHECKING_ACCOUNT", number: "0001/2" },
    ];
    expect(pickMainAccount(accs, "a")?.number).toBe("0050/1");
  });
  it("devolve null quando o item não tem contas", () => {
    expect(pickMainAccount([], "a")).toBeNull();
  });
});

describe("onlyBanks / asaasItem", () => {
  const items = [{ malvo_item_id: "x" }, { malvo_item_id: ASAAS_ITEM_ID }];
  it("separa bancos do Asaas", () => {
    expect(onlyBanks(items)).toEqual([{ malvo_item_id: "x" }]);
    expect(asaasItem(items)).toEqual({ malvo_item_id: ASAAS_ITEM_ID });
    expect(asaasItem([{ malvo_item_id: "x" }])).toBeNull();
  });
});
