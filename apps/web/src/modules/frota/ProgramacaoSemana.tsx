import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, TriangleAlert } from 'lucide-react';
import { baixarArquivo, get } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo } from '../../design-system/components/Card';
import { classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import type { TipoServicoPeriodico } from './PainelPeriodico';
import type { Severidade } from './PatioManutencao';

type Faixa = 'IMEDIATO' | 'ESTA_SEMANA' | 'PROXIMA_SEMANA';

interface ServicoProgramado {
  tipo: TipoServicoPeriodico;
  rotulo: string;
  base: 'HODOMETRO' | 'HORIMETRO' | 'DIAS';
  severidade: Severidade;
  encaixe: boolean;
  usado: number;
  aVencer: string;
  vencido: string;
  venceEmDias: number | null;
  motivo: string | null;
}

interface VeiculoProgramado {
  veiculoId: string;
  placa: string;
  frotaNumero: string;
  descricao: string;
  hodometro: string;
  kmPorDia: string | null;
  diasSemLeitura: number | null;
  faixa: Faixa;
  motivo: string;
  score: number;
  pior: Severidade;
  venceEmDias: number | null;
  servicos: ServicoProgramado[];
  motivadores: number;
  encaixes: number;
}

interface AtivoSemLeitura {
  veiculoId: string;
  placa: string;
  frotaNumero: string;
  descricao: string;
  hodometro: string;
  diasSemLeitura: number | null;
  motivo: string;
}

interface Programacao {
  horizonteDias: number;
  itens: VeiculoProgramado[];
  semLeitura: AtivoSemLeitura[];
  resumo: {
    veiculos: number;
    imediato: number;
    estaSemana: number;
    proximaSemana: number;
    servicos: number;
    encaixes: number;
    semLeitura: number;
  };
}

/** Rotulo textual sempre junto da cor: a oficina e usada sob luz de galpao (ADR 0023). */
const ROTULO_FAIXA: Record<Faixa, string> = {
  IMEDIATO: 'Entrar agora',
  ESTA_SEMANA: 'Esta semana',
  PROXIMA_SEMANA: 'Proxima semana',
};

const COR_FAIXA: Record<Faixa, string> = {
  IMEDIATO: 'border-ceara-vermelho text-ceara-vermelho',
  ESTA_SEMANA: 'border-ceara-ouro text-[#8a6300]',
  PROXIMA_SEMANA: 'border-ceara-borda text-ceara-texto2',
};

const ROTULO_SEVERIDADE: Record<Severidade, string> = {
  VENCIDO: 'Vencido',
  CRITICO: 'Critico',
  ATENCAO: 'Atencao',
  EM_DIA: 'Em dia',
  SEM_BASE: 'Sem registro',
};

const COR_SEVERIDADE: Record<Severidade, string> = {
  VENCIDO: 'text-ceara-vermelho',
  CRITICO: 'text-[#B45309]',
  ATENCAO: 'text-[#8a6300]',
  EM_DIA: 'text-ceara-verde',
  SEM_BASE: 'text-ceara-texto2',
};

const HORIZONTES = [7, 15, 30, 60];

const numero = (v: string | null): string =>
  v === null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(v));

const unidadeDa = (base: ServicoProgramado['base']): string =>
  base === 'HORIMETRO' ? 'h' : base === 'DIAS' ? 'dias' : 'km';

/**
 * Programacao da semana da oficina (ADR 0023, passo 3).
 *
 * O patio diz quem esta pior; esta tela diz **quem entra no box e o que se faz nele**. E a
 * rotina do item 6 do plano de manutencao preventiva: programa-se pelos vencidos e encaixa-se
 * o que estiver na mesma faixa, porque com o caminhao no elevador o encaixe custa a peca e nao
 * custa a parada.
 *
 * A lista de quem esta sem leitura fica na mesma tela, e nao num relatorio a parte: enquanto
 * ninguem ler aquele hodometro, a placa nao pode ser programada nem descartada.
 */
