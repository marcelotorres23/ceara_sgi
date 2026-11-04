import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, History, Truck, Undo2, X } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api';
import { Badge, TOM_POR_CRITICIDADE } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { EstadoVazio, Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { useSessao } from '../auth/useSessao';
import { moeda, moedaOuTraco } from './tipos';
import {
  mesBr,
  percentualBr,
  prazoBr,
  type CentroDoLote,
  type Decisao,
  type HistoricoDoCentro,
  type LoteNaFila,
} from './aprovacao';

const ROTULO_DECISAO: Record<Decisao, string> = {
  APROVADO: 'Aprovar',
  APROVADO_COM_RESSALVA: 'Aprovar com ressalva',
  DEVOLVIDO: 'Devolver para renegociacao',
  REPROVADO: 'Reprovar',
};

/**
 * Mesa do aprovador (secoes 6.1.7 e 6.4).
 *
 * A fila da esquerda lista o que espera decisao. Ao selecionar um lote, o painel da
 * direita abre o historico de compras do centro de custo que aquele lote vai onerar -
 * e, como cada placa e um centro de custo, o aprovador ve o gasto daquele caminhao:
 * quanto ja foi comprado, o que se repete e quanto do orcamento do mes ja foi.
 *
 * Nenhuma regra vive aqui: alcada, SoD e maquina de estados sao decididas pelo servidor.
 */
export function FilaAprovacao() {
  const cliente = useQueryClient();
  const usuario = useSessao((s) => s.usuario);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [centroAberto, setCentroAberto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const fila = useQuery({
    queryKey: ['compras', 'aprovacoes'],
    queryFn: () => get<{ itens: LoteNaFila[] }>('/compras/aprovacoes/fila?limite=50'),
    refetchInterval: 60_000,
  });

  const itens = fila.data?.itens ?? [];
  const lote = itens.find((l) => l.id === selecionado) ?? null;
  // ao trocar de lote, abre o primeiro centro dele: o aprovador nao precisa de dois cliques
  const centroId = centroAberto ?? lote?.centros[0]?.id ?? null;

  function escolher(l: LoteNaFila) {
    setSelecionado(l.id);
    setCentroAberto(l.centros[0]?.id ?? null);
    setErro(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-h1 text-ceara-azul">Aprovacoes</h1>
        <p className="mt-1 text-legenda italic text-ceara-texto2">
          Clique no lote para ver o historico de compras da placa que ele vai onerar. Cada placa e um centro de
          custo — o gasto do caminhao aparece antes da decisao, nao depois.
        </p>
      </header>

      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        <Card>
          <CardTitulo>Aguardando decisao ({itens.length})</CardTitulo>
          <CardCorpo className="flex flex-col gap-2">
            {fila.isLoading && <p className="text-corpo text-ceara-texto2">Carregando a fila...</p>}

            {!fila.isLoading && itens.length === 0 && (
              <EstadoVazio
                titulo="Nada aguardando sua decisao"
                descricao="Lotes submetidos a alcada aparecem aqui assim que o comprador gera o mapa."
              />
            )}

            {itens.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => escolher(l)}
                aria-current={l.id === selecionado}
                className={
                  l.id === selecionado
                    ? 'rounded-card border border-ceara-azul bg-[var(--ceara-azul-10)] px-3 py-2 text-left'
                    : 'rounded-card border border-ceara-borda px-3 py-2 text-left hover:border-ceara-azul'
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-h3 text-ceara-azul">{l.numero}</span>
                  <Badge tom={TOM_POR_CRITICIDADE[l.criticidade]}>{l.criticidade}</Badge>
                </div>
                <p className="text-corpo text-ceara-texto">{moedaOuTraco(l.valorEstimado)}</p>
                <p className="text-legenda text-ceara-texto2">
                  {l.centros.map((c) => rotuloDoCentro(c)).join(' · ')}
                </p>
                <p className={`text-legenda ${l.atrasado ? 'font-medium text-ceara-vermelho' : 'text-ceara-texto2'}`}>
                  faixa {l.nivelAlcada ?? '—'} · {prazoBr(l.horasRestantes)}
                </p>
              </button>
            ))}
          </CardCorpo>
        </Card>

        <div className="flex flex-col gap-5">
          {!lote ? (
            <Card>
              <CardCorpo className="pt-4">
                <p className="text-corpo text-ceara-texto2">
                  Selecione um lote na fila para ver o mapa, o historico da placa e decidir.
                </p>
              </CardCorpo>
            </Card>
          ) : (
            <>
              <ResumoDoLote lote={lote} centroSelecionado={centroId} aoTrocarCentro={setCentroAberto} />
              {centroId && <HistoricoDaPlaca centroCustoId={centroId} />}
              <Decidir
                lote={lote}
                usuarioId={usuario?.sub ?? null}
                aoErrar={setErro}
                aoDecidir={async () => {
                  setSelecionado(null);
                  setCentroAberto(null);
                  await cliente.invalidateQueries({ queryKey: ['compras'] });
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const rotuloDoCentro = (c: CentroDoLote): string =>
  c.placas.length > 0 ? `${c.codigo} · ${c.placas.join(', ')}` : `${c.codigo} · ${c.nome}`;

// ---------------------------------------------------------------- resumo do lote

function ResumoDoLote({
  lote,
  centroSelecionado,
  aoTrocarCentro,
}: {
  lote: LoteNaFila;
  centroSelecionado: string | null;
  aoTrocarCentro: (id: string) => void;
}) {
  return (
    <Card destaque={lote.divergenteMenorPreco ? 'regra' : 'nenhum'}>
      <CardTitulo
        acao={
          <Link to={`/compras/lotes/${lote.id}`} className="text-legenda text-ceara-azul hover:underline">
            Abrir o mapa completo
          </Link>
        }
      >
        {lote.numero}
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Dado rotulo="Valor do lote" valor={moedaOuTraco(lote.valorEstimado)} />
          <Dado rotulo="Faixa de alcada" valor={lote.nivelAlcada !== null ? `nivel ${lote.nivelAlcada}` : '—'} />
          <Dado rotulo="Comprador" valor={lote.comprador.nome} />
          <Dado
            rotulo="Prazo da alcada"
            valor={prazoBr(lote.horasRestantes)}
            tom={lote.atrasado ? 'vermelho' : 'normal'}
          />
        </div>

        {lote.divergenteMenorPreco && (
          <p className="flex items-start gap-2 rounded-card border-l-4 border-ceara-ouro bg-[var(--ceara-ouro-15)] px-4 py-3 text-corpo text-ceara-texto">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Escolha divergente do menor preco — a faixa ja subiu um nivel.
              {lote.justificativa ? ` Justificativa do comprador: “${lote.justificativa}”` : ' Sem justificativa registrada.'}
            </span>
          </p>
        )}

        <div>
          <p className="mb-2 text-h3 text-ceara-texto">Centros de custo onerados</p>
          <div className="flex flex-wrap gap-2">
            {lote.centros.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => aoTrocarCentro(c.id)}
                aria-current={c.id === centroSelecionado}
                className={
                  c.id === centroSelecionado
                    ? 'flex items-center gap-2 rounded-lg border border-ceara-azul bg-[var(--ceara-azul-10)] px-3 py-2 text-corpo'
                    : 'flex items-center gap-2 rounded-lg border border-ceara-borda px-3 py-2 text-corpo hover:border-ceara-azul'
                }
              >
                <Truck size={14} aria-hidden />
                <span className="font-medium">{rotuloDoCentro(c)}</span>
                <span className="text-ceara-texto2">{moeda(c.valorAtribuido)}</span>
                {c.rateado && (
                  <Badge tom="neutro" className="ml-1" >
                    rateado
                  </Badge>
                )}
              </button>
            ))}
          </div>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            Lote que mistura centros tem o valor rateado pela quantidade de itens de cada solicitacao — a marca
            “rateado” avisa que aquele numero e estimativa, nao gasto exclusivo da placa.
          </p>
        </div>

        <p className="text-legenda text-ceara-texto2">
          {lote.solicitacoes.length} solicitacao(oes) · {lote.cotacoes} cotacao(oes) levantada(s)
        </p>
      </CardCorpo>
    </Card>
  );
}

// ---------------------------------------------------------------- historico da placa

function HistoricoDaPlaca({ centroCustoId }: { centroCustoId: string }) {
  const [meses, setMeses] = useState(12);

  const historico = useQuery({
    queryKey: ['compras', 'centro-custo', centroCustoId, meses],
    queryFn: () => get<HistoricoDoCentro>(`/compras/centros-custo/${centroCustoId}/historico?meses=${meses}`),
  });

  if (historico.isLoading) return <p className="text-corpo text-ceara-texto2">Carregando o historico da placa...</p>;
  if (!historico.data) return null;

  const h = historico.data;
  const placas = h.centro.veiculos.map((v) => v.placa).join(', ');
  const maiorMes = h.porMes.reduce((max, m) => Math.max(max, Number(m.valor)), 0);

  return (
    <Card>
      <CardTitulo
        acao={
          <select
            aria-label="Janela do historico"
            className={classeControle()}
            value={meses}
            onChange={(e) => setMeses(Number(e.target.value))}
          >
            <option value={3}>ultimos 3 meses</option>
            <option value={6}>ultimos 6 meses</option>
            <option value={12}>ultimos 12 meses</option>
            <option value={24}>ultimos 24 meses</option>
          </select>
        }
      >
        <span className="flex items-center gap-2">
          <History size={16} aria-hidden />
          Historico de compras · {h.centro.codigo} {placas && `· ${placas}`}
        </span>
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-5">
        <p className="text-legenda text-ceara-texto2">
          {h.centro.nome}
          {h.centro.responsavel && ` · responsavel ${h.centro.responsavel.nome}`}
          {h.centro.veiculos.length > 0 &&
            ` · ${h.centro.veiculos
              .map((v) => [v.placa, v.frotaNumero && `frota ${v.frotaNumero}`, v.marca, v.modelo].filter(Boolean).join(' '))
              .join(' | ')}`}
        </p>

        <div className="grid gap-3 sm:grid-cols-4">
          <Dado rotulo="Total pedido na janela" valor={moeda(h.resumo.totalPedido)} />
          <Dado rotulo="Em andamento" valor={moeda(h.resumo.totalEmAndamento)} />
          <Dado rotulo="Ticket medio" valor={moeda(h.resumo.ticketMedio)} />
          <Dado
            rotulo="Gasto do mes"
            valor={moeda(h.resumo.gastoDoMes)}
            complemento={
              h.centro.orcamentoMensal
                ? `${percentualBr(h.resumo.percentualDoOrcamento)} do orcamento de ${moeda(h.centro.orcamentoMensal)}`
                : 'sem orcamento mensal cadastrado'
            }
            tom={h.resumo.estourouOrcamento ? 'vermelho' : 'normal'}
          />
        </div>

        {h.porMes.length > 0 && (
          <div>
            <p className="mb-2 text-h3 text-ceara-texto">Gasto por mes</p>
            <ul className="flex flex-col gap-1">
              {h.porMes.map((m) => (
                <li key={m.mes} className="flex items-center gap-3 text-legenda">
                  <span className="w-16 shrink-0 text-ceara-texto2">{mesBr(m.mes)}</span>
                  <span className="h-3 rounded-sm bg-ceara-azul" style={{ width: `${barra(Number(m.valor), maiorMes)}%` }} aria-hidden />
                  <span className="text-ceara-texto">{moeda(m.valor)}</span>
                  <span className="text-ceara-texto2">({m.pedidos} pedido(s))</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {h.itensRecorrentes.length > 0 && (
          <div>
            <p className="mb-2 text-h3 text-ceara-texto">O que mais consome esta placa</p>
            <Table>
              <Thead>
                <Tr>
                  <Th>Item</Th>
                  <Th>Quantidade</Th>
                  <Th>Vezes</Th>
                  <Th>Valor</Th>
                </Tr>
              </Thead>
              <Tbody>
                {h.itensRecorrentes.map((i) => (
                  <Tr key={i.descricao}>
                    <Td>{i.descricao}</Td>
                    <Td>{i.quantidade}</Td>
                    <Td>{i.vezes}</Td>
                    <Td>{moeda(i.valor)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}

        <div>
          <p className="mb-2 text-h3 text-ceara-texto">Compras da placa</p>
          {h.compras.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Data</Th>
                  <Th>Lote</Th>
                  <Th>Pedido</Th>
                  <Th>Fornecedor</Th>
                  <Th>Situacao</Th>
                  <Th>Valor da placa</Th>
                </Tr>
              </Thead>
              <Tbody>
                {h.compras.map((c) => (
                  <Tr key={`${c.loteId}-${c.pedidoId ?? 'sem-pedido'}`}>
                    <Td>{new Date(c.data).toLocaleDateString('pt-BR')}</Td>
                    <Td>
                      <Link to={`/compras/lotes/${c.loteId}`} className="text-ceara-azul hover:underline">
                        {c.loteNumero}
                      </Link>
                    </Td>
                    <Td className="font-mono">{c.pedidoNumero ?? '—'}</Td>
                    <Td>{c.fornecedor ?? '—'}</Td>
                    <Td>
                      <Badge tom={c.situacao === 'PEDIDO' ? 'verde' : 'ouro'}>
                        {c.situacao === 'PEDIDO' ? 'pedido emitido' : c.loteStatus.replaceAll('_', ' ').toLowerCase()}
                      </Badge>
                    </Td>
                    <Td>
                      {moedaOuTraco(c.valorApurado ? c.valorCentro : null)}
                      {c.rateado && c.valorApurado && (
                        <span className="ml-1 text-legenda italic text-ceara-texto2">
                          rateado de {moeda(c.valorTotalLote)}
                        </span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <EstadoVazio
              titulo="Sem compras na janela"
              descricao="Esta placa nao teve solicitacao de compra no periodo selecionado."
            />
          )}
        </div>

        <dl className="flex flex-col gap-1 text-legenda italic text-ceara-texto2">
          {Object.entries(h.memoriaDeCalculo).map(([chave, texto]) => (
            <p key={chave}>
              <span className="not-italic font-medium text-ceara-texto">{chave}:</span> {texto}
            </p>
          ))}
        </dl>
      </CardCorpo>
    </Card>
  );
}

/** Barra proporcional ao maior mes, com piso visivel para o mes de gasto baixo nao sumir. */
const barra = (valor: number, maior: number): number =>
  maior <= 0 ? 0 : Math.max(2, Math.round((valor / maior) * 60));

// ---------------------------------------------------------------- decisao

function Decidir({
  lote,
  usuarioId,
  aoErrar,
  aoDecidir,
}: {
  lote: LoteNaFila;
  usuarioId: string | null;
  aoErrar: (e: string | null) => void;
  aoDecidir: () => Promise<void>;
}) {
  const [decisao, setDecisao] = useState<Decisao>('APROVADO');
  const [texto, setTexto] = useState('');

  const enviar = useMutation({
    mutationFn: () =>
      post(`/compras/lotes/${lote.id}/aprovacao`, {
        decisao,
        ressalva: decisao === 'APROVADO_COM_RESSALVA' ? texto.trim() : null,
        motivo: decisao === 'DEVOLVIDO' || decisao === 'REPROVADO' ? texto.trim() : null,
      }),
    onSuccess: async () => {
      aoErrar(null);
      setTexto('');
      setDecisao('APROVADO');
      await aoDecidir();
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao registrar a decisao.'),
  });

  // aviso, nao trava: quem decide a SoD e o servidor, e a faixa 1 admite autoaprovacao
  const proprioComprador = usuarioId !== null && lote.comprador.id === usuarioId;
  const proprioSolicitante = usuarioId !== null && lote.solicitantesIds.includes(usuarioId);

  const exigeTexto = decisao !== 'APROVADO';
  const textoCurto = exigeTexto && texto.trim().length < 5;

  return (
    <Card>
      <CardTitulo>Decisao</CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        {(proprioComprador || proprioSolicitante) && (
          <p className="rounded-card border-l-4 border-ceara-ouro bg-[var(--ceara-ouro-15)] px-4 py-3 text-corpo text-ceara-texto">
            Voce {proprioComprador ? 'conduziu a cotacao' : 'abriu uma das solicitacoes'} deste lote. A segregacao de
            funcoes e avaliada no servidor e so a faixa 1 admite autoaprovacao, registrada como tal.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {(Object.keys(ROTULO_DECISAO) as Decisao[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDecisao(d)}
              aria-current={decisao === d}
              className={
                decisao === d
                  ? 'flex items-center gap-2 rounded-lg border border-ceara-azul bg-[var(--ceara-azul-10)] px-3 py-2 text-corpo font-medium text-ceara-azul'
                  : 'flex items-center gap-2 rounded-lg border border-ceara-borda px-3 py-2 text-corpo text-ceara-texto hover:border-ceara-azul'
              }
            >
              {d === 'APROVADO' && <Check size={14} aria-hidden />}
              {d === 'APROVADO_COM_RESSALVA' && <AlertTriangle size={14} aria-hidden />}
              {d === 'DEVOLVIDO' && <Undo2 size={14} aria-hidden />}
              {d === 'REPROVADO' && <X size={14} aria-hidden />}
              {ROTULO_DECISAO[d]}
            </button>
          ))}
        </div>

        {exigeTexto && (
          <Campo
            rotulo={decisao === 'APROVADO_COM_RESSALVA' ? 'Ressalva' : 'Motivo'}
            htmlFor="texto-decisao"
            obrigatorio
            ajuda={
              decisao === 'DEVOLVIDO'
                ? 'A devolucao volta o lote para renegociacao com o comprador e fica no historico.'
                : 'Fica na aprovacao eletronica, com data, hora, IP e hash — nao se apaga depois.'
            }
          >
            <textarea
              id="texto-decisao"
              rows={3}
              className="rounded-lg border border-ceara-borda px-3 py-2 text-corpo"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </Campo>
        )}

        <div className="flex justify-end">
          <Button disabled={textoCurto} carregando={enviar.isPending} onClick={() => enviar.mutate()}>
            Registrar {ROTULO_DECISAO[decisao].toLowerCase()}
          </Button>
        </div>
      </CardCorpo>
    </Card>
  );
}

function Dado({
  rotulo,
  valor,
  complemento,
  tom = 'normal',
}: {
  rotulo: string;
  valor: string;
  complemento?: string;
  tom?: 'normal' | 'vermelho';
}) {
  return (
    <div>
      <p className="text-legenda text-ceara-texto2">{rotulo}</p>
      <p className={`text-h3 ${tom === 'vermelho' ? 'text-ceara-vermelho' : 'text-ceara-azul'}`}>{valor}</p>
      {complemento && <p className="text-legenda text-ceara-texto2">{complemento}</p>}
    </div>
  );
}
