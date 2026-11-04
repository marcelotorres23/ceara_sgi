import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { Button } from '../../design-system/components/Button';
import { Badge } from '../../design-system/components/Badge';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { FiltroUnidade } from './FiltroUnidade';
import { DetalheDaPosicao, MapaRodagem } from './MapaRodagem';
import { PainelPeriodico, type TipoServicoPeriodico } from './PainelPeriodico';
import { FolhaSulcos } from './FolhaSulcos';
import { cpkFormatado, decimal, type MapaDeRodagem, type PosicaoDoMapa } from './tipos';

interface VeiculoResumo {
  id: string;
  placa: string;
  frotaNumero: string;
  unidade?: { codigo: string; nome: string };
}

interface PneuNaLista {
  id: string;
  numeroFogo: string;
  marca: string;
  modelo: string;
  medida: string;
  tipo: 'NOVO' | 'RECAPADO';
  recapagens: number;
  status: string;
  sulcoAtualMm: string | null;
  kmAcumulado: string;
  cpk: string | null;
  veiculo: { placa: string } | null;
  posicao: { codigo: string } | null;
  unidade: { codigo: string };
}

const ROTULO_STATUS: Record<string, string> = {
  EM_ESTOQUE: 'Em estoque',
  EM_USO: 'Em uso',
  EM_RECAPAGEM: 'Em recapagem',
  EM_REPARO: 'Em reparo',
  SUCATA: 'Sucata',
};

