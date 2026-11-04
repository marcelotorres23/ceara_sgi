import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Award, CheckCircle2, Download, Paperclip, Send, TrendingDown } from 'lucide-react';
import { get, post, baixarArquivo, ApiError } from '../../lib/api';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { Card, CardCorpo, CardTitulo } from '../../design-system/components/Card';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../design-system/components/Table';
import { moeda } from './tipos';
import { RegistrarProposta } from './RegistrarProposta';
import { EvidenciasDaCotacao } from './EvidenciasDaCotacao';
import {
  itensDoLote,
  percentualBr,
  propostasMinimas,
  respondidas,
  type Cotacao,
  type Fornecedor,
  type LinhaDoRanking,
  type LoteDetalhado,
  type NotaAnexada,
  type PainelDeSavings,
  type RecebimentoDoLote,
  type RespostaDoMapa,
} from './lote';

type Aba = 'cotacoes' | 'mapa' | 'pedido' | 'fiscal';

/**
 * Detalhe do lote: o trabalho do comprador da cotacao ao pedido (secoes 6.1.5 a 6.1.8).
 *
 * O comprador registra quantas propostas conseguir levantar - o minimo por faixa e
 * exigido pelo servidor, mas nada impede registrar mais. Quanto mais propostas,
 * mais confiavel o savings: a base de comparacao e a pior proposta levantada.
 */
export function DetalheLote() {
  const { id = '' } = useParams();
  const cliente = useQueryClient();
  const [aba, setAba] = useState<Aba>('cotacoes');
  const [erro, setErro] = useState<string | null>(null);

  const lote = useQuery({
    queryKey: ['compras', 'lote', id],
    queryFn: () => get<LoteDetalhado>(`/compras/lotes/${id}`),
    enabled: Boolean(id),
  });

  if (lote.isLoading) return <p className="text-corpo text-ceara-texto2">Carregando o lote...</p>;
  if (!lote.data) return <p className="text-corpo text-ceara-vermelho">Lote nao encontrado nesta unidade.</p>;

  const dados = lote.data;
  const comResposta = respondidas(dados);
  const minimas = propostasMinimas(Number(dados.valorEstimado ?? 0));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/compras" className="mb-1 flex items-center gap-1 text-legenda text-ceara-azul hover:underline">
            <ArrowLeft size={14} aria-hidden />
            Voltar ao painel
          </Link>
          <h1 className="text-h1 text-ceara-azul">{dados.numero}</h1>
          <p className="mt-1 text-legenda text-ceara-texto2">
            {dados.criticidade} · comprador {dados.comprador.nome} · {dados.solicitacoes.length} solicitacao(oes) ·{' '}
            {itensDoLote(dados).length} item(ns)
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <Badge tom="azul">{dados.status.replaceAll('_', ' ').toLowerCase()}</Badge>
          {dados.valorEstimado && (
            <span className="text-legenda text-ceara-texto2">estimado {moeda(dados.valorEstimado)}</span>
          )}
        </div>
      </header>

      {erro && (
        <p role="alert" className="rounded-card border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-4 py-3 text-corpo text-ceara-vermelho">
          {erro}
        </p>
      )}

      <nav className="flex gap-1 border-b border-ceara-borda" aria-label="Etapas do lote">
        {(
          [
            ['cotacoes', `Cotacoes (${comResposta.length}/${minimas})`],
            ['mapa', 'Mapa e savings'],
            ['pedido', 'Aprovacao e pedido'],
            ['fiscal', dados.tipo === 'SERVICO' ? 'Recebimento e NFS-e' : 'Recebimento e NF-e'],
          ] as Array<[Aba, string]>
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            onClick={() => setAba(chave)}
            aria-current={aba === chave}
            className={
              aba === chave
                ? 'border-b-2 border-ceara-ouro px-4 py-2 text-corpo font-medium text-ceara-azul'
                : 'border-b-2 border-transparent px-4 py-2 text-corpo text-ceara-texto2 hover:text-ceara-azul'
            }
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === 'cotacoes' && <AbaCotacoes lote={dados} minimas={minimas} aoErrar={setErro} />}
      {aba === 'mapa' && <AbaMapa lote={dados} aoErrar={setErro} />}
      {aba === 'pedido' && <AbaPedido lote={dados} aoErrar={setErro} aoAtualizar={() => cliente.invalidateQueries({ queryKey: ['compras', 'lote', id] })} />}
      {aba === 'fiscal' && <AbaFiscal lote={dados} aoErrar={setErro} aoAtualizar={() => cliente.invalidateQueries({ queryKey: ['compras', 'lote', id] })} />}
    </div>
  );
}

// ---------------------------------------------------------------- cotacoes

