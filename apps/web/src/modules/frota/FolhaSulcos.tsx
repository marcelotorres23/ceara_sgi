import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { Button } from '../../design-system/components/Button';
import type { MapaDeRodagem, PosicaoDoMapa } from './tipos';

/**
 * Folha de checagem de sulcos para o patio (secao 7.4).
 *
 * E a versao em sistema do papel que a operacao ja usa: o caminhao visto de cima, uma
 * caixa por posicao, e o medidor anda com a prancheta. O que muda em relacao ao papel:
 *
 * - **Nao ha campo de identificacao do pneu.** O pneu ja e marcado no costado, e ele roda
 *   entre posicoes no rodizio — pedir o numero de fogo na folha e pedir para alguem
 *   transcrever errado. Quem sabe qual pneu esta em cada posicao e o sistema.
 * - **A folha nasce do mapa de rodagem do veiculo**: sai o numero certo de eixos e de
 *   posicoes, e posicao vazia vem marcada como vazia, em vez de virar caixa em branco que
 *   ninguem sabe se e "sem pneu" ou "esqueci de medir".
 * - **A caixa vem em branco de proposito.** Imprimir a ultima medicao ao lado ancora quem
 *   mede: e mais facil confirmar o numero de antes do que encostar o paquimetro.
 * - O limite legal e as faixas vem impressos, porque a decisao de tirar o pneu de operacao
 *   e da regra, e nao da memoria de quem esta com a prancheta.
 */
