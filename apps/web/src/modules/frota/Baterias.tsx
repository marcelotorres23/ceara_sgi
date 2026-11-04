import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BatteryWarning, Plus, Zap } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { cn } from '../../design-system/cn';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { FiltroUnidade } from './FiltroUnidade';

type Situacao = 'TROCAR' | 'ATENCAO' | 'SEM_MEDICAO' | 'EM_DIA';
type StatusBateria = 'EM_ESTOQUE' | 'EM_USO' | 'EM_ANALISE_GARANTIA' | 'SUCATA';

interface BateriaNoPainel {
  id: string;
  identificacao: string;
  descricao: string;
  status: StatusBateria;
  veiculo: { id: string; placa: string; frotaNumero: string } | null;
  instaladaEm: string | null;
  vidaUtilMeses: number;
  tensaoV: string | null;
  medidaEm: string | null;
  kmComABateria: string | null;
  situacao: Situacao;
  mensagens: string[];
  mesesEmUso: number | null;
  mesesRestantes: number | null;
  naGarantia: boolean;
  garantiaAte: string | null;
}

interface Painel {
  itens: BateriaNoPainel[];
  resumo: Record<Situacao | 'emUso' | 'emEstoque' | 'naGarantiaNoPonto' | 'total', number>;
}

const ROTULO_SITUACAO: Record<Situacao, string> = {
  TROCAR: 'trocar',
  ATENCAO: 'atencao',
  SEM_MEDICAO: 'sem medicao',
  EM_DIA: 'em dia',
};

const TOM: Record<Situacao, 'vermelho' | 'ouro' | 'neutro' | 'verde'> = {
  TROCAR: 'vermelho',
  ATENCAO: 'ouro',
  SEM_MEDICAO: 'neutro',
  EM_DIA: 'verde',
};

const ROTULO_STATUS: Record<StatusBateria, string> = {
  EM_ESTOQUE: 'Em estoque',
  EM_USO: 'Em uso',
  EM_ANALISE_GARANTIA: 'Em garantia',
  SUCATA: 'Sucata',
};

const dataBr = (iso: string | null) => (iso === null ? '—' : new Date(iso).toLocaleDateString('pt-BR'));
const km = (v: string | null) => (v === null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(v)));

/**
 * Controle de baterias (secao 7.11).
 *
 * O painel responde a pergunta que a manutencao faz toda semana: qual bateria vai deixar
 * caminhao no patio. Ponto de troca calculado na hora — tensao medida, tempo de uso e
 * garantia —, e a bateria sem medicao aparece antes da que esta em dia.
 */
