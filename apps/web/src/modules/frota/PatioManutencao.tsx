import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, TriangleAlert } from 'lucide-react';
import { get } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo } from '../../design-system/components/Card';
import { classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import type { TipoServicoPeriodico } from './PainelPeriodico';

export type Severidade = 'EM_DIA' | 'ATENCAO' | 'CRITICO' | 'VENCIDO' | 'SEM_BASE';

interface ItemDoPatio {
  tipo: TipoServicoPeriodico;
  rotulo: string;
  base: 'HODOMETRO' | 'HORIMETRO' | 'DIAS';
  severidade: Severidade;
  usado: number;
  aVencer: string;
  vencido: string;
  proxima: string | null;
  proximaEm: string | null;
  executadoEm: string | null;
  motivo: string | null;
  alerta: string | null;
  venceEmDias: number | null;
  previstoPara: string | null;
}

interface VeiculoNoPatio {
  veiculoId: string;
  placa: string;
  frotaNumero: string;
  descricao: string;
  hodometro: string;
  kmPorDia: string | null;
  diasSemLeitura: number | null;
  venceEmDias: number | null;
  equipamento: { id: string; identificacao: string; horimetro: string | null } | null;
  itens: ItemDoPatio[];
  score: number;
  pior: Severidade;
  vencidos: number;
  criticos: number;
}

interface Patio {
  itens: VeiculoNoPatio[];
  resumo: Record<Severidade | 'total' | 'veiculos' | 'comVencido', number>;
}

/** Rotulo textual sempre junto da cor: a oficina e usada sob luz de galpao (ADR 0023). */
const ROTULO: Record<Severidade, string> = {
  VENCIDO: 'Vencido',
  CRITICO: 'Critico',
  ATENCAO: 'Atencao',
  EM_DIA: 'Em dia',
  SEM_BASE: 'Sem registro',
};

const COR_BARRA: Record<Severidade, string> = {
  VENCIDO: 'bg-ceara-vermelho',
  CRITICO: 'bg-[#D97706]',
  ATENCAO: 'bg-ceara-ouro',
  EM_DIA: 'bg-ceara-verde',
  SEM_BASE: 'bg-ceara-borda',
};

const COR_TEXTO: Record<Severidade, string> = {
  VENCIDO: 'text-ceara-vermelho',
  CRITICO: 'text-[#B45309]',
  ATENCAO: 'text-[#8a6300]',
  EM_DIA: 'text-ceara-verde',
  SEM_BASE: 'text-ceara-texto2',
};

const FILTROS: Array<{ chave: 'TODOS' | Severidade; rotulo: string }> = [
  { chave: 'TODOS', rotulo: 'Todos' },
  { chave: 'VENCIDO', rotulo: 'Vencidos' },
  { chave: 'CRITICO', rotulo: 'Criticos' },
  { chave: 'ATENCAO', rotulo: 'Atencao' },
  { chave: 'SEM_BASE', rotulo: 'Sem registro' },
];

const numero = (v: string | null): string =>
  v === null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(v));

const unidadeDa = (base: ItemDoPatio['base']): string =>
  base === 'HORIMETRO' ? 'h' : base === 'DIAS' ? 'dias' : 'km';

/**
 * Patio da oficina (ADR 0023).
 *
 * Uma linha por veiculo, os itens do plano lado a lado, ordenados pelo score. O ganho nao
 * e saber que um item venceu — o painel por tipo ja dizia isso —, e sim ver **o que a mesma
 * parada resolve**: caminhao com tres itens vencidos sobe na fila porque uma viagem ao box
 * resolve os tres.
 */
