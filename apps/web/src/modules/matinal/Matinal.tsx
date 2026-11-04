import { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { cn } from '../../design-system/cn';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import {
  CHECKLIST_VESPERA, DURACAO_TOTAL_SEG, ETAPAS, FOCO_MES, LEMBRETES, ORACAO, ROTEIRO, TEMAS_CICLO_1,
  etapaAtual, type TemaSeed,
} from './conteudo';

const CHAVE_INICIO = 'matinal:inicio-ciclo';

function mmss(seg: number) {
  const s = Math.max(0, Math.floor(seg));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Data do encontro da semana N, a partir do 1o encontro ('AAAA-MM-DD', sem fuso). */
function dataDaSemana(inicio: string, semana: number) {
  const [a, m, d] = inicio.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + (semana - 1) * 7)).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

/**
 * Matinal Elo Forte: cronograma do ciclo, ficha do tema e roteiro cronometrado de 15 minutos.
 * So apresentacao do Guia - a ata digital continua no app proprio da Matinal.
 */
export function Matinal() {
  const [inicio, setInicio] = useState(() => localStorage.getItem(CHAVE_INICIO) ?? '');
  const [tema, setTema] = useState<TemaSeed>(TEMAS_CICLO_1[0]);

  useEffect(() => {
    if (inicio) localStorage.setItem(CHAVE_INICIO, inicio);
    else localStorage.removeItem(CHAVE_INICIO);
  }, [inicio]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ceara-azul">Matinal Elo Forte</h1>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            13 encontros em 3 meses, 1 por semana, mesmo dia e horario. 15 minutos em 6 etapas.
          </p>
        </div>
        <Campo rotulo="Data do 1o encontro" htmlFor="inicio-ciclo">
          <input id="inicio-ciclo" type="date" className={classeControle()}value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </Campo>
      </header>

      <Roteiro tema={tema} />

      <Card destaque="regra">
        <CardCorpo className="pt-4">
          <p className="italic">“{ORACAO}”</p>
          <ul className="mt-2 list-disc pl-5 text-legenda text-ceara-texto2">
            {LEMBRETES.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </CardCorpo>
      </Card>

      {[1, 2, 3].map((mes) => (
        <Card key={mes}>
          <CardTitulo>{mes}o mes · {FOCO_MES[mes].nome}</CardTitulo>
          <CardCorpo className="flex flex-col gap-2">
            <p className="text-legenda text-ceara-texto2">{FOCO_MES[mes].descricao}</p>
            {TEMAS_CICLO_1.filter((t) => t.mes === mes).map((t) => (
              <details key={t.semana} className={cn('rounded-lg border border-ceara-borda bg-white', tema.semana === t.semana && 'border-ceara-azul')}>
                <summary className="flex cursor-pointer items-center gap-3 px-3 py-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ceara-nevoa font-bold">{t.semana}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{t.titulo}</span>
                    <span className="block text-legenda text-ceara-texto2">
                      {inicio ? `${dataDaSemana(inicio, t.semana)} · ` : ''}{t.codigo_cultura}
                    </span>
                  </span>
                  {tema.semana === t.semana && <Badge tom="azul">No roteiro</Badge>}
                </summary>
                <div className="flex flex-col gap-3 border-t border-ceara-borda px-3 py-3">
                  <FichaTema tema={t} />
                  <Button tamanho="sm" variante="secundario" className="self-start" onClick={() => setTema(t)}>
                    Usar no roteiro
                  </Button>
                </div>
              </details>
            ))}
          </CardCorpo>
        </Card>
      ))}

      <p className="text-legenda text-ceara-texto2">
        Se o trimestre tiver so 12 semanas, junte os temas 12 e 13 no ultimo encontro.
      </p>
    </div>
  );
}

function FichaTema({ tema }: { tema: TemaSeed }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border-l-4 border-l-ceara-ouro bg-[var(--ceara-ouro-15)] px-3 py-2">
        <div className="text-legenda font-bold uppercase">No Código · {tema.codigo_cultura}</div>
        <p className="italic">“{tema.citacao}”</p>
      </div>
      <Bloco titulo="Fala de abertura">“{tema.fala_abertura}”</Bloco>
      <Bloco titulo="Exemplo do dia a dia">{tema.exemplo}</Bloco>
      <Bloco titulo="Pergunta para a equipe"><strong>“{tema.pergunta}”</strong></Bloco>
      <Bloco titulo="Combinado sugerido">{tema.combinado_sugerido}</Bloco>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-legenda font-bold uppercase text-ceara-texto2">{titulo}</div>
      <p>{children}</p>
    </div>
  );
}

/** Cronometro das 6 etapas com o roteiro da etapa corrente. Estado so na tela. */
function Roteiro({ tema }: { tema: TemaSeed }) {
  const [seg, setSeg] = useState(0);
  const [rodando, setRodando] = useState(false);

  useEffect(() => {
    if (!rodando) return;
    const t = window.setInterval(() => setSeg((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [rodando]);

  const etapa = etapaAtual(seg);
  const passo = ROTEIRO[etapa - 1];
  const esgotado = seg >= DURACAO_TOTAL_SEG;
  const irPara = (n: number) => setSeg(ETAPAS.slice(0, n - 1).reduce((s, e) => s + e.min * 60, 0));

  return (
    <Card destaque={esgotado ? 'risco' : 'nenhum'}>
      <CardTitulo
        acao={
          <span className="flex gap-2">
            <Button tamanho="sm" iconeEsquerda={rodando ? <Pause size={16} /> : <Play size={16} />} onClick={() => setRodando(!rodando)}>
              {rodando ? 'Pausar' : 'Iniciar'}
            </Button>
            <Button tamanho="sm" variante="secundario" iconeEsquerda={<RotateCcw size={16} />} onClick={() => { setRodando(false); setSeg(0); }}>
              Zerar
            </Button>
          </span>
        }
      >
        Roteiro · Semana {tema.semana}
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
          <span className={cn('font-mono text-[28px] font-bold tabular-nums', esgotado ? 'text-ceara-vermelho' : 'text-ceara-texto')}>
            {mmss(seg)}
            <span className="text-corpo font-medium text-ceara-texto2"> / 15:00</span>
          </span>
          <span className={cn('text-corpo', esgotado && 'font-bold text-ceara-vermelho')}>
            {esgotado ? 'Tempo esgotado · encerre' : <>Etapa {etapa}: <strong>{ETAPAS[etapa - 1].nome}</strong></>}
          </span>
        </div>

        <div className="flex gap-1">
          {ETAPAS.map((e) => {
            const inicioEtapa = ETAPAS.slice(0, e.n - 1).reduce((s, x) => s + x.min * 60, 0);
            const fracao = Math.min(1, Math.max(0, (seg - inicioEtapa) / (e.min * 60)));
            return (
              <button
                key={e.n}
                type="button"
                onClick={() => irPara(e.n)}
                className="relative h-2.5 overflow-hidden rounded-full bg-ceara-nevoa"
                style={{ flexGrow: e.min }}
                title={`${e.n}. ${e.nome} (${e.min} min)`}
                aria-label={`Ir para a etapa ${e.n}: ${e.nome}`}
              >
                <span
                  className={cn('absolute inset-y-0 left-0', esgotado ? 'bg-ceara-vermelho' : etapa === e.n ? 'bg-ceara-ouro' : 'bg-ceara-azul')}
                  style={{ width: `${fracao * 100}%` }}
                />
              </button>
            );
          })}
        </div>

        <div className="rounded-lg bg-ceara-nevoa p-3">
          <Bloco titulo="O que fazer">{passo.faz}</Bloco>
          <div className="mt-2">
            <Bloco titulo="O que falar">
              {etapa === 3 ? `“${tema.fala_abertura}”` : etapa === 4 ? `“${tema.pergunta}” “O que podemos fazer hoje para melhorar?”` : passo.fala}
            </Bloco>
          </div>
          {etapa === 2 && 'falaPrimeira' in passo && tema.semana === 1 && (
            <p className="mt-2 text-legenda text-ceara-texto2">Na 1a Matinal: {passo.falaPrimeira}</p>
          )}
          {etapa === 5 && <p className="mt-2 text-legenda text-ceara-texto2">Sugestao do tema: {tema.combinado_sugerido}</p>}
        </div>

        <details>
          <summary className="cursor-pointer text-legenda font-medium text-ceara-azul">Antes (na vespera)</summary>
          <ul className="mt-1 list-disc pl-5 text-legenda">
            {CHECKLIST_VESPERA.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </details>
      </CardCorpo>
    </Card>
  );
}