export function Baterias() {
  const cliente = useQueryClient();
  const [unidadeId, setUnidadeId] = useState('');
  const [cadastrando, setCadastrando] = useState(false);
  const [medindo, setMedindo] = useState<BateriaNoPainel | null>(null);
  const [movendo, setMovendo] = useState<BateriaNoPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const consulta = unidadeId ? `?unidadeId=${unidadeId}` : '';
  const painel = useQuery({
    queryKey: ['baterias', 'painel', unidadeId],
    queryFn: () => get<Painel>(`/transporte/baterias${consulta}`),
  });

  const aoConcluir = async () => {
    setErro(null);
    setCadastrando(false);
    setMedindo(null);
    setMovendo(null);
    await cliente.invalidateQueries({ queryKey: ['baterias'] });
  };

  const dados = painel.data;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-h1 text-ceara-azul">
            <Zap size={22} aria-hidden />
            Baterias
          </h1>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            Onde cada bateria esta, ha quanto tempo e como vem medindo. O ponto de troca sai da pior das tres leituras:
            tensao em repouso, tempo de uso e garantia.
          </p>
        </div>

        <div className="flex items-end gap-2">
          <FiltroUnidade valor={unidadeId} aoMudar={setUnidadeId} />
          <Button onClick={() => { setCadastrando(true); setErro(null); }}>
            <Plus size={16} aria-hidden /> Nova bateria
          </Button>
        </div>
      </header>

      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      {dados && (
        <section className="grid gap-3 sm:grid-cols-4">
          <Resumo rotulo="No ponto de troca" valor={dados.resumo.TROCAR} tom="risco" />
          <Resumo rotulo="Em atencao" valor={dados.resumo.ATENCAO} tom="atencao" />
          <Resumo rotulo="Sem medicao" valor={dados.resumo.SEM_MEDICAO} tom="neutro" />
          <Resumo
            rotulo="Trocar ainda na garantia"
            valor={dados.resumo.naGarantiaNoPonto}
            tom={dados.resumo.naGarantiaNoPonto > 0 ? 'atencao' : 'neutro'}
            rodape="acione o fornecedor antes de comprar"
          />
        </section>
      )}

      {cadastrando && <CadastrarBateria unidadeId={unidadeId} aoConcluir={aoConcluir} aoErrar={setErro} aoFechar={() => setCadastrando(false)} />}
      {medindo && <MedirBateria bateria={medindo} aoConcluir={aoConcluir} aoErrar={setErro} aoFechar={() => setMedindo(null)} />}
      {movendo && <MoverBateria bateria={movendo} unidadeId={unidadeId} aoConcluir={aoConcluir} aoErrar={setErro} aoFechar={() => setMovendo(null)} />}

      {painel.isLoading && <p className="text-corpo text-ceara-texto2">Carregando as baterias...</p>}

      {dados && dados.itens.length === 0 && (
        <Card>
          <EstadoVazio
            titulo="Nenhuma bateria cadastrada"
            descricao="Cadastre as baterias em uso e em estoque para acompanhar o ponto de troca."
          />
        </Card>
      )}

      {dados && dados.itens.length > 0 && (
        <Table>
          <Thead>
            <Tr>
              <Th>Bateria</Th>
              <Th>Onde esta</Th>
              <Th>Instalada em</Th>
              <Th className="text-right">Em uso</Th>
              <Th className="text-right">Tensao</Th>
              <Th>Medida em</Th>
              <Th>Situacao</Th>
              <Th className="text-right">Acoes</Th>
            </Tr>
          </Thead>
          <Tbody>
            {dados.itens.map((b) => (
              <Tr key={b.id}>
                <Td>
                  <span className="font-mono font-medium">{b.identificacao}</span>
                  <p className="text-legenda text-ceara-texto2">{b.descricao || '—'}</p>
                </Td>
                <Td>
                  {b.veiculo ? (
                    <>
                      <span className="font-mono">{b.veiculo.placa}</span>
                      {b.kmComABateria && (
                        <p className="text-legenda text-ceara-texto2">{km(b.kmComABateria)} km com ela</p>
                      )}
                    </>
                  ) : (
                    ROTULO_STATUS[b.status]
                  )}
                </Td>
                <Td>{dataBr(b.instaladaEm)}</Td>
                <Td className="text-right">
                  {b.mesesEmUso === null ? '—' : `${b.mesesEmUso}/${b.vidaUtilMeses} m`}
                </Td>
                <Td className={cn('text-right font-mono', b.situacao === 'TROCAR' && 'text-ceara-vermelho')}>
                  {b.tensaoV === null ? '—' : `${Number(b.tensaoV).toFixed(2)} V`}
                </Td>
                <Td>{dataBr(b.medidaEm)}</Td>
                <Td>
                  <Badge tom={TOM[b.situacao]}>{ROTULO_SITUACAO[b.situacao]}</Badge>
                  {b.naGarantia && b.situacao === 'TROCAR' && (
                    <p className="text-legenda text-ceara-texto2">na garantia ate {dataBr(b.garantiaAte)}</p>
                  )}
                </Td>
                <Td className="text-right">
                  <span className="flex justify-end gap-1">
                    <Button variante="texto" tamanho="sm" onClick={() => { setMedindo(b); setErro(null); }}>
                      Medir
                    </Button>
                    {b.status !== 'SUCATA' && (
                      <Button variante="texto" tamanho="sm" onClick={() => { setMovendo(b); setErro(null); }}>
                        {b.status === 'EM_USO' ? 'Retirar' : 'Instalar'}
                      </Button>
                    )}
                  </span>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {dados && dados.itens.some((b) => b.situacao === 'TROCAR') && (
        <Card destaque="risco">
          <CardTitulo>Por que estas estao no ponto de troca</CardTitulo>
          <CardCorpo className="flex flex-col gap-2 pb-4">
            {dados.itens
              .filter((b) => b.situacao === 'TROCAR')
              .map((b) => (
                <p key={b.id} className="flex items-start gap-2 text-corpo">
                  <BatteryWarning size={16} className="mt-0.5 shrink-0 text-ceara-vermelho" aria-hidden />
                  <span>
                    <span className="font-mono font-medium">{b.identificacao}</span>
                    {b.veiculo && <span className="text-ceara-texto2"> · {b.veiculo.placa}</span>} — {b.mensagens.join(' ')}
                  </span>
                </p>
              ))}
          </CardCorpo>
        </Card>
      )}
    </div>
  );
}

function Resumo({
  rotulo,
  valor,
  tom,
  rodape,
}: {
  rotulo: string;
  valor: number;
  tom: 'risco' | 'atencao' | 'neutro';
  rodape?: string;
}) {
  const cor = tom === 'risco' ? 'text-ceara-vermelho' : tom === 'atencao' ? 'text-ceara-ouro' : 'text-ceara-texto2';
  return (
    <Card destaque={tom === 'risco' && valor > 0 ? 'risco' : 'nenhum'}>
      <CardCorpo className="pt-4">
        <p className="text-legenda text-ceara-texto2">{rotulo}</p>
        <p className={cn('text-h1', cor)}>{valor}</p>
        {rodape && <p className="text-legenda italic text-ceara-texto2">{rodape}</p>}
      </CardCorpo>
    </Card>
  );
}

function CadastrarBateria({
  unidadeId,
  aoConcluir,
  aoErrar,
  aoFechar,
}: {
  unidadeId: string;
  aoConcluir: () => void;
  aoErrar: (e: string | null) => void;
  aoFechar: () => void;
}) {
  const [identificacao, setIdentificacao] = useState('');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [amperagem, setAmperagem] = useState('');
  const [dataCompra, setDataCompra] = useState('');
  const [custo, setCusto] = useState('');
  const [garantiaMeses, setGarantia] = useState('');
  const [vidaUtilMeses, setVidaUtil] = useState('');

  const criar = useMutation({
    mutationFn: () =>
      post('/transporte/baterias', {
        unidadeId: unidadeId || null,
        identificacao,
        marca: marca.trim() || null,
        modelo: modelo.trim() || null,
        amperagem: amperagem.trim() || null,
        dataCompra: dataCompra || null,
        custo: custo.trim() || null,
        garantiaMeses: garantiaMeses.trim() || null,
        vidaUtilMeses: vidaUtilMeses.trim() || null,
      }),
    onSuccess: aoConcluir,
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao cadastrar a bateria.'),
  });

  return (
    <Card destaque="regra">
      <CardTitulo acao={<Button tamanho="sm" variante="texto" onClick={aoFechar}>Fechar</Button>}>
        Nova bateria
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Campo rotulo="Identificacao" htmlFor="b-id" obrigatorio ajuda="A etiqueta escrita na carcaca.">
            <input id="b-id" className={classeControle()} value={identificacao} onChange={(e) => setIdentificacao(e.target.value.toUpperCase())} />
          </Campo>
          <Campo rotulo="Marca" htmlFor="b-marca">
            <input id="b-marca" className={classeControle()} value={marca} onChange={(e) => setMarca(e.target.value)} />
          </Campo>
          <Campo rotulo="Modelo" htmlFor="b-modelo">
            <input id="b-modelo" className={classeControle()} value={modelo} onChange={(e) => setModelo(e.target.value)} />
          </Campo>
          <Campo rotulo="Amperagem (Ah)" htmlFor="b-ah">
            <input id="b-ah" inputMode="numeric" className={classeControle()} value={amperagem} onChange={(e) => setAmperagem(e.target.value)} />
          </Campo>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Campo rotulo="Data da compra" htmlFor="b-compra">
            <input id="b-compra" type="date" className={classeControle()} value={dataCompra} onChange={(e) => setDataCompra(e.target.value)} />
          </Campo>
          <Campo rotulo="Custo" htmlFor="b-custo">
            <input id="b-custo" inputMode="decimal" className={classeControle()} value={custo} onChange={(e) => setCusto(e.target.value)} />
          </Campo>
          <Campo rotulo="Garantia (meses)" htmlFor="b-garantia" ajuda="Serve para cobrar a troca do fornecedor.">
            <input id="b-garantia" inputMode="numeric" className={classeControle()} value={garantiaMeses} onChange={(e) => setGarantia(e.target.value)} />
          </Campo>
          <Campo rotulo="Vida util (meses)" htmlFor="b-vida" ajuda="Em branco, vale o padrao de 18 meses.">
            <input id="b-vida" inputMode="numeric" className={classeControle()} value={vidaUtilMeses} onChange={(e) => setVidaUtil(e.target.value)} />
          </Campo>
        </div>

        <div className="flex justify-end">
          <Button disabled={identificacao.trim().length < 2} carregando={criar.isPending} onClick={() => criar.mutate()}>
            Cadastrar
          </Button>
        </div>
      </CardCorpo>
    </Card>
  );
}

/**
 * Medicao de tensao.
 *
 * O aviso sobre medir em repouso esta na tela porque e ele que separa medicao util de
 * numero bonito: com o alternador tendo acabado de rodar, qualquer bateria mede bem.
 */
function MedirBateria({
  bateria,
  aoConcluir,
  aoErrar,
  aoFechar,
}: {
  bateria: BateriaNoPainel;
  aoConcluir: () => void;
  aoErrar: (e: string | null) => void;
  aoFechar: () => void;
}) {
  const [tensaoV, setTensao] = useState('');
  const [medidoEm, setMedidoEm] = useState(new Date().toISOString().slice(0, 10));
  const [aposRodar, setAposRodar] = useState(false);
  const [observacao, setObservacao] = useState('');

  const medir = useMutation({
    mutationFn: () =>
      post(`/transporte/baterias/${bateria.id}/medicoes`, {
        tensaoV: tensaoV.trim(),
        medidoEm,
        aposRodar,
        observacao: observacao.trim() || null,
      }),
    onSuccess: aoConcluir,
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao registrar a medicao.'),
  });

  const pronto = /^\d+(\.\d{1,2})?$/.test(tensaoV.trim());

  return (
    <Card destaque="regra">
      <CardTitulo acao={<Button tamanho="sm" variante="texto" onClick={aoFechar}>Fechar</Button>}>
        Medir {bateria.identificacao}
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Tensao (V)" htmlFor="m-tensao" obrigatorio ajuda="Use ponto decimal: 12.45">
            <input id="m-tensao" inputMode="decimal" className={classeControle()} value={tensaoV} onChange={(e) => setTensao(e.target.value)} />
          </Campo>
          <Campo rotulo="Data" htmlFor="m-data" obrigatorio>
            <input id="m-data" type="date" className={classeControle()} value={medidoEm} onChange={(e) => setMedidoEm(e.target.value)} />
          </Campo>
          <Campo rotulo="Observacao" htmlFor="m-obs">
            <input id="m-obs" className={classeControle()} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </Campo>
        </div>

        <label className="flex items-start gap-2 text-corpo">
          <input type="checkbox" className="mt-1" checked={aposRodar} onChange={(e) => setAposRodar(e.target.checked)} />
          <span>
            Medida logo apos o veiculo rodar.
            <span className="block text-legenda italic text-ceara-texto2">
              Marcada assim, a leitura fica no historico mas nao decide o ponto de troca: com o alternador tendo
              acabado de carregar, qualquer bateria mede bem.
            </span>
          </span>
        </label>

        <div className="flex justify-end">
          <Button disabled={!pronto} carregando={medir.isPending} onClick={() => medir.mutate()}>
            Registrar medicao
          </Button>
        </div>
      </CardCorpo>
    </Card>
  );
}

function MoverBateria({
  bateria,
  unidadeId,
  aoConcluir,
  aoErrar,
  aoFechar,
}: {
  bateria: BateriaNoPainel;
  unidadeId: string;
  aoConcluir: () => void;
  aoErrar: (e: string | null) => void;
  aoFechar: () => void;
}) {
  const emUso = bateria.status === 'EM_USO';
  const [veiculoId, setVeiculoId] = useState('');
  const [posicao, setPosicao] = useState('');
  const [motivo, setMotivo] = useState('');
  const [destino, setDestino] = useState<'EM_ESTOQUE' | 'EM_ANALISE_GARANTIA' | 'SUCATA'>('EM_ESTOQUE');

  const veiculos = useQuery({
    queryKey: ['frota', 'veiculos', unidadeId],
    queryFn: () =>
      get<{ itens: Array<{ id: string; placa: string; frotaNumero: string }> }>(
        `/transporte/veiculos?limite=100${unidadeId ? `&unidadeId=${unidadeId}` : ''}`,
      ),
    enabled: !emUso,
  });

  const mover = useMutation({
    mutationFn: () =>
      emUso
        ? post(`/transporte/baterias/${bateria.id}/retirar`, { motivo: motivo.trim(), destino })
        : post(`/transporte/baterias/${bateria.id}/instalar`, { veiculoId, posicao: posicao.trim() || null }),
    onSuccess: aoConcluir,
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao movimentar a bateria.'),
  });

  const pronto = emUso ? motivo.trim().length >= 5 : veiculoId !== '';

  return (
    <Card destaque="regra">
      <CardTitulo acao={<Button tamanho="sm" variante="texto" onClick={aoFechar}>Fechar</Button>}>
        {emUso ? `Retirar ${bateria.identificacao} de ${bateria.veiculo?.placa ?? 'veiculo'}` : `Instalar ${bateria.identificacao}`}
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        {emUso ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Motivo da retirada" htmlFor="r-motivo" obrigatorio>
              <input id="r-motivo" className={classeControle()} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </Campo>
            <Campo rotulo="Destino" htmlFor="r-destino" obrigatorio ajuda="Nada se apaga: o destino conta o que aconteceu com ela.">
              <select id="r-destino" className={classeControle()} value={destino} onChange={(e) => setDestino(e.target.value as typeof destino)}>
                <option value="EM_ESTOQUE">Volta ao estoque</option>
                <option value="EM_ANALISE_GARANTIA">Enviada para garantia</option>
                <option value="SUCATA">Sucata</option>
              </select>
            </Campo>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Veiculo" htmlFor="i-veiculo" obrigatorio>
              <select id="i-veiculo" className={classeControle()} value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
                <option value="">Selecione</option>
                {(veiculos.data?.itens ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.placa} · frota {v.frotaNumero}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Posicao" htmlFor="i-posicao" ajuda="1 ou 2, quando o veiculo leva duas baterias.">
              <input id="i-posicao" inputMode="numeric" className={classeControle()} value={posicao} onChange={(e) => setPosicao(e.target.value)} />
            </Campo>
          </div>
        )}

        <div className="flex justify-end">
          <Button disabled={!pronto} carregando={mover.isPending} onClick={() => mover.mutate()}>
            {emUso ? 'Retirar' : 'Instalar'}
          </Button>
        </div>
      </CardCorpo>
    </Card>
  );
}
