import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { get } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';

interface Totais {
  abastecimentos: number;
  litros: string;
  valorTotal: string;
  kmPercorridos: string;
  consumoMedioKml: string | null;
  custoPorKm: string | null;
  precoMedioPorLitro: string | null;
  anomalias: number;
  semKmApurado: number;
}

interface Grupo extends Totais {
  chave: string;
}

interface ItemDoRelatorio {
  id: string;
  dataHora: string;
  veiculo: { id: string; placa: string; frotaNumero: string };
  motorista: string;
  posto: string;
  postoInterno: boolean;
  tipoCombustivel: string;
  litros: string;
  valorUnitario: string;
  valorTotal: string;
  hodometro: string;
  kmPercorridos: string | null;
  consumoKml: string | null;
  custoPorKm: string | null;
  anomalia: boolean;
  anomaliaTipos: string[];
  justificativa: string | null;
}

interface Relatorio {
  totais: Totais;
  porVeiculo: Grupo[];
  porMotorista: Grupo[];
  porPosto: Grupo[];
  porCombustivel: Grupo[];
  itens: ItemDoRelatorio[];
}

type Agrupamento = 'porVeiculo' | 'porMotorista' | 'porPosto' | 'porCombustivel';

const ROTULO_AGRUPAMENTO: Record<Agrupamento, string> = {
  porVeiculo: 'Por veiculo',
  porMotorista: 'Por motorista',
  porPosto: 'Por posto',
  porCombustivel: 'Por combustivel',
};

const num = (v: string | null, casas = 2): string =>
  v === null ? '—' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(Number(v));

const reais = (v: string | null): string => (v === null ? '—' : `R$ ${num(v)}`);
const dataBr = (iso: string): string => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Primeiro dia do mes corrente, no formato do input de data. */
const inicioDoMes = (): string => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const hoje = (): string => new Date().toISOString().slice(0, 10);

/**
 * Relatorio de abastecimento (secao 7.2).
 *
 * Os filtros sao os que a operacao usa de verdade: periodo, veiculo, motorista, onde
 * abasteceu, o que abasteceu e se deu anomalia. Todos combinaveis, e o topo da tela responde
 * pelo **mesmo recorte** da tabela — total que nao bate com a soma da lista destroi a
 * confianca no relatorio inteiro.
 */
