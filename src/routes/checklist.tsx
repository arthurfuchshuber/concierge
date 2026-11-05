import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import {
  INFO_PADRAO,
  infoValida,
  lugaresDeDormir,
  montarChecklist,
  progresso,
  saldoDeLugares,
  totalCamas,
  type Info,
} from "@/lib/checklist/catalog";
import "./checklist.css";

/**
 * CHECKLIST MASTER — página isolada (Anfitrião Sigma).
 *
 * Link próprio: /checklist. Não usa o painel, não consulta imóveis nem
 * assinaturas do Concierge: depois do login, tudo que a pessoa vê e grava
 * (informações do imóvel e itens marcados) fica na conta dela.
 */
export const Route = createFileRoute("/checklist")({
  head: () => ({
    meta: [
      { title: "CheckList de Imóvel — Anfitrião Sigma" },
      {
        name: "description",
        content: "Quantidades mínimas por ambiente para equipar o seu imóvel de temporada, calculadas a partir das informações do imóvel.",
      },
      { name: "robots", content: "noindex" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap",
      },
    ],
  }),
  component: ChecklistPage,
});

type Saved = { info: Info; marcados: string[]; etapa: "info" | "lista" };
const VAZIO: Saved = { info: INFO_PADRAO, marcados: [], etapa: "info" };
const chave = (uid: string) => `sigma-checklist:${uid}`;

function lerLocal(uid: string): Saved | null {
  try {
    const raw = window.localStorage.getItem(chave(uid));
    return raw ? ({ ...VAZIO, ...JSON.parse(raw) } as Saved) : null;
  } catch {
    return null;
  }
}

function ChecklistPage() {
  const [pronto, setPronto] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data: d }) => {
      setSession(d.session);
      setPronto(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <div className="ckm">
      {!pronto ? <div className="ckm-load">Carregando…</div> : session ? <App session={session} /> : <Login />}
    </div>
  );
}

/* ───────────────────────────── Login ───────────────────────────── */

function Login() {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const destino = () => `${window.location.origin}/checklist`;

  async function entrar(provedor: "google" | "apple" | "microsoft") {
    setBusy(true);
    setErro("");
    try {
      // Microsoft volta pela rota /auth (callback já validado no Concierge) e
      // retorna aqui por `next`.
      const redirect_uri =
        provedor === "microsoft" ? `${window.location.origin}/auth?next=%2Fchecklist` : destino();
      const r = await lovable.auth.signInWithOAuth(provedor, {
        redirect_uri,
        ...(provedor === "google" ? { extraParams: { prompt: "select_account" } } : {}),
      });
      if (r.error) setErro("Não foi possível entrar. Tente novamente.");
    } catch {
      setErro("Não foi possível entrar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  const Btn = ({ p, letra, nome }: { p: "google" | "apple" | "microsoft"; letra: string; nome: string }) => (
    <button className="ckm-oauth" disabled={busy} onClick={() => entrar(p)}>
      <span className="ic">{letra}</span>
      <b>Continuar com {nome}</b>
    </button>
  );

  return (
    <div className="ckm-lp">
      <div className="ckm-lc">
        <div className="ckm-mk">σ</div>
        <h2>Entrar</h2>
        <p className="ls">Acesse o CheckList de Imóvel com a sua conta.</p>
        <Btn p="google" letra="G" nome="Gmail" />
        <Btn p="microsoft" letra="O" nome="Outlook ou Hotmail" />
        <Btn p="apple" letra="A" nome="Apple" />
        {erro && <p className="ckm-err">{erro}</p>}
        <p className="lt">Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade.</p>
      </div>
    </div>
  );
}

/* ───────────────────────────── App ───────────────────────────── */

function App({ session }: { session: Session }) {
  const uid = session.user.id;
  const email = session.user.email ?? "";
  const [dados, setDados] = useState<Saved | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const local = lerLocal(uid);
    const nuvem = (session.user.user_metadata?.sigma_checklist ?? null) as Saved | null;
    setDados(local ?? (nuvem ? { ...VAZIO, ...nuvem } : VAZIO));
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = useCallback(
    (novo: Saved) => {
      setDados(novo);
      try {
        window.localStorage.setItem(chave(uid), JSON.stringify(novo));
      } catch {
        /* sem armazenamento local */
      }
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void supabase.auth.updateUser({ data: { sigma_checklist: novo } });
      }, 1500);
    },
    [uid],
  );

  if (!dados) return <div className="ckm-load">Carregando…</div>;

  return (
    <div className="ckm-fr">
      <TopBar email={email} />
      {dados.etapa === "lista" && infoValida(dados.info) ? (
        <Lista dados={dados} salvar={salvar} />
      ) : (
        <Informacoes dados={dados} salvar={salvar} />
      )}
    </div>
  );
}

