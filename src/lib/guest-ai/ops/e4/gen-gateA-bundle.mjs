#!/usr/bin/env node
// ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · GERADOR do `gateA-bundle.sql` (Caminho 2 ratificado).
// Uso (raiz do repositório):   node src/lib/guest-ai/ops/e4/gen-gateA-bundle.mjs           → escreve e imprime o SHA-256
//                              node src/lib/guest-ai/ops/e4/gen-gateA-bundle.mjs --check   → só confere (não escreve)
// Determinístico: mesmo conteúdo das 3 migrations ⇒ bundle byte a byte idêntico (sem data, sem caminho absoluto).
// Recusa gerar se alguma migration tiver controle de transação ou meta-comando do psql que quebraria a
// transação única (BEGIN/COMMIT/ROLLBACK/SAVEPOINT soltos, \comandos, CONCURRENTLY, VACUUM).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../../..");
const OUT = path.join(HERE, "gateA-bundle.sql");
// ordem de dependência: lease (B3.1) → Shadow base (B3.3) → escopo global (E4)
const SOURCES = [
  "supabase/migrations/20261104000000_guest_ai_conversation_leases.sql",
  "supabase/migrations/20261104120000_guest_ai_shadow.sql",
  "supabase/migrations/20261105120000_guest_ai_shadow_global.sql",
];
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Linhas FORA de corpo `$tag$ … $tag$` (funções, blocos DO), sem comentários de linha. */
function topLevelLines(sql) {
  const out = [];
  let tag = null;
  for (const raw of sql.split("\n")) {
    const line = raw.replace(/--.*$/, "");
    if (tag === null) out.push(line);
    const re = /\$([A-Za-z_]*)\$/g;
    let m;
    while ((m = re.exec(line))) tag = tag === null ? m[1] : m[1] === tag ? null : tag;
  }
  return out;
}
function assertSafe(name, sql) {
  if (/^\s*\\/m.test(sql)) throw new Error(`${name}: meta-comando do psql`);
  for (const l of topLevelLines(sql)) {
    if (/^\s*(begin|start\s+transaction|commit|end|rollback|savepoint|release|abort)\b\s*;?/i.test(l)) throw new Error(`${name}: controle de transação solto: ${l.trim()}`);
    if (/\bconcurrently\b|\bvacuum\b/i.test(l)) throw new Error(`${name}: comando incompatível com transação: ${l.trim()}`);
  }
}

