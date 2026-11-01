import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyCronSecret, unauthorizedCronResponse } from "@/lib/cron-auth.server";

const req = (h: Record<string, string>) => new Request("https://x.test/api/public/cron/x", { method: "POST", headers: h });

describe("verifyCronSecret", () => {
  const prev = process.env["CRON_SECRET"];
  beforeEach(() => {
    process.env["CRON_SECRET"] = "s3cret-value";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env["CRON_SECRET"];
    else process.env["CRON_SECRET"] = prev;
  });
  it("aceita Authorization: Bearer e o x-cron-secret histórico", () => {
    expect(verifyCronSecret(req({ authorization: "Bearer s3cret-value" }))).toBe(true);
    expect(verifyCronSecret(req({ "x-cron-secret": "s3cret-value" }))).toBe(true);
  });
  it("recusa ausente, errado ou sem CRON_SECRET configurado", () => {
    expect(verifyCronSecret(req({}))).toBe(false);
    expect(verifyCronSecret(req({ authorization: "Bearer outro" }))).toBe(false);
    expect(verifyCronSecret(req({ "x-cron-secret": "s3cret-valuX" }))).toBe(false);
    delete process.env["CRON_SECRET"];
    expect(verifyCronSecret(req({ authorization: "Bearer s3cret-value" }))).toBe(false);
  });
  it("401 em JSON", async () => {
    const r = unauthorizedCronResponse();
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Unauthorized cron caller" });
  });
});