function TopBar({ email }: { email: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="ckm-tb">
      <div className="lg">σ</div>
      <b>Checklist Master</b>
      <span>Anfitrião Sigma</span>
      <div className="pfw">
        <button className="pf" aria-label="Perfil" onClick={() => setAberto((v) => !v)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="8.5" r="3.6" />
            <path d="M4.8 20c.6-3.6 3.5-5.6 7.2-5.6s6.6 2 7.2 5.6" />
          </svg>
        </button>
        {aberto && (
          <div className="mn">
            <small>{email}</small>
            <button onClick={() => supabase.auth.signOut()}>Sair</button>
          </div>
        )}
      </div>
    </div>
  );
}

const Chevron = ({ aberto }: { aberto: boolean }) => (
  <i className={`cv${aberto ? " o" : ""}`}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </i>
);

/* ─────────────────── Informações do Imóvel ─────────────────── */

const TIPOS: Info["tipo"][] = ["Studio", "Apartamento", "Casa", "Quarto/Suíte"];

function Stepper({ valor, onChange, min = 0 }: { valor: number; onChange: (n: number) => void; min?: number }) {
  return (
    <div className="stp">
      <button aria-label="Diminuir" disabled={valor <= min} onClick={() => onChange(valor - 1)}>
        −
      </button>
      <b>{valor}</b>
      <button aria-label="Aumentar" onClick={() => onChange(valor + 1)}>
        +
      </button>
    </div>
  );
}

function Informacoes({ dados, salvar }: { dados: Saved; salvar: (d: Saved) => void }) {
  const { info } = dados;
  const [abertos, setAbertos] = useState<string[]>(["t", "h", "e"]);
  const alt = (v: boolean, id: string) =>
    setAbertos((a) => (v ? a.filter((x) => x !== id) : [...a, id]));
  const set = (p: Partial<Info>) => salvar({ ...dados, info: { ...info, ...p } });

  const lugares = lugaresDeDormir(info);
  const camas = totalCamas(info);
  const saldo = saldoDeLugares(info);
  const ok = infoValida(info);

  const Ac = ({ id, titulo, resumo, children }: { id: string; titulo: string; resumo?: string; children: React.ReactNode }) => {
    const o = abertos.includes(id);
    return (
      <div className={`ac${o ? " o" : ""}`}>
        <div className="hd" onClick={() => alt(o, id)}>
          <div className="nm">
            <h3>{titulo}</h3>
            {!o && resumo && <small>{resumo}</small>}
          </div>
          <Chevron aberto={o} />
        </div>
        {o && <div className="bd">{children}</div>}
      </div>
    );
  };
  const Lin = ({ n, sub, v, k, min = 0, erro }: { n: string; sub: string; v: number; k: keyof Info; min?: number; erro?: boolean }) => (
    <div className={`rw${erro ? " er" : ""}`}>
      <div>
        <b>{n}</b>
        <small>{sub}</small>
      </div>
      <Stepper valor={v} min={min} onChange={(x) => set({ [k]: x } as Partial<Info>)} />
    </div>
  );
  const er = saldo !== 0;

  return (
    <>
      <h1>Informações do Imóvel</h1>
      <p className="sb">Selecione as quantidades. Todo o checklist é calculado a partir delas.</p>
      {er && (
        <div className="bn">
          <i>!</i>
          <div>
            <b>{saldo < 0 ? `Faltam ${-saldo} lugares de dormir` : `Há ${saldo} lugares de dormir a mais`}</b>
            <span>
              As camas acomodam {lugares} pessoas e o imóvel está configurado para {info.hospedes} hóspedes.{" "}
              {saldo < 0 ? "Adicione camas ou reduza a capacidade." : "Aumente a capacidade ou remova camas."}
            </span>
          </div>
        </div>
      )}
      <div className="acs">
        <Ac id="t" titulo="Tipo de imóvel" resumo={info.tipo}>
          <div className="tp">
            {TIPOS.map((t) => (
              <button key={t} className={t === info.tipo ? "s" : ""} onClick={() => set({ tipo: t })}>
                {t}
              </button>
            ))}
          </div>
        </Ac>
        <Ac id="h" titulo="Hóspedes e camas" resumo={`${info.hospedes} hóspedes · ${info.dormitorios} dormitórios · ${info.banheiros} banheiros · ${camas} camas`}>
          <Lin n="Hóspedes" sub="Capacidade máxima do imóvel" v={info.hospedes} k="hospedes" min={1} erro={er} />
          <Lin n="Dormitórios" sub="Ambientes de dormir" v={info.dormitorios} k="dormitorios" min={1} />
          <Lin n="Banheiros" sub="Completos e lavabos" v={info.banheiros} k="banheiros" min={1} />
          <Lin n="Camas Queen" sub="2 lugares cada. Prioridade quando o quarto comportar" v={info.queen} k="queen" erro={er} />
          <Lin n="Camas de solteiro" sub="1 lugar cada" v={info.solteiro} k="solteiro" erro={er} />
          <Lin n="Sofás-cama" sub="2 lugares cada (casal)" v={info.sofaCama} k="sofaCama" erro={er} />
        </Ac>
        <Ac id="e" titulo="Equipamentos" resumo={`${info.geladeira} geladeira · ${info.fogao} fogão · ${info.mesa} mesa`}>
          <Lin n="Geladeira" sub="Quantas?" v={info.geladeira} k="geladeira" />
          <Lin n="Frigobar" sub="Quantos?" v={info.frigobar} k="frigobar" />
          <Lin n="Fogão" sub="Quantos?" v={info.fogao} k="fogao" />
          <Lin n="Mesa de jantar" sub="Quantas?" v={info.mesa} k="mesa" />
        </Ac>
      </div>
      <div className="sm">
        <div className="ss">
          <div><b>{info.hospedes}</b><span>Hóspedes</span></div>
          <div><b>{camas}</b><span>Camas</span></div>
          <div><b>{lugares}</b><span>Lugares de dormir</span></div>
        </div>
        <div className="ax">
          {ok ? <div className="okc"><i>✓</i>Camas atendem a capacidade</div> : <div className="bad"><i>✕</i>{saldo < 0 ? `Faltam ${-saldo} lugares` : `Sobram ${saldo} lugares`}</div>}
          <button className="btn" disabled={!ok} onClick={() => salvar({ ...dados, etapa: "lista" })}>
            Continuar para o checklist
          </button>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────── CheckList de Imóvel ─────────────────────── */

function Lista({ dados, salvar }: { dados: Saved; salvar: (d: Saved) => void }) {
  const cats = useMemo(() => montarChecklist(dados.info), [dados.info]);
  const marcados = useMemo(() => new Set(dados.marcados), [dados.marcados]);
  const [abertos, setAbertos] = useState<string[]>([]);
  const todosAbertos = abertos.length === cats.length;

  const alternar = (id: string) =>
    setAbertos((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const marcar = (id: string) => {
    const s = new Set(dados.marcados);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    salvar({ ...dados, marcados: [...s] });
  };

  return (
    <>
      <h1>CheckList de Imóvel</h1>
      <p className="sb">Quantidades mínimas por ambiente, calculadas a partir das informações do imóvel.</p>
      <div className="lbr">
        <a onClick={() => salvar({ ...dados, etapa: "info" })}>← Informações do imóvel</a>
        <a onClick={() => setAbertos(todosAbertos ? [] : cats.map((c) => c.id))}>
          {todosAbertos ? "Recolher tudo" : "Expandir tudo"}
        </a>
      </div>
      <div className="acs">
        {cats.map((c) => {
          const o = abertos.includes(c.id);
          const p = progresso(c, marcados);
          return (
            <div key={c.id} className={`ac${o ? " o" : ""}`}>
              <div className="hd" onClick={() => alternar(c.id)}>
                <div className="nm">
                  <h3>{c.titulo}</h3>
                  {c.base && <small>{c.base}</small>}
                  {p.total > 0 && (
                    <div className="pg">
                      <div className="pgb"><i style={{ width: `${p.pct}%` }} /></div>
                      <span>{p.feitos} de {p.total} ({p.pct}%)</span>
                    </div>
                  )}
                </div>
                <Chevron aberto={o} />
              </div>
              {o && (
                <div className="bd">
                  {c.itens.map((x) => (
                    <div key={x.id} className={`it${marcados.has(x.id) ? " dn" : ""}`} onClick={() => marcar(x.id)}>
                      <div>
                        <b>
                          <span className="n">{x.nome}</span>
                          {x.cor && <span className="cl">{x.cor}</span>}
                        </b>
                        <small>{x.regra}</small>
                      </div>
                      <div className="q">{x.qtd}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
