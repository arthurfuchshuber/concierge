/**
 * Migration `20261107030000_guide_maps_context.sql` contra POSTGRES REAL (cluster local temporário; nada toca a
 * produção): colunas aditivas, vocabulário fechado de `distance_kind`, forma e tamanho de `guide_context`,
 * linhas antigas intactas (NULL) e idempotência; sem cron, sem chamada externa, sem DML.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "./pg/pg-cluster";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const MIGRATION = path.join(REPO, "supabase/migrations/20261107030000_guide_maps_context.sql");
const CONV = "c1000000-0000-4000-8000-000000000001";
const PROP = "b1000000-0000-4000-8000-000000000001";

let pg: PgCluster;

describe("migration é aditiva e não age sozinha", () => {
  it("só ADD COLUMN / CHECK / COMMENT; sem cron, rede, DML ou DROP de coluna", () => {
    const sql = readFileSync(MIGRATION, "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/cron\.|net\.http|pg_net|http_post/i);
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
    expect(sql).not.toMatch(/drop\s+(table|column)/i);
  });
});

describe.skipIf(!PG_AVAILABLE)("migration guide_maps_context contra PostgreSQL real", () => {
  beforeAll(async () => {
    pg = startCluster([], { bin: process.env.GUEST_AI_PG_BIN });
    await pg.sql(`create table if not exists public.property_recommendations (id uuid primary key default gen_random_uuid(),
      property_id uuid not null, name text not null, distance_meters integer);
      insert into public.property_recommendations (property_id, name, distance_meters) values ('${PROP}', 'Antiga', 300);
      insert into public.property_chat_conversations (id, property_id, guest_session_id) values ('${CONV}', '${PROP}', 's1') on conflict do nothing;
      insert into public.property_chat_messages (id, conversation_id, sender_type, role) values (gen_random_uuid(), '${CONV}', 'guest', 'user');`);
    await pg.sql(readFileSync(MIGRATION, "utf8"));
  }, 120_000);
  afterAll(() => pg?.stop());

  it("linhas existentes ficam intactas, com procedência e contexto nulos", async () => {
    expect(
      await pg.sql(
        `select coalesce(distance_kind, 'NULL') || ':' || distance_meters from public.property_recommendations`,
      ),
    ).toBe("NULL:300");
    expect(
      await pg.sql(
        `select count(*) from public.property_chat_messages where guide_context is not null`,
      ),
    ).toBe("0");
  });

  it("distance_kind: só route, straight_line ou nulo", async () => {
    for (const ok of ["'route'", "'straight_line'", "null"])
      expect(
        (await pg.trySql(`update public.property_recommendations set distance_kind = ${ok}`)).ok,
        ok,
      ).toBe(true);
    expect(
      (await pg.trySql(`update public.property_recommendations set distance_kind = 'haversine'`))
        .ok,
    ).toBe(false);
  });

  it("guide_context: só evento da página principal, objeto de no máximo 2 KB", async () => {
    const set = (v: string) =>
      pg.trySql(`update public.property_chat_messages set guide_context = ${v}`);
    expect(
      (
        await set(
          `'{"kind":"city_event","id":"evt-0a1b2c3d","name":"Festival","type":"evento","category":"evento"}'::jsonb`,
        )
      ).ok,
    ).toBe(true);
    // o Explorar não abre o chat: recomendação nunca é contexto
    expect((await set(`'{"kind":"place","id":"rec:1","name":"Padaria"}'::jsonb`)).ok).toBe(false);
    expect((await set(`null`)).ok).toBe(true);
    expect((await set(`'{"kind":"outro","id":"x"}'::jsonb`)).ok).toBe(false);
    expect((await set(`'{"id":"x"}'::jsonb`)).ok).toBe(false);
    expect((await set(`'["place"]'::jsonb`)).ok).toBe(false);
    expect(
      (await set(`jsonb_build_object('kind','city_event','id','x','name', repeat('a', 4000))`)).ok,
    ).toBe(false);
  });

  it("reaplicar não altera nada (idempotente)", async () => {
    const snap = () =>
      pg.sql(`select string_agg(conname || pg_get_constraintdef(oid), ',' order by conname) from pg_constraint
               where conname in ('property_recommendations_distance_kind_check', 'property_chat_messages_guide_context_check')`);
    const before = await snap();
    await pg.sql(readFileSync(MIGRATION, "utf8"));
    expect(await snap()).toBe(before);
    expect(await pg.sql(`select count(*) from public.property_recommendations`)).toBe("1");
  });
});