/** Tela de pneus (secao 7.4): mapa de rodagem do veiculo + estoque de pneus + movimentacao. */
export function Pneus() {
  const [unidadeId, setUnidadeId] = useState<string>('');
  const [veiculoId, setVeiculoId] = useState<string>('');
  const [selecionada, setSelecionada] = useState<PosicaoDoMapa | null>(null);
  const [servicoDeRodagem, setServicoDeRodagem] = useState<TipoServicoPeriodico>('ALINHAMENTO');
  const [folha, setFolha] = useState(false);

  const consulta = unidadeId ? `?unidadeId=${unidadeId}` : '';

  const veiculos = useQuery({
    queryKey: ['frota', 'veiculos', unidadeId],
    queryFn: () => get<{ itens: VeiculoResumo[] }>(`/transporte/veiculos?limite=100${unidadeId ? `&unidadeId=${unidadeId}` : ''}`),
  });

  const mapa = useQuery({
    queryKey: ['pneus', 'mapa', veiculoId],
    queryFn: () => get<MapaDeRodagem>(`/transporte/pneus/mapa/${veiculoId}`),
    enabled: Boolean(veiculoId),
  });

  const pneus = useQuery({
    queryKey: ['pneus', 'lista', unidadeId],
    queryFn: () => get<{ itens: PneuNaLista[] }>(`/transporte/pneus${consulta}`),
  });

  const cpk = useQuery({
    queryKey: ['pneus', 'cpk', unidadeId],
    queryFn: () =>
      get<{ porMarca: Array<{ chave: string; pneus: number; kmTotal: string; cpk: string | null }> }>(
        `/transporte/pneus/indicadores/cpk${consulta}`,
      ),
  });

  return (
    <div className="flex flex-col gap-5">
      {folha && veiculoId !== '' && <FolhaSulcos veiculoId={veiculoId} aoFechar={() => setFolha(false)} />}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ceara-azul">Pneus</h1>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            Numero de fogo, ciclo de vida e custo por quilometro. Cada movimentacao fecha o periodo anterior.
          </p>
        </div>
        <FiltroUnidade valor={unidadeId} aoMudar={setUnidadeId} />
      </header>

      <Card>
        <CardTitulo
          acao={
            <span className="flex items-center gap-2">
              {/* a folha sai do mapa do veiculo escolhido: sem veiculo, nao ha o que imprimir */}
              {veiculoId !== '' && (
                <Button variante="secundario" tamanho="sm" onClick={() => setFolha(true)}>
                  <Printer size={14} aria-hidden /> Folha de sulcos
                </Button>
              )}
            <select
              className={classeControle()}
              value={veiculoId}
              onChange={(e) => {
                setVeiculoId(e.target.value);
                setSelecionada(null);
              }}
              aria-label="Veiculo do mapa de rodagem"
            >
              <option value="">Selecione o veiculo</option>
              {veiculos.data?.itens.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.frotaNumero} · {v.placa}
                </option>
              ))}
            </select>
            </span>
          }
        >
          Mapa de rodagem
        </CardTitulo>
        <CardCorpo>
          {!veiculoId && (
            <p className="text-corpo text-ceara-texto2">Selecione um veiculo para ver as posicoes e o estado de cada pneu.</p>
          )}
          {veiculoId && mapa.isLoading && <p className="text-corpo text-ceara-texto2">Carregando o mapa...</p>}
          {mapa.data && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
              <div>
                <p className="mb-3 text-corpo text-ceara-texto2">
                  {mapa.data.veiculo.placa} · hodometro {decimal(mapa.data.veiculo.hodometroAtual, 1)} km ·{' '}
                  {mapa.data.resumo.ocupadas} de {mapa.data.resumo.total} posicoes ocupadas
                  {mapa.data.resumo.criticas > 0 && (
                    <span className="ml-2 font-medium text-ceara-vermelho">
                      {mapa.data.resumo.criticas} em estado critico
                    </span>
                  )}
                </p>
                <MapaRodagem mapa={mapa.data} selecionada={selecionada?.posicao.id ?? null} onSelecionar={setSelecionada} />
              </div>

              <div className="rounded-card border border-ceara-borda p-4">
                {selecionada ? (
                  <>
                    <DetalheDaPosicao posicao={selecionada} />
                    <MovimentarPneu posicao={selecionada} veiculoId={veiculoId} hodometro={mapa.data.veiculo.hodometroAtual} />
                  </>
                ) : (
                  <p className="text-corpo text-ceara-texto2">Clique em uma posicao para ver o pneu e movimenta-lo.</p>
                )}
              </div>
            </div>
          )}
        </CardCorpo>
      </Card>

      <Card>
        <CardTitulo
          acao={
            <select
              className={classeControle()}
              value={servicoDeRodagem}
              onChange={(e) => setServicoDeRodagem(e.target.value as TipoServicoPeriodico)}
              aria-label="Servico de rodagem"
            >
              <option value="ALINHAMENTO">Alinhamento</option>
              <option value="BALANCEAMENTO">Balanceamento</option>
            </select>
          }
        >
          Alinhamento e balanceamento
        </CardTitulo>
        <CardCorpo>
          {/* mesma conta das trocas de oleo (secao 7.10), medida no hodometro do veiculo */}
          <PainelPeriodico
            tipo={servicoDeRodagem}
            rotulo={servicoDeRodagem === 'ALINHAMENTO' ? 'Alinhamento' : 'Balanceamento'}
            unidadeId={unidadeId}
            ajuda={
              'Vence a cada 10.000 km rodados. A planilha da operacao controlava os dois juntos; aqui cada um tem ' +
              'seu proprio vencimento, porque um pneu pode ser balanceado sem que o veiculo precise de alinhamento.'
            }
          />
        </CardCorpo>
      </Card>

      <Card>
        <CardTitulo>CPK por marca</CardTitulo>
        <CardCorpo>
          {cpk.data && cpk.data.porMarca.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Marca</Th>
                  <Th>Pneus</Th>
                  <Th>Km acumulado</Th>
                  <Th>CPK</Th>
                </Tr>
              </Thead>
              <Tbody>
                {cpk.data.porMarca.map((linha) => (
                  <Tr key={linha.chave}>
                    <Td>{linha.chave}</Td>
                    <Td>{linha.pneus}</Td>
                    <Td>{decimal(linha.kmTotal, 1)}</Td>
                    <Td>{cpkFormatado(linha.cpk)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <p className="text-corpo text-ceara-texto2">Sem pneus com quilometragem apurada nesta unidade.</p>
          )}
        </CardCorpo>
      </Card>

      <Card>
        <CardTitulo>Pneus cadastrados</CardTitulo>
        <CardCorpo>
          {pneus.data && pneus.data.itens.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>N. de fogo</Th>
                  <Th>Marca e modelo</Th>
                  <Th>Medida</Th>
                  <Th>Situacao</Th>
                  <Th>Local</Th>
                  <Th>Sulco</Th>
                  <Th>Km</Th>
                  <Th>CPK</Th>
                  <Th>Unidade</Th>
                </Tr>
              </Thead>
              <Tbody>
                {pneus.data.itens.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-mono">{p.numeroFogo}</Td>
                    <Td>
                      {p.marca} {p.modelo}
                      {p.tipo === 'RECAPADO' && <span className="ml-1 text-legenda text-ceara-texto2">recapado {p.recapagens}x</span>}
                    </Td>
                    <Td>{p.medida}</Td>
                    <Td>
                      <Badge tom={p.status === 'EM_USO' ? 'azul' : p.status === 'SUCATA' ? 'vermelho' : 'neutro'}>
                        {ROTULO_STATUS[p.status] ?? p.status}
                      </Badge>
                    </Td>
                    <Td>{p.veiculo ? `${p.veiculo.placa} · ${p.posicao?.codigo ?? '—'}` : 'Estoque'}</Td>
                    <Td>{p.sulcoAtualMm ? `${decimal(p.sulcoAtualMm, 1)} mm` : '—'}</Td>
                    <Td>{decimal(p.kmAcumulado, 1)}</Td>
                    <Td>{cpkFormatado(p.cpk)}</Td>
                    <Td>{p.unidade.codigo}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EstadoVazio
              titulo="Nenhum pneu cadastrado"
              descricao="Cadastre os pneus pelo numero de fogo para acompanhar ciclo de vida e CPK."
            />
          )}
        </CardCorpo>
      </Card>
    </div>
  );
}

const TIPOS_MOVIMENTACAO = [
  { valor: 'INSTALACAO', rotulo: 'Instalar pneu do estoque' },
  { valor: 'RODIZIO', rotulo: 'Rodizio para outra posicao' },
  { valor: 'REMOCAO', rotulo: 'Remover para o estoque' },
  { valor: 'ENVIO_RECAPAGEM', rotulo: 'Enviar para recapagem' },
  { valor: 'ENVIO_REPARO', rotulo: 'Enviar para reparo' },
  { valor: 'SUCATEAMENTO', rotulo: 'Sucatear' },
] as const;

/** Movimenta o pneu da posicao selecionada. O backend valida a transicao do ciclo de vida. */
function MovimentarPneu({
  posicao,
  veiculoId,
  hodometro,
}: {
  posicao: PosicaoDoMapa;
  veiculoId: string;
  hodometro: string;
}) {
  const cliente = useQueryClient();
  const [tipo, setTipo] = useState<string>('REMOCAO');
  const [pneuId, setPneuId] = useState('');
  const [leitura, setLeitura] = useState(hodometro);
  const [sulco, setSulco] = useState('');
  const [custo, setCusto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const emEstoque = useQuery({
    queryKey: ['pneus', 'estoque'],
    queryFn: () => get<{ itens: PneuNaLista[] }>('/transporte/pneus?status=EM_ESTOQUE&limite=100'),
    enabled: !posicao.pneu,
  });

  const movimentar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) =>
      post(`/transporte/pneus/${posicao.pneu?.id ?? pneuId}/movimentacoes`, corpo),
    onSuccess: async () => {
      setErro(null);
      setCusto('');
      setSulco('');
      await cliente.invalidateQueries({ queryKey: ['pneus'] });
    },
    onError: (falha) => setErro(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao movimentar o pneu.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const instalando = !posicao.pneu;

    movimentar.mutate({
      tipo: instalando ? 'INSTALACAO' : tipo,
      veiculoId,
      posicaoId: posicao.posicao.id,
      hodometro: leitura || null,
      sulcoMm: sulco || null,
      custo: custo || null,
    });
  }

  const instalando = !posicao.pneu;

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3 border-t border-ceara-borda pt-4">
      <p className="text-h3 text-ceara-texto">{instalando ? 'Instalar pneu' : 'Movimentar pneu'}</p>

      {instalando ? (
        <Campo rotulo="Pneu em estoque" htmlFor="pneu-estoque" obrigatorio>
          <select id="pneu-estoque" required className={classeControle()} value={pneuId} onChange={(e) => setPneuId(e.target.value)}>
            <option value="">Selecione</option>
            {emEstoque.data?.itens.map((p) => (
              <option key={p.id} value={p.id}>
                {p.numeroFogo} · {p.marca} {p.modelo} · {p.medida}
              </option>
            ))}
          </select>
        </Campo>
      ) : (
        <Campo rotulo="Movimentacao" htmlFor="tipo-mov">
          <select id="tipo-mov" className={classeControle()} value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS_MOVIMENTACAO.filter((t) => t.valor !== 'INSTALACAO').map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </Campo>
      )}

      <Campo rotulo="Hodometro do veiculo" htmlFor="hodometro" ajuda="Base do km rodado no periodo e do CPK.">
        <input id="hodometro" inputMode="decimal" className={classeControle()} value={leitura} onChange={(e) => setLeitura(e.target.value)} />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Sulco medido (mm)" htmlFor="sulco">
          <input id="sulco" inputMode="decimal" className={classeControle()} value={sulco} onChange={(e) => setSulco(e.target.value)} />
        </Campo>
        <Campo rotulo="Custo (R$)" htmlFor="custo" ajuda="Recapagem ou reparo.">
          <input id="custo" inputMode="decimal" className={classeControle()} value={custo} onChange={(e) => setCusto(e.target.value)} />
        </Campo>
      </div>

      {erro && (
        <p role="alert" className="rounded-lg border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-3 py-2 text-legenda text-ceara-vermelho">
          {erro}
        </p>
      )}

      <Button type="submit" tamanho="sm" carregando={movimentar.isPending}>
        Registrar movimentacao
      </Button>
    </form>
  );
}