export function RelatorioAbastecimento({ unidadeId }: { unidadeId?: string }) {
  const [de, setDe] = useState(inicioDoMes());
  const [ate, setAte] = useState(hoje());
  const [veiculoId, setVeiculoId] = useState('');
  const [motoristaId, setMotoristaId] = useState('');
  const [postoInterno, setPostoInterno] = useState('');
  const [tipoCombustivel, setCombustivel] = useState('');
  const [anomalia, setAnomalia] = useState('');
  const [busca, setBusca] = useState('');
  const [agrupamento, setAgrupamento] = useState<Agrupamento>('porVeiculo');

  /** Monta a query uma vez: relatorio e exportacao precisam sair do mesmo recorte. */
  const parametros = () => {
    const p = new URLSearchParams();
    if (de) p.set('de', new Date(`${de}T00:00:00`).toISOString());
    if (ate) p.set('ate', new Date(`${ate}T23:59:59`).toISOString());
    if (veiculoId) p.set('veiculoId', veiculoId);
    if (motoristaId) p.set('motoristaId', motoristaId);
    if (postoInterno) p.set('postoInterno', postoInterno);
    if (tipoCombustivel) p.set('tipoCombustivel', tipoCombustivel);
    if (anomalia) p.set('anomalia', anomalia);
    if (busca.trim()) p.set('busca', busca.trim());
    if (unidadeId) p.set('unidadeId', unidadeId);
    return p.toString();
  };

  const consulta = parametros();

  const relatorio = useQuery({
    queryKey: ['abastecimento', 'relatorio', consulta],
    queryFn: () => get<Relatorio>(`/transporte/abastecimentos/relatorio?${consulta}`),
  });

  const veiculos = useQuery({
    queryKey: ['frota', 'veiculos', unidadeId],
    queryFn: () =>
      get<{ itens: Array<{ id: string; placa: string; frotaNumero: string }> }>(
        `/transporte/veiculos?limite=100${unidadeId ? `&unidadeId=${unidadeId}` : ''}`,
      ),
  });

  const motoristas = useQuery({
    queryKey: ['frota', 'motoristas', unidadeId],
    queryFn: () =>
      get<{ itens: Array<{ id: string; nome: string }> }>(
        `/transporte/motoristas?limite=100${unidadeId ? `&unidadeId=${unidadeId}` : ''}`,
      ),
  });

  const opcoes = useQuery({
    queryKey: ['abastecimento', 'opcoes'],
    queryFn: () => get<{ combustiveis: string[]; postos: string[] }>('/transporte/abastecimentos/opcoes-de-filtro'),
    staleTime: 300_000,
  });

  const dados = relatorio.data;
  const grupos = dados?.[agrupamento] ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitulo>Filtros</CardTitulo>
        <CardCorpo className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Campo rotulo="De" htmlFor="f-de">
              <input id="f-de" type="date" className={classeControle()} value={de} onChange={(e) => setDe(e.target.value)} />
            </Campo>
            <Campo rotulo="Ate" htmlFor="f-ate">
              <input id="f-ate" type="date" className={classeControle()} value={ate} onChange={(e) => setAte(e.target.value)} />
            </Campo>
            <Campo rotulo="Veiculo" htmlFor="f-veiculo">
              <select id="f-veiculo" className={classeControle()} value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
                <option value="">Todos</option>
                {(veiculos.data?.itens ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.placa} · {v.frotaNumero}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Motorista" htmlFor="f-motorista">
              <select id="f-motorista" className={classeControle()} value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)}>
                <option value="">Todos</option>
                {(motoristas.data?.itens ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Campo rotulo="Onde abasteceu" htmlFor="f-interno">
              <select id="f-interno" className={classeControle()} value={postoInterno} onChange={(e) => setPostoInterno(e.target.value)}>
                <option value="">Todos</option>
                <option value="false">Posto de rua</option>
                <option value="true">Tanque proprio</option>
              </select>
            </Campo>
            <Campo rotulo="Combustivel" htmlFor="f-combustivel">
              <select id="f-combustivel" className={classeControle()} value={tipoCombustivel} onChange={(e) => setCombustivel(e.target.value)}>
                <option value="">Todos</option>
                {(opcoes.data?.combustiveis ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Anomalia" htmlFor="f-anomalia">
              <select id="f-anomalia" className={classeControle()} value={anomalia} onChange={(e) => setAnomalia(e.target.value)}>
                <option value="">Todos</option>
                <option value="true">So com anomalia</option>
                <option value="false">Sem anomalia</option>
              </select>
            </Campo>
            <Campo rotulo="Busca" htmlFor="f-busca" ajuda="Placa, frota, posto ou motorista.">
              <span className="flex items-center gap-2">
                <Search size={16} className="text-ceara-texto2" aria-hidden />
                <input id="f-busca" className={`${classeControle()} flex-1`} value={busca} onChange={(e) => setBusca(e.target.value)} />
              </span>
            </Campo>
          </div>

          <div className="flex justify-end">
            <a href={`/api/v1/transporte/abastecimentos/relatorio.csv?${consulta}`} download>
              <Button variante="secundario">
                <Download size={16} aria-hidden /> Exportar CSV
              </Button>
            </a>
          </div>
        </CardCorpo>
      </Card>

      {relatorio.isLoading && <p className="text-corpo text-ceara-texto2">Apurando o periodo...</p>}

      {dados && (
        <>
          <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Indicador rotulo="Abastecimentos" valor={String(dados.totais.abastecimentos)} />
            <Indicador rotulo="Litros" valor={num(dados.totais.litros, 1)} />
            <Indicador rotulo="Gasto" valor={reais(dados.totais.valorTotal)} />
            <Indicador rotulo="Km rodados" valor={num(dados.totais.kmPercorridos, 0)} />
            <Indicador
              rotulo="Consumo medio"
              valor={dados.totais.consumoMedioKml === null ? 'sem base' : `${num(dados.totais.consumoMedioKml, 2)} km/L`}
            />
            <Indicador
              rotulo="Custo por km"
              valor={dados.totais.custoPorKm === null ? 'sem base' : `R$ ${num(dados.totais.custoPorKm, 3)}`}
              tom={dados.totais.anomalias > 0 ? 'risco' : 'neutro'}
              rodape={dados.totais.anomalias > 0 ? `${dados.totais.anomalias} com anomalia` : undefined}
            />
          </section>

          {dados.totais.semKmApurado > 0 && (
            <p className="text-legenda italic text-ceara-texto2">
              {dados.totais.semKmApurado} registro(s) sem km apurado ficam fora do consumo medio — sao o primeiro
              abastecimento do veiculo ou vieram depois de hodometro retrocedido.
            </p>
          )}

          <Card>
            <CardTitulo
              acao={
                <select
                  className={classeControle()}
                  value={agrupamento}
                  onChange={(e) => setAgrupamento(e.target.value as Agrupamento)}
                  aria-label="Agrupar por"
                >
                  {(Object.keys(ROTULO_AGRUPAMENTO) as Agrupamento[]).map((a) => (
                    <option key={a} value={a}>
                      {ROTULO_AGRUPAMENTO[a]}
                    </option>
                  ))}
                </select>
              }
            >
              Onde foi o dinheiro
            </CardTitulo>
            <CardCorpo>
              {grupos.length === 0 ? (
                <p className="text-corpo text-ceara-texto2">Nada no periodo escolhido.</p>
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>{ROTULO_AGRUPAMENTO[agrupamento].replace('Por ', '')}</Th>
                      <Th className="text-right">Abast.</Th>
                      <Th className="text-right">Litros</Th>
                      <Th className="text-right">Gasto</Th>
                      <Th className="text-right">Consumo</Th>
                      <Th className="text-right">Custo/km</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {grupos.map((g) => (
                      <Tr key={g.chave}>
                        <Td className="font-medium">{g.chave}</Td>
                        <Td className="text-right">{g.abastecimentos}</Td>
                        <Td className="text-right">{num(g.litros, 1)}</Td>
                        <Td className="text-right font-mono">{reais(g.valorTotal)}</Td>
                        <Td className="text-right">{g.consumoMedioKml === null ? '—' : `${num(g.consumoMedioKml, 2)}`}</Td>
                        <Td className="text-right font-mono">{g.custoPorKm === null ? '—' : num(g.custoPorKm, 3)}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </CardCorpo>
          </Card>

          {dados.itens.length === 0 ? (
            <Card>
              <EstadoVazio
                titulo="Nenhum abastecimento no periodo"
                descricao="Ajuste os filtros ou registre o primeiro abastecimento da janela escolhida."
              />
            </Card>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Data</Th>
                  <Th>Veiculo</Th>
                  <Th>Motorista</Th>
                  <Th>Posto</Th>
                  <Th className="text-right">Litros</Th>
                  <Th className="text-right">Valor</Th>
                  <Th className="text-right">Km</Th>
                  <Th className="text-right">Consumo</Th>
                  <Th>Situacao</Th>
                </Tr>
              </Thead>
              <Tbody>
                {dados.itens.map((i) => (
                  <Tr key={i.id} className={cn(i.anomalia && 'bg-[rgba(192,57,43,0.04)]')}>
                    <Td>{dataBr(i.dataHora)}</Td>
                    <Td className="font-mono">{i.veiculo.placa}</Td>
                    <Td>{i.motorista}</Td>
                    <Td>
                      {i.posto}
                      {i.postoInterno && <p className="text-legenda text-ceara-texto2">tanque proprio</p>}
                    </Td>
                    <Td className="text-right">{num(i.litros, 1)}</Td>
                    <Td className="text-right font-mono">{reais(i.valorTotal)}</Td>
                    <Td className="text-right">{i.kmPercorridos === null ? '—' : num(i.kmPercorridos, 0)}</Td>
                    <Td className="text-right">{i.consumoKml === null ? '—' : num(i.consumoKml, 2)}</Td>
                    <Td>
                      {i.anomalia ? (
                        <>
                          <Badge tom="vermelho">anomalia</Badge>
                          <p className="text-legenda text-ceara-texto2">{i.anomaliaTipos.join(', ').toLowerCase().replaceAll('_', ' ')}</p>
                        </>
                      ) : (
                        <Badge tom="verde">normal</Badge>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}

function Indicador({
  rotulo,
  valor,
  tom = 'neutro',
  rodape,
}: {
  rotulo: string;
  valor: string;
  tom?: 'neutro' | 'risco';
  rodape?: string;
}) {
  return (
    <Card destaque={tom === 'risco' ? 'risco' : 'nenhum'}>
      <CardCorpo className="pt-4">
        <p className="text-legenda text-ceara-texto2">{rotulo}</p>
        <p className={cn('font-mono text-h2', tom === 'risco' ? 'text-ceara-vermelho' : 'text-ceara-azul')}>{valor}</p>
        {rodape && <p className="text-legenda italic text-ceara-texto2">{rodape}</p>}
      </CardCorpo>
    </Card>
  );
}
