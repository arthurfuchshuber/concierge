/**
 * MEMÓRIA DO HÓSPEDE · migration `20261106230000_guest_ai_guest_profiles.sql` contra POSTGRES REAL.
 * Resolução por conta da OTA (Porta 1), por telefone (Porta 2), número reciclado (conflito), isolamento
 * por conta (tenant) e privilégios (nada para anon/authenticated). Pulado sem binários do Postgres.
 */
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "./pg/pg-cluster";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const MIGRATION = path.join(REPO, "supabase/migrations/20261106230000_guest_ai_guest_profiles.sql");

const T1 = "a1000000-0000-4000-8000-000000000001";
const T2 = "a2000000-0000-4000-8000-000000000002";
let pg: PgCluster;

const q = (v: string | null) => (v === null ? "null" : `'${v.replace(/'/g, "''")}'`);
const arr = (xs: string[]) => `array[${xs.map(q).join(",")}]::text[]`;
async function profile(tenant: string, name: string | null): Promise<string> {
  return pg.sql(
    `insert into public.guest_ai_guest_profiles (tenant_id, guest_name) values ('${tenant}', ${q(name)}) returning canonical_id`,
  );
}
async function link(
  tenant: string,
  id: string,
  kind: string,
  value: string,
  name: string | null = null,
) {
  return JSON.parse(
    await pg.sql(
      `select public.guest_ai_link_guest_identity('${tenant}', '${id}', '${kind}', ${q(value)}, ${q(name)})`,
      {
        role: "service_role",
      },
    ),
  ) as { result: string; canonical_id?: string };
}
async function resolve(tenant: string, ota: string | null, phones: string[]) {
  return JSON.parse(
    await pg.sql(
      `select public.guest_ai_resolve_guest_profile('${tenant}', ${q(ota)}, ${arr(phones)})`,
      {
        role: "service_role",
      },
    ),
  ) as { result: string; canonical_id?: string; via?: string };
}

