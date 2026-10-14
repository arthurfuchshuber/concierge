/**
 * Traduz a mensagem bruta de um registro da Linha do Tempo do proprietário
 * (texto puro gravado no banco) em título curto + linhas "Campo: valor",
 * como no mockup P1. Mensagens fora dos padrões conhecidos voltam como
 * título, sem linhas.
 */
export type RecordView = { title: string; lines: Array<{ k: string; v: string }>; kind: string };

const DATE_FIELDS = /(in[ií]cio do contrato|fim do contrato|data de nascimento)/i;

const vazio = (v: string) => v.trim() === "" || v.trim().toLowerCase() === "vazio";
const br = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
};
const val = (field: string, v: string) => (DATE_FIELDS.test(field) ? br(v) : v);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function describeRecord(raw: string): RecordView {
  const msg = (raw ?? "").trim();

  // "Cadastro atualizado — N informação(ões) alterada(s): Campo: "A" → "B"; ..."
  const upd = /^Cadastro atualizado\s*—\s*\d+\s*informa[^:]*:\s*(.+)$/i.exec(msg);
  if (upd) {
    const segs = upd[1]!
      .split(/;\s+/)
      .map((s) => /^(.+?):\s*"([^"]*)"\s*→\s*"([^"]*)"$/.exec(s.trim()))
      .filter((m): m is RegExpExecArray => !!m);
    if (segs.length === 1) {
      const [, f, a, b] = segs[0]!;
      const field = f!;
      const verb = vazio(b!) ? "removido" : vazio(a!) ? "definido" : "alterado";
      return {
        kind: "update",
        title: `${field} ${verb}`,
        lines: [
          { k: "Campo", v: field },
          { k: "Antes", v: vazio(a!) ? "vazio" : val(field, a!) },
          { k: "Depois", v: vazio(b!) ? "vazio" : val(field, b!) },
        ],
      };
    }
    if (segs.length > 1) {
      return {
        kind: "update",
        title: "Cadastro atualizado",
        lines: segs.map(([, f, a, b]) => ({
          k: f!,
          v: `${vazio(a!) ? "vazio" : val(f!, a!)} → ${vazio(b!) ? "vazio" : val(f!, b!)}`,
        })),
      };
    }
  }

  // Registros antigos (ago/2026) foram gravados só com "Cadastro atualizado." — o
  // banco não guardou o que mudou, então não há como reconstruir o detalhe.
  if (/^Cadastro atualizado\.?$/i.test(msg) || /^Cadastro salvo sem altera/i.test(msg)) {
    return {
      kind: "update",
      title: "Cadastro atualizado",
      lines: [{ k: "Detalhe", v: "não foi guardado neste registro antigo" }],
    };
  }

  if (/^Cadastro criado/i.test(msg)) return { kind: "create", title: "Cadastro criado", lines: [] };

  const sit = /^Situa[çc][ãa]o alterada para (.+?)(?: em (\d{2}\/\d{2}\/\d{4}))?\.?$/i.exec(msg);
  if (sit) {
    return {
      kind: "update",
      title: "Situação alterada",
      lines: [{ k: "Nova situação", v: sit[1]! }, ...(sit[2] ? [{ k: "Data", v: sit[2] }] : [])],
    };
  }

  // "Telefone alterado(a) para "x"" / "Data de início do contrato alterada para 25/09/2026"
  const chg = /^(.+?) alterad[oa](?:\(a\))? para "?(.+?)"?\.?$/i.exec(msg);
  if (chg) {
    return {
      kind: "update",
      title: `${cap(chg[1]!)} alterado(a)`.replace(
        "alterado(a)",
        /^(data|situa)|a$/i.test(chg[1]!) ? "alterada" : "alterado",
      ),
      lines: [{ k: "Novo valor", v: chg[2]! }],
    };
  }

  return {
    kind: /resid[êe]ncia|im[óo]vel/i.test(msg) ? "property" : "note",
    title: msg,
    lines: [],
  };
}