function AbaCotacoes({
  lote,
  minimas,
  aoErrar,
}: {
  lote: LoteDetalhado;
  minimas: number;
  aoErrar: (e: string | null) => void;
}) {
  const cliente = useQueryClient();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [respondendo, setRespondendo] = useState<Cotacao | null>(null);
  const [vendoEvidencias, setVendoEvidencias] = useState<string | null>(null);

  const fornecedores = useQuery({
    queryKey: ['compras', 'fornecedores'],
    queryFn: () => get<{ itens: Fornecedor[] }>('/compras/fornecedores?limite=100'),
    staleTime: 300_000,
  });

  const abrir = useMutation({
    mutationFn: () => post(`/compras/lotes/${lote.id}/cotacoes`, { fornecedorIds: [...selecionados] }),
    onSuccess: async () => {
      aoErrar(null);
      setSelecionados(new Set());
      await cliente.invalidateQueries({ queryKey: ['compras', 'lote', lote.id] });
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao abrir as cotacoes.'),
  });

  const jaCotados = new Set(lote.cotacoes.map((c) => c.fornecedorId));
  const disponiveis = (fornecedores.data?.itens ?? []).filter(
    (f) => !jaCotados.has(f.id) && f.status === 'HOMOLOGADO',
  );

  const comResposta = respondidas(lote);
  const faltam = Math.max(minimas - comResposta.length, 0);

  return (
    <div className="flex flex-col gap-5">
      <Card destaque={faltam > 0 ? 'regra' : 'ok'}>
        <CardCorpo className="pt-4">
          <p className="text-corpo text-ceara-texto">
            {comResposta.length} proposta(s) respondida(s) de {lote.cotacoes.length} enviada(s).{' '}
            {faltam > 0 ? (
              <span className="font-medium text-[#8a6300]">
                Faltam {faltam} para a faixa deste lote. Registre a recusa de quem nao respondeu — recusa tambem conta.
              </span>
            ) : (
              <span className="font-medium text-ceara-verde">Minimo da faixa atendido.</span>
            )}
          </p>
          <p className="mt-1 text-legenda italic text-ceara-texto2">
            Registre quantas propostas conseguir levantar. A base do savings e a pior proposta do lote: com duas,
            o numero e fraco; com quatro ou cinco, ele descreve o mercado que voce consultou.
          </p>
        </CardCorpo>
      </Card>

      <Card>
        <CardTitulo
          acao={
            <Button
              tamanho="sm"
              iconeEsquerda={<Send size={14} aria-hidden />}
              disabled={selecionados.size === 0}
              carregando={abrir.isPending}
              onClick={() => abrir.mutate()}
            >
              Abrir cotacao ({selecionados.size})
            </Button>
          }
        >
          Fornecedores homologados
        </CardTitulo>
        <CardCorpo>
          {disponiveis.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {disponiveis.map((f) => (
                <label
                  key={f.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-ceara-borda px-3 py-2 text-corpo"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--ceara-azul)]"
                    checked={selecionados.has(f.id)}
                    onChange={() =>
                      setSelecionados((atuais) => {
                        const nova = new Set(atuais);
                        if (nova.has(f.id)) nova.delete(f.id);
                        else nova.add(f.id);
                        return nova;
                      })
                    }
                  />
                  {f.razaoSocial}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-corpo text-ceara-texto2">
              Todos os fornecedores homologados ja foram cotados neste lote. Homologue outro fornecedor em Cadastros
              para ampliar a comparacao.
            </p>
          )}
        </CardCorpo>
      </Card>

      <Card>
        <CardTitulo>Cotacoes do lote</CardTitulo>
        <CardCorpo>
          {lote.cotacoes.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Fornecedor</Th>
                  <Th>Situacao</Th>
                  <Th>Total</Th>
                  <Th>Pagamento</Th>
                  <Th>Entrega</Th>
                  <Th>Evidencia</Th>
                  <Th>Acoes</Th>
                </Tr>
              </Thead>
              <Tbody>
                {lote.cotacoes.map((c) => (
                  <Tr key={c.id}>
                    <Td>{c.fornecedor.razaoSocial}</Td>
                    <Td>
                      {c.recusada ? (
                        <>
                          <Badge tom="neutro">Recusou</Badge>
                          {c.motivoRecusa && (
                            <p className="mt-1 max-w-[16rem] text-legenda italic text-ceara-texto2">{c.motivoRecusa}</p>
                          )}
                        </>
                      ) : c.respondidaEm ? (
                        <Badge tom="verde">Respondida</Badge>
                      ) : (
                        <Badge tom="ouro">Aguardando</Badge>
                      )}
                    </Td>
                    <Td>{c.valorTotal ? moeda(c.valorTotal) : '—'}</Td>
                    <Td>{c.condicaoPagamento ?? '—'}</Td>
                    <Td>{c.prazoEntregaDias !== null ? `${c.prazoEntregaDias} dias` : '—'}</Td>
                    <Td>
                      {(lote.evidenciasPorCotacao?.[c.id] ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 text-ceara-azul hover:underline"
                          onClick={() => setVendoEvidencias(vendoEvidencias === c.id ? null : c.id)}
                        >
                          <Paperclip size={14} aria-hidden />
                          {lote.evidenciasPorCotacao[c.id]}
                        </button>
                      ) : (
                        <span className="text-ceara-texto2" title="Proposta sem comprovante anexado">
                          sem evidencia
                        </span>
                      )}
                    </Td>
                    <Td>
                      {!c.respondidaEm && !c.recusada && (
                        <Button tamanho="sm" variante="secundario" onClick={() => setRespondendo(c)}>
                          Registrar proposta
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <p className="text-corpo text-ceara-texto2">
              Nenhuma cotacao aberta. Selecione os fornecedores acima para enviar a rodada.
            </p>
          )}

          {vendoEvidencias && (
            <div className="mt-4">
              <EvidenciasDaCotacao cotacaoId={vendoEvidencias} loteId={lote.id} somenteLeitura />
            </div>
          )}

          {respondendo && (
            <div className="mt-4">
              <RegistrarProposta lote={lote} cotacao={respondendo} aoConcluir={() => setRespondendo(null)} />
            </div>
          )}
        </CardCorpo>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- mapa e savings

function AbaMapa({ lote, aoErrar }: { lote: LoteDetalhado; aoErrar: (e: string | null) => void }) {
  const cliente = useQueryClient();
  const [escolhida, setEscolhida] = useState<string>('');
  const [justificativa, setJustificativa] = useState('');
  const [resultado, setResultado] = useState<RespostaDoMapa | null>(null);

  const savings = useQuery({
    queryKey: ['compras', 'savings'],
    queryFn: () => get<PainelDeSavings>('/relatorios/compras/savings'),
  });

  const gerar = useMutation({
    mutationFn: () =>
      post<RespostaDoMapa>(`/compras/lotes/${lote.id}/mapa`, {
        cotacaoEscolhidaId: escolhida || null,
        justificativa: justificativa.trim() || null,
      }),
    onSuccess: async (r) => {
      aoErrar(null);
      setResultado(r);
      await cliente.invalidateQueries({ queryKey: ['compras'] });
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao gerar o mapa.'),
  });

  const comResposta = respondidas(lote);
  const ranking = resultado?.ranking ?? [];
  const doComprador = savings.data?.itens.find((i) => i.comprador === lote.comprador.nome);

  // menor preco de face, para o comprador ver de imediato se a escolha diverge
  const menorFace = ranking.reduce<LinhaDoRanking | null>(
    (min, l) => (min === null || Number(l.valorLiquido) < Number(min.valorLiquido) ? l : min),
    null,
  );

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-4 sm:grid-cols-3">
        <Kpi
          rotulo="Savings deste lote"
          valor={moeda(resultado?.savings ?? lote.savings ?? '0')}
          rodape="base: pior proposta levantada"
          Icone={TrendingDown}
          destaque={Number(resultado?.savings ?? lote.savings ?? 0) > 0 ? 'ok' : 'nenhum'}
        />
        <Kpi
          rotulo={`Savings de ${lote.comprador.nome} no mes`}
          valor={moeda(doComprador?.savings ?? '0')}
          rodape={`${percentualBr(doComprador?.percentual ?? null)} do negociado · meta 5%`}
          destaque={doComprador?.dentroDaMeta ? 'ok' : 'nenhum'}
          Icone={Award}
        />
        <Kpi
          rotulo="Lotes comparaveis"
          valor={`${doComprador?.lotesComparaveis ?? 0} de ${doComprador?.lotes ?? 0}`}
          rodape="lote com uma proposta so nao gera savings"
        />
      </section>

      <Card>
        <CardTitulo>Comparativo por valor presente</CardTitulo>
        <CardCorpo className="flex flex-col gap-4">
          {comResposta.length < 2 ? (
            <p className="text-corpo text-ceara-texto2">
              Sao necessarias ao menos duas propostas respondidas para comparar. Registre mais cotacoes na aba anterior.
            </p>
          ) : (
            <>
              <p className="text-legenda italic text-ceara-texto2">
                A comparacao usa valor presente, nao valor de face: VP = valor liquido / (1 + taxa)^(prazo/30).
                Prazo maior vale desconto, e e por isso que o menor preco nem sempre e a melhor proposta.
              </p>

              <Campo
                rotulo="Proposta escolhida"
                htmlFor="escolhida"
                ajuda="Em branco, o sistema segue a recomendacao automatica por valor presente."
              >
                <select
                  id="escolhida"
                  className={classeControle()}
                  value={escolhida}
                  onChange={(e) => setEscolhida(e.target.value)}
                >
                  <option value="">Seguir a recomendacao do sistema</option>
                  {comResposta.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fornecedor.razaoSocial} · {c.valorTotal ? moeda(c.valorTotal) : 'sem total'}
                    </option>
                  ))}
                </select>
              </Campo>

              {escolhida && menorFace && escolhida !== menorFace.cotacaoId && (
                <Campo
                  rotulo="Justificativa da escolha divergente"
                  htmlFor="justificativa"
                  obrigatorio
                  ajuda="Escolha fora do menor preco exige justificativa e sobe um nivel de alcada (regra de ouro 3)."
                >
                  <textarea
                    id="justificativa"
                    rows={3}
                    className="rounded-lg border border-ceara-borda px-3 py-2 text-corpo"
                    value={justificativa}
                    onChange={(e) => setJustificativa(e.target.value)}
                  />
                </Campo>
              )}

              <div className="flex justify-end">
                <Button carregando={gerar.isPending} onClick={() => gerar.mutate()}>
                  Gerar mapa de cotacao
                </Button>
              </div>
            </>
          )}

          {ranking.length > 0 && (
            <>
              <Table>
                <Thead>
                  <Tr>
                    <Th>#</Th>
                    <Th>Fornecedor</Th>
                    <Th>Valor liquido</Th>
                    <Th>Prazo</Th>
                    <Th>Valor presente</Th>
                    <Th>Diferenca</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {ranking.map((l) => (
                    <Tr key={l.cotacaoId}>
                      <Td>{l.posicao}</Td>
                      <Td>
                        {l.fornecedor}
                        {l.posicao === 1 && (
                          <Badge tom="verde" className="ml-2">
                            recomendada
                          </Badge>
                        )}
                      </Td>
                      <Td>{moeda(l.valorLiquido)}</Td>
                      <Td>{l.prazoDias} dias</Td>
                      <Td className="font-medium">{moeda(l.valorPresente)}</Td>
                      <Td>{percentualBr(Number(l.diferencaPercentual))}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>

              {resultado?.divergenteMenorPreco && (
                <p className="rounded-card border-l-4 border-ceara-ouro bg-[var(--ceara-ouro-15)] px-4 py-3 text-corpo text-ceara-texto">
                  Escolha divergente do menor preco de face. A alcada sobe um nivel e a justificativa fica registrada
                  no mapa.
                </p>
              )}
            </>
          )}

          {savings.data && (
            <dl className="flex flex-col gap-1 text-legenda italic text-ceara-texto2">
              {Object.entries(savings.data.memoriaDeCalculo).map(([chave, texto]) => (
                <p key={chave}>
                  <span className="not-italic font-medium text-ceara-texto">{chave}:</span> {texto}
                </p>
              ))}
            </dl>
          )}
        </CardCorpo>
      </Card>
    </div>
  );
}

/**
 * Baixa o pedido em PDF (secao 6.1.8).
 *
 * Passa pelo cliente de API, e nao por um `<a download>`: o download precisa da sessao, e
 * um link solto perderia a renovacao do token no meio de uma sessao longa — a pessoa
 * receberia um arquivo de erro com extensao .pdf, que so se descobre ao abrir.
 */
function BaixarPedidoPdf({
  pedidoId,
  numero,
  aoErrar,
}: {
  pedidoId: string;
  numero: string;
  aoErrar: (e: string | null) => void;
}) {
  const [baixando, setBaixando] = useState(false);

  async function baixar() {
    setBaixando(true);
    try {
      await baixarArquivo(`/compras/pedidos/${pedidoId}/pdf`, `${numero}.pdf`);
      aoErrar(null);
    } catch (falha) {
      aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao gerar o PDF do pedido.');
    } finally {
      setBaixando(false);
    }
  }

  return (
    <Button
      tamanho="sm"
      variante="secundario"
      carregando={baixando}
      iconeEsquerda={<Download size={14} aria-hidden />}
      onClick={() => void baixar()}
    >
      PDF
    </Button>
  );
}

// ---------------------------------------------------------------- decisao da alcada

const ROTULO_DECISAO: Record<Decisao, string> = {
  APROVADO: 'Aprovar',
  APROVADO_COM_RESSALVA: 'Aprovar com ressalva',
  DEVOLVIDO: 'Devolver para renegociar',
  REPROVADO: 'Reprovar',
};

type Decisao = 'APROVADO' | 'APROVADO_COM_RESSALVA' | 'DEVOLVIDO' | 'REPROVADO';

/**
 * Decisao da alcada, na propria tela do lote (secao 6.4).
 *
 * O aprovador chega aqui pelo lote, e nao pela fila: ele acabou de ver as tres propostas na
 * aba ao lado. Obrigar a sair, achar a fila e reabrir o mesmo lote e pedir para decidir sem
 * o que se acabou de ler.
 *
 * O botao so fica ativo quando o servidor diz que a pessoa pode — e quando nao pode, o
 * motivo aparece no lugar do botao. Botao ativo que falha no clique ensina a nao confiar
 * na tela; botao apagado sem explicacao manda adivinhar.
 */
function DecisaoDaAlcada({
  lote,
  aoErrar,
  aoAtualizar,
}: {
  lote: LoteDetalhado;
  aoErrar: (e: string | null) => void;
  aoAtualizar: () => void;
}) {
  const [decisao, setDecisao] = useState<Decisao>('APROVADO');
  const [texto, setTexto] = useState('');
  const disponivel = lote.aprovacaoDisponivel;

  const enviar = useMutation({
    mutationFn: () =>
      post(`/compras/lotes/${lote.id}/aprovacao`, {
        decisao,
        ressalva: decisao === 'APROVADO_COM_RESSALVA' ? texto.trim() : null,
        motivo: decisao === 'DEVOLVIDO' || decisao === 'REPROVADO' ? texto.trim() : null,
      }),
    onSuccess: () => {
      aoErrar(null);
      setTexto('');
      setDecisao('APROVADO');
      aoAtualizar();
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao registrar a decisao.'),
  });

  // etapa errada nao merece card nenhum: o lote ainda nem foi submetido, ou ja foi decidido
  if (!disponivel.aplicavel) return null;

  const exigeTexto = decisao !== 'APROVADO';
  const textoCurto = exigeTexto && texto.trim().length < 5;

  return (
    <Card>
      <CardTitulo>Decisao da alcada</CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-legenda text-ceara-texto2">Valor em decisao</p>
            <p className="text-h3 text-ceara-azul">{disponivel.valor ? moeda(disponivel.valor) : '—'}</p>
          </div>
          <div>
            <p className="text-legenda text-ceara-texto2">Faixa</p>
            <p className="text-h3 text-ceara-azul">{disponivel.nivel ?? '—'}</p>
          </div>
          <div>
            <p className="text-legenda text-ceara-texto2">Aprovador da faixa</p>
            <p className="text-h3 text-ceara-azul">{disponivel.perfilExigido ?? '—'}</p>
          </div>
        </div>

        {!disponivel.pode ? (
          <p
            role="status"
            className="rounded-card border-l-4 border-ceara-ouro bg-[var(--ceara-ouro-15)] px-4 py-3 text-corpo text-ceara-texto"
          >
            {disponivel.motivo ?? 'Este lote nao esta disponivel para a sua decisao.'}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ROTULO_DECISAO) as Decisao[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDecisao(d)}
                  aria-current={decisao === d}
                  className={
                    decisao === d
                      ? 'rounded-lg border border-ceara-azul bg-[var(--ceara-azul-10)] px-3 py-2 text-corpo font-medium text-ceara-azul'
                      : 'rounded-lg border border-ceara-borda px-3 py-2 text-corpo text-ceara-texto hover:border-ceara-azul'
                  }
                >
                  {ROTULO_DECISAO[d]}
                </button>
              ))}
            </div>

            {exigeTexto && (
              <Campo
                rotulo={decisao === 'APROVADO_COM_RESSALVA' ? 'Ressalva' : 'Motivo'}
                htmlFor="texto-decisao-lote"
                obrigatorio
                ajuda="Fica na aprovacao eletronica, com data, hora, IP e hash — nao se apaga depois."
              >
                <textarea
                  id="texto-decisao-lote"
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
          </>
        )}
      </CardCorpo>
    </Card>
  );
}

// ---------------------------------------------------------------- aprovacao e pedido

function AbaPedido({
  lote,
  aoErrar,
  aoAtualizar,
}: {
  lote: LoteDetalhado;
  aoErrar: (e: string | null) => void;
  aoAtualizar: () => void;
}) {
  const [dataPrometida, setDataPrometida] = useState('');

  const submeter = useMutation({
    mutationFn: () => post(`/compras/lotes/${lote.id}/submeter`, {}),
    onSuccess: () => {
      aoErrar(null);
      aoAtualizar();
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao submeter a aprovacao.'),
  });

  const emitir = useMutation({
    mutationFn: () => post(`/compras/lotes/${lote.id}/pedido`, { dataPrometida }),
    onSuccess: () => {
      aoErrar(null);
      aoAtualizar();
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao emitir o pedido.'),
  });

  return (
    <div className="flex flex-col gap-5">
      <DecisaoDaAlcada lote={lote} aoErrar={aoErrar} aoAtualizar={aoAtualizar} />

      <Card>
        <CardTitulo
          acao={
            <Button tamanho="sm" carregando={submeter.isPending} onClick={() => submeter.mutate()}>
              Submeter a alcada
            </Button>
          }
        >
          Aprovacao
        </CardTitulo>
        <CardCorpo>
          {lote.aprovacoes.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Nivel</Th>
                  <Th>Aprovador</Th>
                  <Th>Decisao</Th>
                  <Th>Quando</Th>
                  <Th>Observacao</Th>
                </Tr>
              </Thead>
              <Tbody>
                {lote.aprovacoes.map((a) => (
                  <Tr key={a.id}>
                    <Td>{a.nivel}</Td>
                    <Td>{a.aprovador.nome}</Td>
                    <Td>
                      <Badge tom={a.decisao.startsWith('APROVADO') ? 'verde' : 'vermelho'}>
                        {a.decisao.replaceAll('_', ' ').toLowerCase()}
                      </Badge>
                    </Td>
                    <Td>{new Date(a.decididoEm).toLocaleString('pt-BR')}</Td>
                    <Td className="max-w-[20rem] truncate">{a.ressalva ?? a.motivo ?? '—'}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <p className="text-corpo text-ceara-texto2">
              Ainda sem decisao. Gere o mapa e submeta a alcada — o nivel sai do valor do lote
              {lote.nivelAlcada ? ` (faixa ${lote.nivelAlcada})` : ''}.
            </p>
          )}
        </CardCorpo>
      </Card>

      <Card>
        <CardTitulo>Pedido de compra</CardTitulo>
        <CardCorpo className="flex flex-col gap-4">
          {lote.pedidos.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Numero</Th>
                  <Th>Valor</Th>
                  <Th>Data prometida</Th>
                  <Th>Reprogramada</Th>
                  <Th>Situacao</Th>
                  <Th>Documento</Th>
                </Tr>
              </Thead>
              <Tbody>
                {lote.pedidos.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-mono">{p.numero}</Td>
                    <Td>{moeda(p.valorTotal)}</Td>
                    <Td>{new Date(p.dataPrometida).toLocaleDateString('pt-BR')}</Td>
                    <Td>
                      {p.dataReprogramada ? new Date(p.dataReprogramada).toLocaleDateString('pt-BR') : '—'}
                    </Td>
                    <Td>
                      <Badge tom="azul">{p.status.toLowerCase()}</Badge>
                    </Td>
                    <Td>
                      <BaixarPedidoPdf pedidoId={p.id} numero={p.numero} aoErrar={aoErrar} />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Campo
                rotulo="Data prometida pelo fornecedor"
                htmlFor="data-prometida"
                obrigatorio
                ajuda="Alimenta o OTIF e o alerta D-2. Reprogramar depois mantem o atraso original no historico."
              >
                <input
                  id="data-prometida"
                  type="date"
                  className={classeControle()}
                  value={dataPrometida}
                  onChange={(e) => setDataPrometida(e.target.value)}
                />
              </Campo>
              <Button disabled={!dataPrometida} carregando={emitir.isPending} onClick={() => emitir.mutate()}>
                Emitir pedido
              </Button>
            </div>
          )}
        </CardCorpo>
      </Card>
    </div>
  );
}

function Kpi({
  rotulo,
  valor,
  rodape,
  destaque = 'nenhum',
  Icone,
}: {
  rotulo: string;
  valor: string;
  rodape?: string;
  destaque?: 'nenhum' | 'ok' | 'regra';
  Icone?: typeof Award;
}) {
  return (
    <Card destaque={destaque}>
      <CardCorpo className="flex items-start gap-3 pt-4">
        {Icone && <Icone size={20} className="mt-1 text-ceara-azul" aria-hidden />}
        <div>
          <p className="text-legenda text-ceara-texto2">{rotulo}</p>
          <p className="text-h2 text-ceara-azul">{valor}</p>
          {rodape && <p className="mt-1 text-legenda text-ceara-texto2">{rodape}</p>}
        </div>
      </CardCorpo>
    </Card>
  );
}

// ---------------------------------------------------------------- recebimento e nota fiscal

/**
 * Etapa fiscal do lote (secao 6.1.11).
 *
 * A conferencia fisica e feita pelo almoxarifado; o que acontece aqui e o que vem depois
 * dela: lancar a nota, guardar o arquivo dela e fechar o processo.
 *
 * O arquivo importa tanto quanto o numero. Numero e chave ja ficavam gravados, mas o
 * documento morava no e-mail de alguem — e nota fiscal que mora em caixa de entrada some
 * quando a pessoa sai da empresa. Quem confere o pagamento, trata divergencia ou audita
 * meses depois precisa abrir o papel, nao o campo.
 */
function AbaFiscal({
  lote,
  aoErrar,
  aoAtualizar,
}: {
  lote: LoteDetalhado;
  aoErrar: (e: string | null) => void;
  aoAtualizar: () => void;
}) {
  const documento = lote.tipo === 'SERVICO' ? 'NFS-e' : 'NF-e';
  const recebimentos = lote.pedidos.flatMap((p) => p.recebimentos.map((r) => ({ ...r, pedido: p.numero })));
  const encerrado = lote.status === 'ENCERRADO';

  if (recebimentos.length === 0) {
    return (
      <Card>
        <CardTitulo>Recebimento e {documento}</CardTitulo>
        <CardCorpo>
          <p className="text-corpo text-ceara-texto2">
            Nada recebido ainda. A conferencia fisica e registrada pelo almoxarifado, com o three-way match entre
            pedido, {documento} e o que chegou. Depois dela, a nota entra por aqui.
          </p>
        </CardCorpo>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {encerrado && (
        <Card destaque="ok">
          <CardCorpo className="flex items-start gap-2 pt-4">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ceara-verde" aria-hidden />
            <div>
              <p className="text-corpo font-medium text-ceara-verde">Processo finalizado.</p>
              <p className="text-legenda text-ceara-texto2">
                Material recebido, {documento} lancada e titulo provisionado — as tres condicoes do encerramento
                (secao 6.2). O lote sai do painel e nao aceita mais movimento.
              </p>
            </div>
          </CardCorpo>
        </Card>
      )}

      {recebimentos.map((r) => (
        <BlocoDoRecebimento
          key={r.id}
          recebimento={r}
          documento={documento}
          ehServico={lote.tipo === 'SERVICO'}
          aoErrar={aoErrar}
          aoAtualizar={aoAtualizar}
        />
      ))}
    </div>
  );
}

function BlocoDoRecebimento({
  recebimento,
  documento,
  ehServico,
  aoErrar,
  aoAtualizar,
}: {
  recebimento: RecebimentoDoLote & { pedido: string };
  documento: string;
  ehServico: boolean;
  aoErrar: (e: string | null) => void;
  aoAtualizar: () => void;
}) {
  const lancada = recebimento.fiscalEm !== null;
  const titulo = recebimento.titulos[0];

  return (
    <Card>
      <CardTitulo>
        Pedido {recebimento.pedido} · recebido em {new Date(recebimento.recebidoEm).toLocaleDateString('pt-BR')}
      </CardTitulo>
      <CardCorpo className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-6">
          <DadoFiscal rotulo="Conferencia" valor={recebimento.status.replaceAll('_', ' ').toLowerCase()} />
          <DadoFiscal rotulo="Three-way match" valor={recebimento.threeWayOk ? 'conforme' : 'com divergencia'} />
          <DadoFiscal rotulo="Conferido por" valor={recebimento.almoxarife.nome} />
          <DadoFiscal
            rotulo={`Entrada da ${documento}`}
            valor={lancada ? new Date(recebimento.fiscalEm as string).toLocaleString('pt-BR') : 'pendente'}
          />
        </div>

        {/* o arquivo pode entrar antes ou depois do lancamento: o XML costuma chegar por e-mail primeiro */}
        <NotasAnexadas recebimentoId={recebimento.id} documento={documento} aoErrar={aoErrar} />

        {lancada ? (
          <p className="rounded-card border-l-4 border-ceara-verde bg-[rgba(30,132,73,0.08)] px-4 py-3 text-corpo text-ceara-texto">
            {documento} {recebimento.nfNumero} lancada.
            {titulo ? ` Titulo provisionado em ${moeda(titulo.valor)}` : ''}
            {titulo && Number(titulo.valorRetido) > 0
              ? `, com ${moeda(titulo.valorRetido)} retido por divergencia`
              : ''}
            {titulo ? '.' : ''}
          </p>
        ) : (
          <LancarEntradaFiscal
            recebimentoId={recebimento.id}
            documento={documento}
            ehServico={ehServico}
            nfNumeroAtual={recebimento.nfNumero}
            aoErrar={aoErrar}
            aoAtualizar={aoAtualizar}
          />
        )}
      </CardCorpo>
    </Card>
  );
}

function DadoFiscal({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-legenda text-ceara-texto2">{rotulo}</p>
      <p className="text-corpo font-medium text-ceara-azul">{valor}</p>
    </div>
  );
}

/** Arquivos da nota: DANFE, XML, NFS-e ou a foto da nota em papel. */
function NotasAnexadas({
  recebimentoId,
  documento,
  aoErrar,
}: {
  recebimentoId: string;
  documento: string;
  aoErrar: (e: string | null) => void;
}) {
  const cliente = useQueryClient();
  const [enviando, setEnviando] = useState(false);

  const notas = useQuery({
    queryKey: ['compras', 'notas', recebimentoId],
    queryFn: () => get<{ itens: NotaAnexada[] }>(`/compras/recebimentos/${recebimentoId}/nota-fiscal/anexos`),
  });

  async function enviar(arquivo: File) {
    setEnviando(true);
    try {
      const base64 = await paraBase64(arquivo);
      await post(`/compras/recebimentos/${recebimentoId}/nota-fiscal/anexos`, {
        conteudoBase64: base64,
        // .xml salvo de e-mail costuma chegar sem tipo; o servidor aceita o generico
        mime: arquivo.type || 'application/octet-stream',
        nome: arquivo.name,
      });
      aoErrar(null);
      await cliente.invalidateQueries({ queryKey: ['compras', 'notas', recebimentoId] });
    } catch (falha) {
      aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao anexar a nota.');
    } finally {
      setEnviando(false);
    }
  }

  const itens = notas.data?.itens ?? [];

  return (
    <div className="rounded-card border border-ceara-borda p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-h3 text-ceara-texto">Arquivo da {documento}</p>
        <label className="cursor-pointer rounded-lg border border-ceara-azul px-3 py-1.5 text-corpo text-ceara-azul hover:bg-[var(--ceara-azul-10)]">
          {enviando ? 'Enviando...' : 'Anexar arquivo'}
          <input
            type="file"
            className="hidden"
            accept=".pdf,.xml,.jpg,.jpeg,.png,.webp"
            disabled={enviando}
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) void enviar(arquivo);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {itens.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {itens.map((n) => (
            <li key={n.id} className="flex flex-wrap items-baseline gap-2 text-corpo">
              <a href={n.url} target="_blank" rel="noreferrer" className="text-ceara-azul hover:underline">
                {n.nome}
              </a>
              <span className="text-legenda text-ceara-texto2">
                {Math.round(n.tamanho / 1024)} KB · {n.enviadoPor} ·{' '}
                {new Date(n.enviadoEm).toLocaleDateString('pt-BR')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-legenda italic text-ceara-texto2">
          Nenhum arquivo anexado. Guarde aqui o PDF, o XML ou a foto da nota — quem for conferir o pagamento ou
          auditar meses adiante precisa do documento, e nao so do numero.
        </p>
      )}
    </div>
  );
}

/** Conteudo do arquivo em base64, sem o prefixo `data:` que o FileReader acrescenta. */
function paraBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(',')[1] ?? '');
    leitor.onerror = () => reject(new Error('Nao foi possivel ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

function LancarEntradaFiscal({
  recebimentoId,
  documento,
  ehServico,
  nfNumeroAtual,
  aoErrar,
  aoAtualizar,
}: {
  recebimentoId: string;
  documento: string;
  ehServico: boolean;
  nfNumeroAtual: string | null;
  aoErrar: (e: string | null) => void;
  aoAtualizar: () => void;
}) {
  const [nfNumero, setNfNumero] = useState(nfNumeroAtual ?? '');
  const [nfChave, setNfChave] = useState('');
  const [vencimento, setVencimento] = useState('');

  const lancar = useMutation({
    mutationFn: () =>
      post(`/compras/recebimentos/${recebimentoId}/entrada-fiscal`, {
        nfNumero: nfNumero.trim(),
        // NFS-e nao tem chave; mandar string vazia seria mandar um campo que o servidor recusa
        nfChave: ehServico ? null : nfChave.trim() || null,
        vencimento,
      }),
    onSuccess: () => {
      aoErrar(null);
      aoAtualizar();
    },
    onError: (falha) => aoErrar(falha instanceof ApiError ? falha.erro.mensagem : 'Falha ao lancar a entrada fiscal.'),
  });

  const pronto = nfNumero.trim().length > 0 && vencimento !== '';

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Campo rotulo={`Numero da ${documento}`} htmlFor={`nf-${recebimentoId}`} obrigatorio>
        <input
          id={`nf-${recebimentoId}`}
          className={classeControle()}
          value={nfNumero}
          onChange={(e) => setNfNumero(e.target.value)}
        />
      </Campo>

      {ehServico ? (
        <Campo rotulo="Chave de acesso" htmlFor={`chave-${recebimentoId}`} ajuda="NFS-e e municipal e nao tem chave.">
          <input id={`chave-${recebimentoId}`} className={classeControle()} value="—" disabled />
        </Campo>
      ) : (
        <Campo
          rotulo="Chave da NF-e"
          htmlFor={`chave-${recebimentoId}`}
          ajuda="44 digitos. O CNPJ do emitente e conferido contra o fornecedor do pedido."
        >
          <input
            id={`chave-${recebimentoId}`}
            inputMode="numeric"
            maxLength={44}
            className={classeControle()}
            value={nfChave}
            onChange={(e) => setNfChave(e.target.value.replace(/\D/g, ''))}
          />
        </Campo>
      )}

      <Campo rotulo="Vencimento do titulo" htmlFor={`venc-${recebimentoId}`} obrigatorio>
        <input
          id={`venc-${recebimentoId}`}
          type="date"
          className={classeControle()}
          value={vencimento}
          onChange={(e) => setVencimento(e.target.value)}
        />
      </Campo>

      <div className="flex items-end justify-end">
        <Button disabled={!pronto} carregando={lancar.isPending} onClick={() => lancar.mutate()}>
          Lancar entrada fiscal
        </Button>
      </div>
    </div>
  );
}
