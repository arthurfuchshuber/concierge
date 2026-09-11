/**
 * UM DEPÓSITO CHAVE-VALOR EM IndexedDB, sem dependência nova (11/09/2026).
 *
 * Por que não `localStorage`: ele guarda só texto, tem uns 5 MB e é SÍNCRONO —
 * escrever o retrato das consultas nele travaria a tela a cada gravação. E,
 * decisivo aqui, um rascunho de situação carrega BLOB de vídeo: 30-55 MB que
 * não cabem, e que em localStorage teriam que virar base64 (mais 33%).
 *
 * IndexedDB guarda Blob nativamente, é assíncrono e tem cota de verdade.
 *
 * Por que não uma biblioteca: `idb-keyval` resolveria em três linhas, mas
 * toda dependência nova é uma coisa a mais para o Lovable instalar e para o
 * build quebrar. São 60 linhas; ficam aqui.
 */

const BANCO = "conciergeia-offline";
const VERSAO = 1;
const DEPOSITO = "kv";

let conexao: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (conexao) return conexao;
  conexao = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponível"));
      return;
    }
    const req = indexedDB.open(BANCO, VERSAO);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DEPOSITO)) req.result.createObjectStore(DEPOSITO);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Falha ao abrir o depósito"));
    // Aba anônima com armazenamento bloqueado nunca chama nem um nem outro.
    req.onblocked = () => reject(new Error("Depósito bloqueado"));
  });
  return conexao;
}

function transacao<T>(
  modo: IDBTransactionMode,
  fn: (loja: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(DEPOSITO, modo);
        const req = fn(tx.objectStore(DEPOSITO));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error("Falha no depósito"));
      }),
  );
}

/**
 * Todas as funções abaixo ENGOLEM o erro de propósito.
 *
 * Guardar offline é conforto, nunca requisito: em aba anônima, com cota cheia
 * ou com o armazenamento bloqueado pelo navegador, o app tem que continuar
 * funcionando exatamente como antes — só sem a rede de segurança.
 */
export async function idbLer<T>(chave: string): Promise<T | null> {
  try {
    const v = await transacao<T | undefined>("readonly", (loja) => loja.get(chave));
    return v ?? null;
  } catch {
    return null;
  }
}

export async function idbGravar(chave: string, valor: unknown): Promise<boolean> {
  try {
    await transacao("readwrite", (loja) => loja.put(valor, chave));
    return true;
  } catch {
    return false;
  }
}

export async function idbApagar(chave: string): Promise<void> {
  try {
    await transacao("readwrite", (loja) => loja.delete(chave));
  } catch {
    /* nada a fazer */
  }
}

export async function idbLimparTudo(): Promise<void> {
  try {
    await transacao("readwrite", (loja) => loja.clear());
  } catch {
    /* nada a fazer */
  }
}