export function FolhaSulcos({ veiculoId, aoFechar }: { veiculoId: string; aoFechar: () => void }) {
  const mapa = useQuery({
    queryKey: ['pneus', 'mapa', veiculoId],
    queryFn: () => get<MapaDeRodagem>(`/transporte/pneus/mapa/${veiculoId}`),
  });

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aoFechar]);

  if (mapa.isLoading) return <p className="text-corpo text-ceara-texto2">Carregando o mapa de rodagem...</p>;
  if (!mapa.data) return null;

  const d = mapa.data;
  const eixos = agruparPorEixo(d.posicoes.filter((p) => p.posicao.lado !== 'ESTEPE'));
  const estepes = d.posicoes.filter((p) => p.posicao.lado === 'ESTEPE');

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 print:static print:bg-white print:p-0">
      <div className="mx-auto max-w-[210mm] rounded-card bg-white p-8 shadow-card print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <div className="mb-6 flex justify-end gap-2 print:hidden">
          <Button variante="texto" onClick={aoFechar}>
            Fechar
          </Button>
          <Button onClick={() => window.print()}>Imprimir</Button>
        </div>

        <article className="text-[11pt] leading-snug text-black">
          <header className="mb-4 border-b-2 border-black pb-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[16pt] font-bold tracking-wide">CEARA ALIMENTOS</p>
                <p className="text-[9pt]">
                  {d.veiculo.unidade.nome} · frota {d.veiculo.frotaNumero}
                </p>
              </div>
              <p className="text-[13pt] font-bold uppercase tracking-wide">Checagem de sulcos</p>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-6 text-[10pt]">
              <Campo rotulo="Placa" largura="w-40">
                <span className="font-mono text-[14pt] font-bold">{d.veiculo.placa}</span>
              </Campo>
              <Campo rotulo="Data" largura="w-40" />
              <Campo rotulo="Km" largura="w-40">
                <span className="text-[10pt] text-neutral-500">
                  cadastro: {Number(d.veiculo.hodometroAtual).toLocaleString('pt-BR')}
                </span>
              </Campo>
              <Campo rotulo="Quem mediu" largura="w-56" />
            </div>
          </header>

          <p className="mb-4 text-[9pt]">
            Anote o sulco em milimetros na caixa de cada posicao. Legenda impressa no rodape. Nao ha campo de
            identificacao do pneu: o pneu e marcado e roda entre posicoes — quem guarda essa relacao e o sistema.
          </p>

          <div className="flex flex-col gap-4">
            {eixos.map(([eixo, posicoes], indice) => (
              <section key={eixo} className="border border-black">
                <p className="border-b border-black bg-neutral-100 px-2 py-1 text-[9pt] font-bold uppercase tracking-wide">
                  {indice === 0 ? 'Eixo dianteiro' : `Eixo traseiro ${indice}`}
                </p>
                <div className="grid grid-cols-2">
                  <LadoDoEixo posicoes={posicoes.filter((p) => p.posicao.lado === 'ESQUERDO')} lado="Esquerdo" />
                  <LadoDoEixo
                    posicoes={posicoes.filter((p) => p.posicao.lado === 'DIREITO')}
                    lado="Direito"
                    className="border-l border-black"
                  />
                </div>
              </section>
            ))}

            <section className="border border-black">
              <p className="border-b border-black bg-neutral-100 px-2 py-1 text-[9pt] font-bold uppercase tracking-wide">
                Estepe
              </p>
              <div className="grid grid-cols-2">
                {estepes.length > 0 ? (
                  <LadoDoEixo posicoes={estepes} lado="Estepe" />
                ) : (
                  <div className="p-3">
                    <CaixaDeMedida codigo="ESTEP" descricao="Estepe" vazia={false} />
                  </div>
                )}
                <div className="border-l border-black p-3 text-[9pt]">
                  <p className="font-bold uppercase tracking-wide">Observacoes</p>
                  {[0, 1, 2].map((i) => (
                    <p key={i} className="mt-3 border-b border-dotted border-black">
                      &nbsp;
                    </p>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <footer className="mt-5 flex items-end justify-between border-t border-black pt-3 text-[9pt]">
            <div>
              <p className="font-bold uppercase tracking-wide">Como classificar</p>
              <p>
                Verde: {d.faixas.verde} mm ou mais · Atencao: entre {d.faixas.amarelo} e {d.faixas.verde} mm ·
                Critico: abaixo de {d.faixas.amarelo} mm
              </p>
              <p className="font-bold">
                Abaixo de {d.faixas.legalMm} mm o pneu esta fora do limite legal e sai de operacao — nao e decisao de
                quem mede, e regra.
              </p>
            </div>
            <div className="w-56 border-t border-black pt-1 text-center">Assinatura</div>
          </footer>
        </article>
      </div>
    </div>
  );
}

function Campo({ rotulo, largura, children }: { rotulo: string; largura: string; children?: React.ReactNode }) {
  return (
    <div>
      <span className="text-[8pt] uppercase tracking-wide">{rotulo}</span>
      <div className={`${largura} border-b border-black pb-0.5`}>{children ?? <>&nbsp;</>}</div>
    </div>
  );
}

/**
 * Um lado do eixo. Em rodado duplo a ordem manda: a menor e a de fora, a maior a de dentro
 * — mesma convencao do cadastro do mapa de rodagem, para o papel nao contar outra historia.
 */
function LadoDoEixo({
  posicoes,
  lado,
  className,
}: {
  posicoes: PosicaoDoMapa[];
  lado: string;
  className?: string;
}) {
  const ordenadas = [...posicoes].sort((a, b) => a.posicao.ordem - b.posicao.ordem);
  const duplo = ordenadas.length > 1;

  return (
    <div className={`flex flex-col gap-2 p-3 ${className ?? ''}`}>
      <p className="text-[8pt] uppercase tracking-wide text-neutral-600">{lado}</p>
      {ordenadas.length === 0 && <p className="text-[9pt] text-neutral-500">Sem posicao cadastrada.</p>}
      {ordenadas.map((p, i) => (
        <CaixaDeMedida
          key={p.posicao.id}
          codigo={p.posicao.codigo}
          descricao={duplo ? (i === 0 ? 'Fora' : 'Dentro') : lado}
          vazia={p.pneu === null}
        />
      ))}
    </div>
  );
}

/** Caixa de escrita: grande para caber numero a lapis com luva. */
function CaixaDeMedida({ codigo, descricao, vazia }: { codigo: string; descricao: string; vazia: boolean }) {
  return (
    <div className="flex items-stretch">
      <div className="flex h-11 flex-1 items-center justify-end border border-black px-2">
        {vazia && <span className="text-[8pt] uppercase tracking-wide text-neutral-500">sem pneu na posicao</span>}
      </div>
      <div className="flex h-11 w-20 flex-col items-center justify-center border border-l-0 border-black bg-neutral-100">
        <span className="font-mono text-[11pt] font-bold leading-none">{codigo}</span>
        <span className="text-[7pt] uppercase tracking-wide text-neutral-600">{descricao}</span>
      </div>
    </div>
  );
}

function agruparPorEixo(posicoes: PosicaoDoMapa[]): Array<[number, PosicaoDoMapa[]]> {
  const eixos = new Map<number, PosicaoDoMapa[]>();
  for (const p of posicoes) {
    const atual = eixos.get(p.posicao.eixo) ?? [];
    atual.push(p);
    eixos.set(p.posicao.eixo, atual);
  }
  return [...eixos.entries()].sort((a, b) => a[0] - b[0]);
}
