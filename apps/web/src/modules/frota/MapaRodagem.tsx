import { cn } from '../../design-system/cn';
import { Badge } from '../../design-system/components/Badge';
import { cpkFormatado, decimal, ROTULO_ALERTA, type MapaDeRodagem, type PosicaoDoMapa } from './tipos';

/**
 * Mapa de rodagem (secao 7.4): o caminhao visto de cima, uma linha por eixo,
 * posicao clicavel e cor pelo estado do sulco - verde, dourado, vermelho.
 */

const CORES: Record<PosicaoDoMapa['estado'], string> = {
  VERDE: 'border-ceara-verde bg-[rgba(30,122,68,0.10)] text-ceara-verde',
  DOURADO: 'border-ceara-ouro bg-[var(--ceara-ouro-15)] text-[#8a6300]',
  VERMELHO: 'border-ceara-vermelho bg-[rgba(192,57,43,0.10)] text-ceara-vermelho',
  VAZIA: 'border-dashed border-ceara-borda bg-white text-ceara-texto2',
};

function agruparPorEixo(posicoes: PosicaoDoMapa[]): Array<[number, PosicaoDoMapa[]]> {
  const eixos = new Map<number, PosicaoDoMapa[]>();
  for (const p of posicoes) {
    const atual = eixos.get(p.posicao.eixo) ?? [];
    atual.push(p);
    eixos.set(p.posicao.eixo, atual);
  }
  return [...eixos.entries()].sort((a, b) => a[0] - b[0]);
}

const ordemDoLado = (lado: string): number => (lado === 'ESQUERDO' ? 0 : lado === 'DIREITO' ? 2 : 1);

export function MapaRodagem({
  mapa,
  selecionada,
  onSelecionar,
}: {
  mapa: MapaDeRodagem;
  selecionada: string | null;
  onSelecionar: (posicao: PosicaoDoMapa) => void;
}) {
  const eixos = agruparPorEixo(mapa.posicoes);

  if (eixos.length === 0) {
    return (
      <p className="text-corpo text-ceara-texto2">
        Este veiculo ainda nao tem posicoes de pneu cadastradas. Cadastre o mapa de rodagem antes de instalar pneus.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {eixos.map(([eixo, posicoes]) => (
          <div key={eixo} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-legenda text-ceara-texto2">Eixo {eixo}</span>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {[...posicoes]
                .sort((a, b) => ordemDoLado(a.posicao.lado) - ordemDoLado(b.posicao.lado) || a.posicao.ordem - b.posicao.ordem)
                .map((p) => (
                  <button
                    key={p.posicao.id}
                    type="button"
                    onClick={() => onSelecionar(p)}
                    aria-pressed={selecionada === p.posicao.id}
                    title={p.pneu ? `${p.pneu.numeroFogo} · ${p.pneu.marca} ${p.pneu.modelo}` : 'Posicao vazia'}
                    className={cn(
                      'flex h-16 w-24 flex-col items-center justify-center rounded-lg border-2 px-1 text-legenda transition-shadow',
                      CORES[p.estado],
                      selecionada === p.posicao.id && 'ring-2 ring-ceara-azul ring-offset-1',
                    )}
                  >
                    <span className="font-semibold">{p.posicao.codigo}</span>
                    <span className="truncate">{p.pneu ? p.pneu.numeroFogo : 'vazia'}</span>
                    <span>{p.pneu?.sulcoAtualMm ? `${decimal(p.pneu.sulcoAtualMm, 1)} mm` : '—'}</span>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-legenda italic text-ceara-texto2">
        Verde: sulco de {decimal(mapa.faixas.verde, 1)} mm para cima. Dourado: entre {decimal(mapa.faixas.amarelo, 1)} e{' '}
        {decimal(mapa.faixas.verde, 1)} mm. Vermelho: abaixo de {decimal(mapa.faixas.amarelo, 1)} mm ou sem medicao.
        Limite legal de circulacao: {decimal(mapa.faixas.legalMm, 1)} mm.
      </p>
    </div>
  );
}

/** Detalhe da posicao selecionada, ao lado do mapa. */
export function DetalheDaPosicao({ posicao }: { posicao: PosicaoDoMapa }) {
  if (!posicao.pneu || !posicao.avaliacao) {
    return (
      <div className="text-corpo text-ceara-texto2">
        <p className="text-h3 text-ceara-texto">Posicao {posicao.posicao.codigo}</p>
        <p className="mt-1">Sem pneu instalado. Instale um pneu do estoque para ocupar esta posicao.</p>
      </div>
    );
  }

  const { pneu, avaliacao } = posicao;

  return (
    <dl className="flex flex-col gap-2 text-corpo">
      <div className="flex items-center justify-between">
        <p className="text-h3 text-ceara-texto">
          {posicao.posicao.codigo} · {pneu.numeroFogo}
        </p>
        <Badge tom={avaliacao.estado === 'VERDE' ? 'verde' : avaliacao.estado === 'DOURADO' ? 'ouro' : 'vermelho'}>
          {avaliacao.estado === 'VERDE' ? 'Em uso' : avaliacao.estado === 'DOURADO' ? 'Atencao' : 'Critico'}
        </Badge>
      </div>

      <Linha rotulo="Pneu">{`${pneu.marca} ${pneu.modelo} · ${pneu.medida}`}</Linha>
      <Linha rotulo="Tipo">{pneu.tipo === 'RECAPADO' ? `Recapado (${pneu.recapagens}x)` : 'Novo'}</Linha>
      <Linha rotulo="Sulco">{pneu.sulcoAtualMm ? `${decimal(pneu.sulcoAtualMm, 1)} mm` : 'sem medicao'}</Linha>
      <Linha rotulo="Km na posicao">{decimal(pneu.kmNaPosicao, 1)} km</Linha>
      <Linha rotulo="Km na vida">{decimal(pneu.kmAcumulado, 1)} km</Linha>
      <Linha rotulo="CPK">{cpkFormatado(pneu.cpk)}</Linha>

      {avaliacao.alertas.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {avaliacao.alertas.map((a) => (
            <li key={a} className="text-legenda text-ceara-vermelho">
              {ROTULO_ALERTA[a]}
            </li>
          ))}
        </ul>
      )}
    </dl>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-ceara-borda pb-1 last:border-0">
      <dt className="text-ceara-texto2">{rotulo}</dt>
      <dd className="text-right text-ceara-texto">{children}</dd>
    </div>
  );
}
