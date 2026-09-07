/**
 * Extrator de conhecimento do sistema (07/09/2026).
 *
 * Gera a base que o Assistente do Painel consulta para responder "como faço X"
 * e, principalmente, "por que isso funciona assim". Roda no build (`prebuild`),
 * então o conhecimento acompanha cada entrega sem ninguém precisar lembrar de
 * escrever documentação.
 *
 * De onde ele tira o material, em ordem de valor:
 *
 *   1. `docs/assistente/*.md` — guias escritos à mão. Sempre entram, e ganham
 *      de tudo. É aqui que mora o que o código não conta (combinados de
 *      operação, política com um proprietário, motivo de um preço).
 *
 *   2. Comentários de bloco em `src/lib` e `src/components` — o racional de
 *      negócio. Este projeto comenta o PORQUÊ de cada regra em português, com
 *      data e o pedido que originou a decisão; é exatamente esse texto que a
 *      pessoa quer ouvir quando pergunta "por que a pendência de manutenção já
 *      aparece na limpeza?". Só entram blocos longos o bastante para conter um
 *      raciocínio — comentário de uma linha é ruído.
 *
 *   3. Rotas em `src/routes` — que telas existem, como se chamam e o que fazem,
 *      lido do `head.meta` que cada rota já declara para SEO.
 *
 * O que ele NÃO faz: inventar. Regra sem comentário vira uma lacuna reportada
 * no fim da execução, não uma descrição chutada. Preencher a lacuna é escrever
 * o comentário (que serve ao próximo desenvolvedor de qualquer jeito) ou um
 * guia em `docs/assistente/`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, basename } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "src/generated/system-knowledge.ts");

/** Comprimento mínimo de um comentário para ele contar como racional e não como nota. */
const MIN_RATIONALE = 140;
/** Teto por trecho — o suficiente para um raciocínio completo, sem estourar o contexto. */
const MAX_CONTENT = 2200;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__" || name === "generated") continue;
      walk(full, out);
    } else if (/\.(tsx?|md)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function hash(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

function clean(text) {
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Tira as bordas de um comentário de bloco, deixando só a prosa. */
function stripBlockComment(raw) {
  return clean(
    raw
      .replace(/^\/\*\*?/, "")
      .replace(/\*\/$/, "")
      .split("\n")
      .map((l) => l.replace(/^\s*\*ing?\s?/, "").replace(/^\s*\*\s?/, ""))
      .join("\n"),
  );
}

/**
 * Texto em português com substância? Filtra cabeçalhos em inglês, licenças e
 * blocos de tipos que por acaso ficaram longos.
 */
function looksLikeRationale(text) {
  if (text.length < MIN_RATIONALE) return false;
  if (/^\s*@?(ts-|eslint|prettier|see https?:)/i.test(text)) return false;
  const pt = /\b(porque|por que|quando|precisa|regra|pedido|sempre|nunca|não|então|serve|vale|evita|garante|significa|ou seja)\b/i;
  return pt.test(text);
}

/**
 * Nome do símbolo declarado logo depois do comentário — é o que dá título ao
 * trecho e o torna endereçável ("rule:defaultShowInCleaning").
 */
function symbolAfter(source, endIndex) {
  const tail = source.slice(endIndex, endIndex + 400);
  const m = tail.match(
    /^\s*(?:export\s+)?(?:async\s+)?(?:function|const|type|class|interface)\s+([A-Za-z0-9_$]+)/,
  );
  return m ? m[1] : null;
}

/** Converte o nome do arquivo de rota no caminho de URL que o usuário vê. */
function routePathOf(file) {
  let name = basename(file).replace(/\.tsx?$/, "");
  if (name === "__root" || name.startsWith("-")) return null;
  if (name.startsWith("api.") || name.startsWith("lovable.")) return null;
  const segments = name
    .split(".")
    .filter((s) => s && !s.startsWith("_")) // rotas pathless não aparecem na URL
    .map((s) => (s === "index" ? "" : s));
  const path = "/" + segments.filter(Boolean).join("/");
  return path === "/" ? "/" : path;
}

function firstBlockComment(source) {
  const m = source.match(/^\s*\/\*\*?[\s\S]*?\*\//);
  return m ? stripBlockComment(m[0]) : null;
}

function metaOf(source) {
  const title = source.match(/\{\s*title:\s*["'`]([^"'`]+)["'`]/);
  const desc =
    source.match(/name:\s*["']description["']\s*,\s*\n?\s*content:\s*\n?\s*["'`]([^"'`]+)["'`]/) ??
    source.match(/property:\s*["']og:description["']\s*,\s*\n?\s*content:\s*\n?\s*["'`]([^"'`]+)["'`]/);
  return { title: title?.[1] ?? null, description: desc?.[1] ?? null };
}

/**
 * Rótulos do menu lateral do painel. Uma tela sem `head.meta` ainda assim tem
 * nome — o nome pelo qual a pessoa se refere a ela ("vai em Guias"). Sem isso,
 * o assistente saberia que a rota existe mas não como alguém a chama, que é
 * justamente o que se usa para dar uma direção.
 */
function navLabels() {
  const file = join(ROOT, "src/routes/_authenticated/admin.tsx");
  const map = new Map();
  if (!existsSync(file)) return map;
  const source = readFileSync(file, "utf8");
  const re = /\{\s*to:\s*["'](\/admin[^"']*)["']\s*,\s*label:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source))) if (!map.has(m[1])) map.set(m[1], m[2]);
  return map;
}

// ─────────────────────────────── extração ───────────────────────────────

const docs = [];
const gaps = [];
const seen = new Set();

function push(doc) {
  if (seen.has(doc.doc_key)) return;
  seen.add(doc.doc_key);
  doc.content = doc.content.slice(0, MAX_CONTENT);
  doc.content_hash = hash(`${doc.title}\n${doc.content}`);
  docs.push(doc);
}

// 1) Guias escritos à mão
for (const file of walk(join(ROOT, "docs/assistente"))) {
  if (!file.endsWith(".md")) continue;
  const body = readFileSync(file, "utf8");
  const title = body.match(/^#\s+(.+)$/m)?.[1] ?? basename(file, ".md");
  push({
    doc_key: `guide:${basename(file, ".md")}`,
    kind: "guide",
    title,
    content: clean(body.replace(/^#\s+.+$/m, "")),
    source_path: relative(ROOT, file),
    audience: [],
  });
}

// 2) Racional de negócio nos comentários
for (const file of [...walk(join(ROOT, "src/lib")), ...walk(join(ROOT, "src/components"))]) {
  if (!/\.tsx?$/.test(file)) continue;
  const source = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);
  const re = /\/\*\*[\s\S]*?\*\//g;
  let m;
  while ((m = re.exec(source))) {
    const text = stripBlockComment(m[0]);
    if (!looksLikeRationale(text)) continue;
    const symbol = symbolAfter(source, m.index + m[0].length);
    const key = symbol ? `rule:${symbol}` : `rule:${rel}:${m.index}`;
    push({
      doc_key: key,
      kind: "rule",
      title: symbol ? `Regra — ${symbol}` : `Regra em ${basename(file)}`,
      content: text,
      source_path: rel,
      audience: [],
    });
  }
}

// 3) Telas
const NAV = navLabels();
for (const file of walk(join(ROOT, "src/routes"))) {
  if (!/\.tsx$/.test(file)) continue;
  const path = routePathOf(file);
  if (!path) continue;
  const source = readFileSync(file, "utf8");
  const { title, description } = metaOf(source);
  const header = firstBlockComment(source);
  const navLabel = NAV.get(path) ?? null;
  const parts = [];
  if (navLabel) parts.push(`No menu do painel esta tela se chama "${navLabel}".`);
  if (description) parts.push(description);
  if (header && header.length > 60) parts.push(header);
  // Sem nome no menu, sem descrição e sem comentário, não há o que dizer de
  // verdade sobre a tela — e descrever no chute é pior do que admitir a falta.
  if (!parts.length) {
    gaps.push(`${path} (${relative(ROOT, file)}) — sem nome no menu, título ou descrição`);
    continue;
  }
  push({
    doc_key: `route:${path}`,
    kind: "route",
    title: navLabel ? `${navLabel} — tela ${path}` : title ? `${title} — tela ${path}` : `Tela ${path}`,
    content: `Caminho no sistema: ${path}\n\n${parts.join("\n\n")}`,
    source_path: relative(ROOT, file),
    audience: [],
  });
}

mkdirSync(join(ROOT, "src/generated"), { recursive: true });
docs.sort((a, b) => a.doc_key.localeCompare(b.doc_key));

// Sai como módulo TypeScript, não JSON: o projeto não liga `resolveJsonModule`,
// e um módulo funciona igual em qualquer alvo de build (nitro, cloudflare)
// sem depender de leitura de arquivo em runtime. O tipo vem anotado de
// propósito — sem isso o tsc tentaria inferir um literal de centenas de
// objetos e ficaria lento à toa.
const banner = `// GERADO AUTOMATICAMENTE por scripts/extract-system-knowledge.mjs — não edite à mão.
// Fonte do conhecimento do Assistente do Painel. Regenerado a cada build.

export type GeneratedSystemDoc = {
  doc_key: string;
  kind: string;
  title: string;
  content: string;
  source_path: string | null;
  audience: string[];
  content_hash: string;
};

export const GENERATED_AT = ${JSON.stringify(new Date().toISOString())};

export const SYSTEM_KNOWLEDGE: GeneratedSystemDoc[] = ${JSON.stringify(docs, null, 2)};
`;
writeFileSync(OUT, banner);

const byKind = docs.reduce((acc, d) => ({ ...acc, [d.kind]: (acc[d.kind] ?? 0) + 1 }), {});
console.log(
  `[conhecimento] ${docs.length} trechos → ${relative(ROOT, OUT)}`,
  Object.entries(byKind)
    .map(([k, n]) => `${k}=${n}`)
    .join(" "),
);
if (gaps.length) {
  console.log(`[conhecimento] ${gaps.length} telas sem descrição (o assistente não vai saber explicá-las):`);
  for (const g of gaps.slice(0, 25)) console.log(`  · ${g}`);
  if (gaps.length > 25) console.log(`  … e mais ${gaps.length - 25}`);
}
