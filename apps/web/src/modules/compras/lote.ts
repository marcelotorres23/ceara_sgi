import type { StatusLote } from './tipos';
import type { Criticidade } from './solicitacao';

/** Tipos da tela de detalhe do lote: cotacao, mapa, aprovacao e pedido. */

export interface ItemDaSolicitacaoNoLote {
  id: string;
  itemId: string | null;
  descricaoLivre: string | null;
  quantidade: string;
  unidadeMedida: string;
}

export interface SolicitacaoNoLote {
  id: string;
  numero: string;
  criticidade: Criticidade;
  origemDemanda: string;
  itens: ItemDaSolicitacaoNoLote[];
}

export interface ItemDaCotacao {
  id: string;
  solicitacaoItemId: string;
  precoUnitario: string;
  quantidade: string;
  marcaOfertada: string | null;
}

export interface Cotacao {
  id: string;
  fornecedorId: string;
  fornecedor: { razaoSocial: string };
  enviadaEm: string;
  respondidaEm: string | null;
  recusada: boolean;
  motivoRecusa: string | null;
  condicaoPagamento: string | null;
  prazoDias: number | null;
  descontoAvista: string | null;
  freteTipo: 'CIF' | 'FOB' | null;
  freteValor: string | null;
  prazoEntregaDias: number | null;
  valorTotal: string | null;
  valorPresente: string | null;
  itens: ItemDaCotacao[];
}

export interface MapaDeCotacao {
  id: string;
  cotacaoRecomendadaId: string | null;
  geradoEm: string;
  divergenteMenorPreco: boolean;
  justificativa: string | null;
}

export interface Aprovacao {
  id: string;
  nivel: number;
  decisao: 'APROVADO' | 'APROVADO_COM_RESSALVA' | 'DEVOLVIDO' | 'REPROVADO';
  ressalva: string | null;
  motivo: string | null;
  decididoEm: string;
  aprovador: { nome: string };
}

export interface PedidoDoLote {
  id: string;
  numero: string;
  valorTotal: string;
  dataPrometida: string;
  dataReprogramada: string | null;
  status: string;
  recebimentos: RecebimentoDoLote[];
}

/** Conferencia fisica de um pedido, e o que dela decorre na etapa fiscal (secao 6.1.11). */
export interface RecebimentoDoLote {
  id: string;
  recebidoEm: string;
  status: string;
  threeWayOk: boolean;
  nfNumero: string | null;
  nfChave: string | null;
  /** quando a entrada fiscal foi lancada; null enquanto a nota nao entrou */
  fiscalEm: string | null;
  almoxarife: { nome: string };
  titulos: Array<{ id: string; valor: string; valorRetido: string; vencimento: string; status: string }>;
}

/** Arquivo da nota anexado ao recebimento. */
export interface NotaAnexada {
  id: string;
  nome: string;
  mime: string;
  tamanho: number;
  enviadoPor: string;
  enviadoEm: string;
  url: string;
}

export interface LoteDetalhado {
  id: string;
  numero: string;
  status: StatusLote;
  /** material ou servico: define o documento fiscal do fechamento (secao 6.1.11) */
  tipo: 'MATERIAL' | 'SERVICO';
  criticidade: Criticidade;
  valorEstimado: string | null;
  valorFechado: string | null;
  savings: string | null;
  nivelAlcada: number | null;
  slaVenceEm: string | null;
  aprovadoEm: string | null;
  comprador: { nome: string };
  solicitacoes: SolicitacaoNoLote[];
  cotacoes: Cotacao[];
  mapas: MapaDeCotacao[];
  aprovacoes: Aprovacao[];
  pedidos: PedidoDoLote[];
  transicoesPossiveis: StatusLote[];
  /** quantas evidencias cada cotacao tem, por id - evita uma chamada por linha */
  evidenciasPorCotacao: Record<string, number>;
  aprovacaoDisponivel: AprovacaoDisponivel;
}

/**
 * Se o botao de aprovar fica ativo, e por que nao (secao 6.4).
 *
 * Vem pronto do servidor porque depende de tres coisas que a tela nao tem: a permissao, a
 * faixa em que o valor caiu e a segregacao de funcoes. Calcular no navegador seria manter
 * uma segunda copia da matriz de alcadas, que sai de sincronia no dia em que ela mudar.
 */
export interface AprovacaoDisponivel {
  /** o lote esta na etapa em que a decisao cabe */
  aplicavel: boolean;
  /** valor que enquadrou a faixa: o fechado do mapa, ou o estimado enquanto nao ha mapa */
  valor: string | null;
  nivel: number | null;
  /** perfil que a matriz designa para esta faixa */
  perfilExigido: string | null;
  /** maior faixa que os perfis de quem esta olhando alcancam */
  nivelMaximo: number | null;
  pode: boolean;
  motivo: string | null;
}

export interface Fornecedor {
  id: string;
  razaoSocial: string;
  cnpj: string;
  status: 'EM_ANALISE' | 'HOMOLOGADO' | 'BLOQUEADO';
}

/** Linha do ranking devolvida ao gerar o mapa (secao 6.1.6). */
export interface LinhaDoRanking {
  cotacaoId: string;
  fornecedor: string;
  valorLiquido: string;
  prazoDias: number;
  valorPresente: string;
  posicao: number;
  diferencaPercentual: string;
}

export interface RespostaDoMapa {
  mapa: MapaDeCotacao;
  divergenteMenorPreco: boolean;
  savings: string;
  ranking: LinhaDoRanking[];
}

export interface SavingsDoComprador {
  compradorId: string;
  comprador: string;
  lotes: number;
  lotesComparaveis: number;
  valorNegociado: string;
  savings: string;
  percentual: number | null;
  dentroDaMeta: boolean | null;
}

export interface PainelDeSavings {
  competencia: string;
  itens: SavingsDoComprador[];
  total: {
    lotes: number;
    lotesComparaveis: number;
    valorNegociado: string;
    savings: string;
    percentual: number | null;
    meta: number;
  };
  memoriaDeCalculo: Record<string, string>;
}

/** Todos os itens do lote, achatados das solicitacoes - e sobre eles que se cota. */
export const itensDoLote = (lote: LoteDetalhado): Array<ItemDaSolicitacaoNoLote & { solicitacao: string }> =>
  lote.solicitacoes.flatMap((s) => s.itens.map((i) => ({ ...i, solicitacao: s.numero })));

export const descricaoDoItemDoLote = (item: ItemDaSolicitacaoNoLote): string =>
  item.descricaoLivre ?? item.itemId ?? 'Item sem descricao';

export const respondidas = (lote: LoteDetalhado): Cotacao[] =>
  lote.cotacoes.filter((c) => c.respondidaEm && !c.recusada);

/**
 * Propostas minimas por faixa de valor (secao 6.4). E espelho da regra do servidor,
 * usado so para avisar antes de o comprador tentar - a decisao continua sendo dele.
 */
export function propostasMinimas(valor: number): number {
  if (valor <= 1000) return 2;
  return 3;
}

export const percentualBr = (valor: number | null, casas = 1): string =>
  valor === null
    ? 'sem base'
    : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(valor * 100)}%`;