export function ProgramacaoSemana({ unidadeId }: { unidadeId?: string }) {
  const [horizonte, setHorizonte] = useState(7);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  const consulta = new URLSearchParams({
    horizonteDias: String(horizonte),
    ...(unidadeId ? { unidadeId } : {}),
  }).toString();

  const programacao = useQuery({
    queryKey: ['periodicos', 'programacao', unidadeId, horizonte],
    queryFn: () => get<Programacao>(`/transporte/periodicos/programacao?${consulta}`),
  });

  if (programacao.isLoading) return <p className="text-corpo text-ceara-texto2">Montando a programacao...</p>;
  const dados = programacao.data;
  if (!dados) return null;

  const termo = busca.trim().toUpperCase();
  const linhas = dados.itens.filter(
    (v) => termo === '' || v.placa.includes(termo) || v.descricao.toUpperCase().includes(termo),
  );

  const exportar = async () => {
    setBaixando(true);
    try {
      await baixarArquivo(`/transporte/periodicos/programacao.csv?${consulta}`, 'programacao-oficina.csv');
    } finally {
      setBaixando(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-3 sm:grid-cols-4">
        <Resumo rotulo="Entrar agora" valor={dados.resumo.imediato} destaque="text-ceara-vermelho" />
        <Resumo rotulo="Esta semana" valor={dados.resumo.estaSemana} destaque="text-[#8a6300]" />
        <Resumo
          rotulo="Servicos programados"
          valor={dados.resumo.servicos}
          rodape={`${dados.resumo.encaixes} aproveitando a mesma parada`}
        />
        <Resumo
          rotulo="Sem leitura"
          valor={dados.resumo.semLeitura}
          destaque="text-ceara-texto2"
          rodape="nao da para programar sem medidor"
        />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Placa ou modelo"
          aria-label="Buscar veiculo na programacao"
          className={`${classeControle()} max-w-xs`}
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Horizonte da programacao">
          {HORIZONTES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setHorizonte(d)}
              aria-current={horizonte === d}
              className={cn(
                'rounded-full border px-3 py-1 text-legenda transition-colors',
                horizonte === d
                  ? 'border-ceara-azul bg-[var(--ceara-azul-10)] font-medium text-ceara-azul'
                  : 'border-ceara-borda text-ceara-texto2 hover:border-ceara-azul',
              )}
            >
              {d} dias
            </button>
          ))}
        </div>
        <Button variante="secundario" onClick={exportar} disabled={baixando}>
          <Download size={16} aria-hidden /> {baixando ? 'Gerando...' : 'Exportar CSV'}
        </Button>
        <span className="text-legenda text-ceara-texto2">
          {linhas.length} veiculo(s) · fila ordenada pelo que a mesma parada resolve
        </span>
      </div>

      {linhas.length === 0 ? (
        <Card>
          <EstadoVazio
            titulo="Nada a programar neste horizonte"
            descricao="Nenhum veiculo vence dentro do prazo escolhido. Aumente o horizonte para enxergar mais longe."
          />
        </Card>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Veiculo</Th>
              <Th>Quando</Th>
              <Th className="text-right">Hodometro</Th>
              <Th className="text-right">Ritmo</Th>
              <Th>O que fazer na parada</Th>
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
                <Td>
                  <span
                    className={cn(
                      'inline-block rounded-full border px-2 py-0.5 text-legenda font-medium',
                      COR_FAIXA[v.faixa],
                    )}
                  >
                    {ROTULO_FAIXA[v.faixa]}
                  </span>
                  <p className="text-legenda text-ceara-texto2">{v.motivo}</p>
                </Td>
                <Td className="text-right font-mono">{numero(v.hodometro)} km</Td>
                <Td className="text-right font-mono">
                  {v.kmPorDia === null ? (
                    <span className="text-ceara-texto2">sem base</span>
                  ) : (
                    <>
                      {numero(v.kmPorDia)} km/dia
                      {v.diasSemLeitura !== null && v.diasSemLeitura >= 7 && (
                        <p className="text-legenda text-ceara-texto2">{v.diasSemLeitura} dias sem leitura</p>
                      )}
                    </>
                  )}
                </Td>
                <Td>
                  <ul className="flex flex-col gap-0.5">
                    {v.servicos.map((s) => (
                      <li key={s.tipo} className="text-legenda">
                        <span className={cn('font-medium', COR_SEVERIDADE[s.severidade])}>
                          {ROTULO_SEVERIDADE[s.severidade]}
                        </span>{' '}
                        <span className="text-ceara-texto">{s.rotulo}</span>
                        {s.encaixe && (
                          <span className="ml-1 rounded-sm border border-ceara-borda px-1 text-ceara-texto2">
                            encaixe
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {dados.semLeitura.length > 0 && <SemLeitura itens={dados.semLeitura} />}
    </div>
  );
}

/**
 * Detalhe da parada: o que cada servico tem de numero.
 *
 * Abre no clique da placa porque a lista de manha e para escolher o caminhao; o numero so
 * interessa depois que ele foi escolhido.
 */
function Detalhe({ veiculo }: { veiculo: VeiculoProgramado }) {
  return (
    <dl className="mt-2 flex flex-col gap-1 border-l-2 border-ceara-borda pl-3">
      {veiculo.servicos.map((s) => (
        <div key={s.tipo} className="text-legenda">
          <dt className="font-medium text-ceara-texto">
            {s.rotulo}
            {s.encaixe && <span className="ml-1 font-normal text-ceara-texto2">(encaixe na mesma parada)</span>}
          </dt>
          <dd className="text-ceara-texto2">
            {Number(s.vencido) > 0
              ? `${numero(s.vencido)} ${unidadeDa(s.base)} vencidos`
              : `faltam ${numero(s.aVencer)} ${unidadeDa(s.base)}`}
            {' · '}
            {Math.round(s.usado * 100)}% do ciclo
            {s.venceEmDias !== null && ` · vence em ${s.venceEmDias} dia(s)`}
            {s.motivo && ` · ${s.motivo}`}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Quem nao pode ser programado.
 *
 * Fica na mesma tela de proposito (consequencias do ADR 0023): silencio sobre falta de dado e
 * o pior modo de falha, e quem leva a lista ao patio e quem consegue ler aquele hodometro.
 */
function SemLeitura({ itens }: { itens: AtivoSemLeitura[] }) {
  return (
    <Card>
      <CardCorpo>
        <h3 className="flex items-center gap-2 text-corpo font-medium text-ceara-texto">
          <TriangleAlert size={16} className="text-ceara-texto2" aria-hidden />
          Sem leitura para programar ({itens.length})
        </h3>
        <p className="mt-1 text-legenda text-ceara-texto2">
          Enquanto ninguem registrar o medidor destas placas, elas nao podem ser programadas nem
          descartadas. Leia o hodometro no patio e lance no abastecimento ou na portaria.
        </p>
        <ul className="mt-3 flex flex-col gap-1">
          {itens.map((s) => (
            <li key={s.veiculoId} className="text-legenda">
              <span className="font-mono font-medium text-ceara-azul">{s.placa}</span>{' '}
              <span className="text-ceara-texto2">
                frota {s.frotaNumero} · {s.descricao} · {s.motivo}
              </span>
            </li>
          ))}
        </ul>
      </CardCorpo>
    </Card>
  );
}

function Resumo({
  rotulo,
  valor,
  destaque,
  rodape,
}: {
  rotulo: string;
  valor: number;
  destaque?: string;
  rodape?: string;
}) {
  return (
    <Card>
      <CardCorpo>
        <p className="text-legenda text-ceara-texto2">{rotulo}</p>
        <p className={cn('text-titulo font-semibold', destaque ?? 'text-ceara-azul')}>{valor}</p>
        {rodape && <p className="text-legenda text-ceara-texto2">{rodape}</p>}
      </CardCorpo>
    </Card>
  );
}