export function PatioManutencao({ unidadeId }: { unidadeId?: string }) {
  const [filtro, setFiltro] = useState<'TODOS' | Severidade>('TODOS');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);

  const patio = useQuery({
    queryKey: ['periodicos', 'patio', unidadeId],
    queryFn: () => get<Patio>(`/transporte/periodicos/patio${unidadeId ? `?unidadeId=${unidadeId}` : ''}`),
  });

  if (patio.isLoading) return <p className="text-corpo text-ceara-texto2">Carregando o patio...</p>;
  const dados = patio.data;
  if (!dados) return null;

  const termo = busca.trim().toUpperCase();
  const linhas = dados.itens
    .filter((v) => (filtro === 'TODOS' ? true : v.itens.some((i) => i.severidade === filtro)))
    .filter((v) => termo === '' || v.placa.includes(termo) || v.descricao.toUpperCase().includes(termo));

  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-3 sm:grid-cols-5">
        <Resumo rotulo="Itens vencidos" valor={dados.resumo.VENCIDO} severidade="VENCIDO" />
        <Resumo rotulo="Criticos" valor={dados.resumo.CRITICO} severidade="CRITICO" />
        <Resumo rotulo="Em atencao" valor={dados.resumo.ATENCAO} severidade="ATENCAO" />
        <Resumo rotulo="Sem registro" valor={dados.resumo.SEM_BASE} severidade="SEM_BASE" />
        <Resumo
          rotulo="Veiculos com vencido"
          valor={dados.resumo.comVencido}
          severidade="VENCIDO"
          rodape={`de ${dados.resumo.veiculos} na frota`}
        />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Placa ou modelo"
          aria-label="Buscar veiculo"
          className={`${classeControle()} max-w-xs`}
        />
        <div className="flex flex-wrap gap-1">
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              type="button"
              onClick={() => setFiltro(f.chave)}
              aria-current={filtro === f.chave}
              className={cn(
                'rounded-full border px-3 py-1 text-legenda transition-colors',
                filtro === f.chave
                  ? 'border-ceara-azul bg-[var(--ceara-azul-10)] font-medium text-ceara-azul'
                  : 'border-ceara-borda text-ceara-texto2 hover:border-ceara-azul',
              )}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
        <span className="text-legenda text-ceara-texto2">
          {linhas.length} veiculo(s) · fila ordenada pelo que a mesma parada resolve
        </span>
      </div>

      {linhas.length === 0 ? (
        <Card>
          <EstadoVazio titulo="Nada nesta faixa" descricao="Nenhum veiculo se encaixa no filtro escolhido." />
        </Card>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Veiculo</Th>
              <Th className="text-right">Medidor</Th>
              <Th className="text-right">Vence em</Th>
              <Th>Itens do plano</Th>
              <Th className="text-right">Fila</Th>
            </Tr>
          </Thead>
          <Tbody>
            {linhas.map((v) => (
              <Tr key={v.veiculoId}>
                <Td>
                  <button
                    type="button"
                    className="text-left"
                    onClick={() => setAberto(aberto === v.veiculoId ? null : v.veiculoId)}
                  >
                    <span className="font-mono font-medium text-ceara-azul">{v.placa}</span>
                    <p className="text-legenda text-ceara-texto2">
                      frota {v.frotaNumero} · {v.descricao}
                    </p>
                  </button>
                  {aberto === v.veiculoId && <Detalhe veiculo={v} />}
                </Td>
                <Td className="text-right font-mono">
                  {numero(v.hodometro)} km
                  {v.equipamento && (
                    <p className="text-legenda text-ceara-texto2">
                      {v.equipamento.identificacao}: {numero(v.equipamento.horimetro)} h
                    </p>
                  )}
                </Td>
                {/* a coluna que monta a semana: "vence em 6 dias" decide melhor que "faltam 1.200 km" */}
                <Td className="text-right">
                  <PrevisaoDoVeiculo veiculo={v} />
                </Td>
                <Td>
                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {v.itens.map((i) => (
                      <BarraDoItem key={i.tipo} item={i} />
                    ))}
                  </div>
                </Td>
                <Td className="text-right">
                  <span className={cn('font-mono text-h3', COR_TEXTO[v.pior])}>{v.score}</span>
                  <p className="text-legenda text-ceara-texto2">
                    {v.vencidos > 0 ? `${v.vencidos} vencido(s)` : ROTULO[v.pior]}
                  </p>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}

/**
 * Barra de um item: enche conforme o ciclo e consumido, e o numero a direita e o que falta.
 * O rotulo textual acompanha a cor — nunca so a cor.
 */
/**
 * Previsao de entrada no box.
 *
 * Sem ritmo apurado a tela diz **sem base**, e nao um numero — prever com uma leitura so
 * seria chutar. Veiculo muito tempo sem leitura tambem e avisado: ou esta parado, ou parou
 * de dar sinal, e nos dois casos a previsao envelheceu.
 */
function PrevisaoDoVeiculo({ veiculo }: { veiculo: VeiculoNoPatio }) {
  if (veiculo.kmPorDia === null) {
    return <span className="text-legenda text-ceara-texto2">sem base</span>;
  }

  const dias = veiculo.venceEmDias;
  const parado = (veiculo.diasSemLeitura ?? 0) > 10;

  return (
    <span className="flex flex-col items-end">
      <span className={cn('font-medium', dias !== null && dias <= 7 && 'text-ceara-vermelho')}>
        {dias === null ? '—' : dias === 0 ? 'hoje' : `${dias} dia${dias === 1 ? '' : 's'}`}
      </span>
      <span className="text-legenda text-ceara-texto2">{Number(veiculo.kmPorDia).toLocaleString('pt-BR')} km/dia</span>
      {parado && (
        <span className="text-legenda text-ceara-ouro">sem leitura ha {veiculo.diasSemLeitura} dias</span>
      )}
    </span>
  );
}

function BarraDoItem({ item }: { item: ItemDoPatio }) {
  const largura = Math.min(Math.max(item.usado, 0), 1) * 100;
  const unidade = unidadeDa(item.base);

  const restante =
    item.severidade === 'SEM_BASE'
      ? 'sem base'
      : item.severidade === 'VENCIDO'
        ? `-${numero(item.vencido)} ${unidade}`
        : `${numero(item.aVencer)} ${unidade}`;

  return (
    <span className="flex flex-col gap-0.5" title={item.motivo ?? item.alerta ?? undefined}>
      <span className="flex items-center justify-between gap-2 text-legenda">
        <span className="flex items-center gap-1 text-ceara-texto2">
          {item.rotulo}
          {item.alerta && <TriangleAlert size={12} className="text-ceara-ouro" aria-label="Leitura a confirmar" />}
        </span>
        <span className={cn('font-mono', COR_TEXTO[item.severidade])}>{restante}</span>
      </span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-ceara-nevoa" aria-hidden>
        <span className={cn('block h-full rounded-full', COR_BARRA[item.severidade])} style={{ width: `${largura}%` }} />
      </span>
      <span className="sr-only">
        {item.rotulo}: {ROTULO[item.severidade]}
      </span>
    </span>
  );
}

/** Detalhe da linha: o que a barra nao cabe — data da ultima, proximo e o porque do status. */
function Detalhe({ veiculo }: { veiculo: VeiculoNoPatio }) {
  return (
    <div className="mt-2 flex flex-col gap-1 rounded-card border border-ceara-borda bg-ceara-nevoa p-2">
      {veiculo.itens.map((i) => (
        <p key={i.tipo} className="text-legenda">
          <span className={cn('font-medium', COR_TEXTO[i.severidade])}>{ROTULO[i.severidade]}</span>{' '}
          <span className="text-ceara-texto">{i.rotulo}</span>
          <span className="text-ceara-texto2">
            {' · ultima '}
            {i.executadoEm ? new Date(i.executadoEm).toLocaleDateString('pt-BR') : 'nunca registrada'}
            {i.proxima && ` · proxima em ${numero(i.proxima)} ${unidadeDa(i.base)}`}
            {i.proximaEm && ` · proxima em ${new Date(i.proximaEm).toLocaleDateString('pt-BR')}`}
            {i.venceEmDias !== null && ` · vence em ${i.venceEmDias} dia${i.venceEmDias === 1 ? '' : 's'}`}
            {i.motivo && ` · ${i.motivo}`}
          </span>
          {i.alerta && (
            <span className="mt-0.5 flex items-start gap-1 text-ceara-vermelho">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
              {i.alerta}
            </span>
          )}
        </p>
      ))}
    </div>
  );
}

function Resumo({
  rotulo,
  valor,
  severidade,
  rodape,
}: {
  rotulo: string;
  valor: number;
  severidade: Severidade;
  rodape?: string;
}) {
  return (
    <Card destaque={severidade === 'VENCIDO' && valor > 0 ? 'risco' : 'nenhum'}>
      <CardCorpo className="pt-4">
        <p className="text-legenda text-ceara-texto2">{rotulo}</p>
        <p className={cn('text-h1', COR_TEXTO[severidade])}>{valor}</p>
        {rodape && <p className="text-legenda italic text-ceara-texto2">{rodape}</p>}
      </CardCorpo>
    </Card>
  );
}

/** Botao de recarga usado pela pagina que hospeda o patio. */
export function BotaoAtualizarPatio({ aoAtualizar }: { aoAtualizar: () => void }) {
  return (
    <Button variante="secundario" onClick={aoAtualizar}>
      Atualizar
    </Button>
  );
}