describe.skipIf(!PG_AVAILABLE)("Memória do hóspede · migration contra PostgreSQL real", () => {
  beforeAll(() => {
    pg = startCluster([MIGRATION], { bin: process.env.GUEST_AI_PG_BIN });
  }, 120_000);
  afterAll(() => pg?.stop());
  beforeEach(async () => {
    await pg.sql(
      `truncate public.guest_ai_guest_identities, public.guest_ai_guest_profiles cascade`,
    );
  });

  it("Porta 1: a conta da OTA resolve o perfil, mesmo com telefone diferente", async () => {
    const id = await profile(T1, "Marina Souza");
    expect(await link(T1, id, "ota", "airbnb:123456789")).toMatchObject({ result: "linked" });
    expect(await link(T1, id, "phone", "+55 47 99999-0001", "Marina Souza")).toMatchObject({
      result: "linked",
    });
    expect(await resolve(T1, "airbnb:123456789", ["+5511988887777"])).toEqual({
      result: "found",
      canonical_id: id,
      via: "ota",
    });
    expect(await resolve(T1, "AIRBNB:123456789", [])).toMatchObject({
      result: "found",
      via: "ota",
    });
    expect(await link(T1, id, "ota", "airbnb:123456789")).toMatchObject({
      result: "already_linked",
    });
  });

  it("conta da OTA nunca pertence a dois perfis (taken, sem alteração)", async () => {
    const a = await profile(T1, "Marina Souza");
    const b = await profile(T1, "Marina Souza");
    await link(T1, a, "ota", "airbnb:111");
    expect(await link(T1, b, "ota", "airbnb:111")).toEqual({ result: "taken", canonical_id: a });
    expect(await resolve(T1, "airbnb:111", [])).toMatchObject({ canonical_id: a });
  });

  it("Porta 2: telefone normalizado em E.164 resolve o perfil (formatos diferentes do mesmo número)", async () => {
    const id = await profile(T1, "Carlos Lima");
    expect(await link(T1, id, "phone", "5547999990002", "Carlos Lima")).toMatchObject({
      result: "linked",
    });
    for (const p of ["+55 (47) 99999-0002", "005547999990002", "5547999990002"])
      expect(await resolve(T1, null, [p]), p).toEqual({
        result: "found",
        canonical_id: id,
        via: "phone",
      });
    expect(
      await pg.sql(
        `select phones::text from public.guest_ai_guest_profiles where canonical_id = '${id}'`,
      ),
    ).toBe("{+5547999990002}");
    expect(await pg.sql(`select public.guest_ai_normalize_phone('12345')`)).toBe(""); // curto demais ⇒ NULL
  });

  it("número reciclado: mesmo telefone com nome incompatível ⇒ conflito e o telefone deixa de identificar QUALQUER perfil", async () => {
    const antigo = await profile(T1, "Ana Paula Ribeiro");
    const novo = await profile(T1, "Mariana Costa"); // "Ana" não casa com "Mariana" (palavra inteira)
    await link(T1, antigo, "phone", "+5547999990003", "Ana Paula Ribeiro");
    expect(await link(T1, novo, "phone", "+5547999990003", "Mariana Costa")).toEqual({
      result: "conflict",
    });
    expect(await resolve(T1, null, ["+5547999990003"])).toEqual({ result: "conflict" });
    expect(
      await pg.sql(
        `select phones::text from public.guest_ai_guest_profiles where canonical_id = '${antigo}'`,
      ),
    ).toBe("{}");
    // depois do conflito, ninguém mais vincula esse número
    expect(await link(T1, antigo, "phone", "+5547999990003", "Ana Paula Ribeiro")).toEqual({
      result: "conflict",
    });
  });

  it("mesmo telefone, mesmo primeiro nome e sobrenome diferente ⇒ conflito (não unifica perfis)", async () => {
    const a = await profile(T1, "Carlos Silva");
    const b = await profile(T1, "Carlos Junior");
    await link(T1, a, "phone", "+5547999990010", "Carlos Silva");
    expect(await link(T1, b, "phone", "+5547999990010", "Carlos Junior")).toEqual({
      result: "conflict",
    });
    expect(await resolve(T1, null, ["+5547999990010"])).toEqual({ result: "conflict" });
  });

  it("mesmo telefone com nome compatível ⇒ aponta o perfil existente (não cria vínculo duplo)", async () => {
    const a = await profile(T1, "João Pedro Alves");
    const b = await profile(T1, "joao pedro");
    await link(T1, a, "phone", "+5547999990004", "João Pedro Alves");
    expect(await link(T1, b, "phone", "+5547999990004", "joao pedro")).toEqual({
      result: "matches_other_profile",
      canonical_id: a,
    });
    expect(await resolve(T1, null, ["+5547999990004"])).toMatchObject({ canonical_id: a });
  });

  it("telefones da reserva que apontam para perfis diferentes ⇒ conflito (nunca escolhe um)", async () => {
    const a = await profile(T1, "Pedro Rocha");
    const b = await profile(T1, "Luiza Melo");
    await link(T1, a, "phone", "+5547999990005", "Pedro Rocha");
    await link(T1, b, "phone", "+5547999990006", "Luiza Melo");
    expect(await resolve(T1, null, ["+5547999990005", "+5547999990006"])).toEqual({
      result: "conflict",
    });
  });

  it("isolamento por conta: o mesmo telefone/conta OTA em outro tenant não resolve nem colide", async () => {
    const a = await profile(T1, "Rita Dias");
    const b = await profile(T2, "Bruno Teles");
    await link(T1, a, "phone", "+5547999990007", "Rita Dias");
    await link(T1, a, "ota", "airbnb:222");
    expect(await link(T2, b, "phone", "+5547999990007", "Bruno Teles")).toMatchObject({
      result: "linked",
    });
    expect(await link(T2, b, "ota", "airbnb:222")).toMatchObject({ result: "linked" });
    expect(await resolve(T2, "airbnb:222", [])).toMatchObject({ canonical_id: b });
    expect(await resolve(T1, null, ["+5547999990007"])).toMatchObject({ canonical_id: a });
    // perfil de outro tenant não pode receber identidade
    expect(await link(T1, b, "phone", "+5547999990008", "Bruno Teles")).toEqual({
      result: "invalid",
      reason: "profile",
    });
  });

  it("compatibilidade de nomes: correspondência substancial; só primeiro nome não basta; nome ausente nunca é compatível", async () => {
    const c = async (a: string | null, b: string | null) =>
      (await pg.sql(`select public.guest_ai_guest_name_compatible(${q(a)}, ${q(b)})`)) === "t";
    expect(await c("José Antônio", "jose antonio silva")).toBe(true);
    expect(await c("Ana Paula Ribeiro", "Ana Souza Ribeiro")).toBe(true); // primeiro nome + sobrenome em comum
    expect(await c("Carlos Silva", "Carlos Junior")).toBe(false); // só o primeiro nome igual não basta
    expect(await c("Carlos", "Carlos Silva")).toBe(false); // uma palavra só não prova
    expect(await c("Ana", "Ana")).toBe(false);
    expect(await c("Ana", "Mariana")).toBe(false);
    expect(await c("Ana Lima", "Bruno Lima")).toBe(false);
    expect(await c(null, "Ana")).toBe(false);
    expect(await c("", "")).toBe(false);
  });

  it("entradas inválidas são recusadas; formato da identidade garantido pelo banco", async () => {
    const id = await profile(T1, "X Y");
    expect(await link(T1, id, "email", "a@b.c")).toMatchObject({ result: "invalid" });
    expect(await link(T1, id, "ota", "sem-prefixo")).toMatchObject({
      result: "invalid",
      reason: "value",
    });
    expect(await link(T1, id, "phone", "123")).toMatchObject({
      result: "invalid",
      reason: "value",
    });
    const r = await pg.trySql(
      `insert into public.guest_ai_guest_identities (tenant_id, kind, value, canonical_id) values ('${T1}', 'phone', '47999', '${id}')`,
    );
    expect(r.ok).toBe(false);
    for (const bad of [`internal_assessment = '[]'::jsonb`, `stay_summaries = '{}'::jsonb`])
      expect(
        (
          await pg.trySql(
            `update public.guest_ai_guest_profiles set ${bad} where canonical_id = '${id}'`,
          )
        ).ok,
        bad,
      ).toBe(false);
    const notes = await pg.trySql(
      `update public.guest_ai_guest_profiles set behavioral_notes = '{"x":1}'::jsonb where canonical_id = '${id}'`,
    );
    expect(notes.ok).toBe(false);
  });

  it("privilégios: anon e authenticated não leem as tabelas nem executam as funções; RLS ligada", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(
        (await pg.trySql(`select count(*) from public.guest_ai_guest_profiles`, { role })).ok,
      ).toBe(false);
      expect(
        (await pg.trySql(`select count(*) from public.guest_ai_guest_identities`, { role })).ok,
      ).toBe(false);
      expect(
        (
          await pg.trySql(
            `select public.guest_ai_resolve_guest_profile('${T1}', null, array[]::text[])`,
            { role },
          )
        ).ok,
      ).toBe(false);
    }
    expect(
      await pg.sql(
        `select string_agg(relname || ':' || relrowsecurity, ',' order by relname) from pg_class where relname in ('guest_ai_guest_profiles', 'guest_ai_guest_identities')`,
      ),
    ).toBe("guest_ai_guest_identities:true,guest_ai_guest_profiles:true");
    expect(
      await pg.sql(
        `select count(*) from pg_policies where tablename in ('guest_ai_guest_profiles', 'guest_ai_guest_identities')`,
      ),
    ).toBe("0");
  });
});