export function buildBundle() {
  const parts = SOURCES.map((rel) => {
    const buf = readFileSync(path.join(REPO, rel));
    const text = buf.toString("utf8");
    assertSafe(rel, text);
    return { rel, sha256: sha(buf), text: text.endsWith("\n") ? text : `${text}\n` };
  });
  const START = "\n-- ═══ INÍCIO DO CONTEÚDO DO GATE A ═══\n";
  const END = "\n-- ═══ FIM DO CONTEÚDO DO GATE A ═══\n";
  const payloadBody = parts.flatMap((p, i) => [`-- ═════════════════ ${i + 1}/3 · ${p.rel} ═════════════════`, p.text]).join("\n");
  // região conferida no servidor: de START (inclusive) até END (exclusive), exatamente como `substr(current_query(), …)`
  const region = `${START}${payloadBody}`;
  const payloadSha = sha(Buffer.from(region, "utf8"));
  const header = [
    "-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · GATE A · BUNDLE SQL ÚNICO (Caminho 2 ratificado).",
    "-- NÃO EXECUTAR sem a autorização expressa do Anfitrião Sigma para o Gate A. Aplicação INERTE: escopo `none`,",
    "-- estado `disabled`, nenhum interruptor, nenhum cron. Gerado por `src/lib/guest-ai/ops/e4/gen-gateA-bundle.mjs`",
    "-- (determinístico; conferir com `--check`). Não editar à mão.",
    "--",
    "-- EXECUÇÃO: o texto INTEIRO numa ÚNICA chamada, como `postgres`, pela interface SQL do Lovable Cloud (que envia",
    "-- tudo numa mensagem do protocolo simples ⇒ UMA transação implícita). SEM `BEGIN`/`COMMIT` de propósito: erro em",
    "-- qualquer comando desfaz TUDO no próprio servidor e solta os locks (um BEGIN explícito deixaria a conexão do pool",
    "-- em transação abortada segurando locks). A guarda abaixo PROVA, antes de qualquer DDL, que os comandos estão na",
    "-- mesma transação e que os timeouts valem; se não estiverem (autocommit por comando), aborta sem aplicar nada.",
    "-- Antes: 01-preflight.sql e 09-sonda-transacao.sql (na MESMA interface). Depois: 02-validate.sql, 07, 08.",
    "--",
    "-- Origem (ordem de dependência):",
    ...parts.map((p, i) => `--   ${i + 1}/3  ${p.rel}  sha256 ${p.sha256}`),
    `-- Conteúdo conferido no servidor (entre os marcadores INÍCIO/FIM): sha256 ${payloadSha}`,
    "",
    "set local lock_timeout = '3s';",
    "set local statement_timeout = '120s';",
    "select set_config('guest_ai.gate_a_bundle', 'on', true);",
    "-- Guarda (antes de qualquer DDL): (1) mesma transação; (2) timeouts efetivos; (3) INTEGRIDADE do texto recebido pelo",
    "-- servidor: o SHA-256 do conteúdo entre os marcadores INÍCIO/FIM (lido de `current_query()`, a mensagem inteira) tem",
    "-- de ser igual ao gerado. Corte, troca de quebra de linha ou remoção de comentários pela interface ⇒ aborta sem aplicar.",
    "do $gate_a$",
    "declare",
    "  q text := current_query();",
    "  s integer;",
    "  e integer;",
    "begin",
    "  if current_setting('guest_ai.gate_a_bundle', true) is distinct from 'on' then",
    "    raise exception 'gate_a_bundle: comandos fora de uma transação única (autocommit por comando); nada foi aplicado' using errcode = 'P0001';",
    "  end if;",
    "  if current_setting('lock_timeout') <> '3s' or current_setting('statement_timeout') <> '2min' then",
    "    raise exception 'gate_a_bundle: timeouts não efetivos (lock_timeout=%, statement_timeout=%); nada foi aplicado',",
    "      current_setting('lock_timeout'), current_setting('statement_timeout') using errcode = 'P0001';",
    "  end if;",
    "  -- marcadores montados por concatenação: a própria guarda não contém o texto literal deles",
    "  s := strpos(q, E'\\n-- ═══ INÍCIO DO CONTEÚDO' || E' DO GATE A ═══\\n');",
    "  e := strpos(q, E'\\n-- ═══ FIM DO CONTEÚDO' || E' DO GATE A ═══\\n');",
    "  if s = 0 or e = 0 or e < s then",
    "    raise exception 'gate_a_bundle: marcadores de conteúdo ausentes no texto recebido (texto cortado ou alterado pela interface); nada foi aplicado' using errcode = 'P0001';",
    "  end if;",
    `  if encode(sha256(convert_to(substr(q, s, e - s), 'UTF8')), 'hex') <> '${payloadSha}' then`,
    "    raise exception 'gate_a_bundle: conteúdo recebido difere do gerado (SHA-256); nada foi aplicado' using errcode = 'P0001';",
    "  end if;",
    "end",
    "$gate_a$;",
  ];
  const footer = [
    "-- ═════════════════ verificação final (mesma transação) ═════════════════",
    "do $gate_a$",
    "begin",
    "  if current_setting('guest_ai.gate_a_bundle', true) is distinct from 'on' then",
    "    raise exception 'gate_a_bundle: a transação mudou durante a aplicação; desfeito' using errcode = 'P0001';",
    "  end if;",
    "  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'guest\\_ai\\_%') <> 12",
    "     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'",
    "           and (p.proname like 'shadow\\_%' or p.proname like 'guest\\_ai\\_shadow\\_%' or p.proname like '%\\_conversation\\_lease')) <> 35",
    "     or (select state || ':' || property_scope from public.guest_ai_shadow_control where id = 1) <> 'disabled:none' then",
    "    raise exception 'gate_a_bundle: estado final diferente do inerte esperado; desfeito' using errcode = 'P0001';",
    "  end if;",
    "end",
    "$gate_a$;",
    "",
  ];
  return `${header.join("\n")}${region}${END}${footer.join("\n")}`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = buildBundle();
  const h = sha(Buffer.from(text, "utf8"));
  if (process.argv.includes("--check")) {
    const cur = readFileSync(OUT, "utf8");
    if (cur !== text) {
      console.error(`gateA-bundle.sql DIVERGE da geração (esperado ${h}, atual ${sha(Buffer.from(cur, "utf8"))})`);
      process.exit(1);
    }
    console.log(`ok ${h}`);
  } else {
    writeFileSync(OUT, text);
    console.log(h);
  }
}
