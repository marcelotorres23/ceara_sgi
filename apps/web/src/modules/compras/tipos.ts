export type StatusLote =
  | 'RASCUNHO' | 'TRIAGEM' | 'EM_COTACAO' | 'MAPA_PRONTO' | 'AGUARDANDO_APROVACAO' | 'APROVADO'
  | 'PEDIDO_EMITIDO' | 'AGUARDANDO_ENTREGA' | 'RECEBIDO_PARCIAL' | 'RECEBIDO' | 'NF_LANCADA'
  | 'ENCERRADO' | 'DEVOLVIDO_AO_SOLICITANTE' | 'EM_RENEGOCIACAO' | 'REPROVADO' | 'CANCELADO'
  | 'BLOQUEADO_DIVERGENCIA';

export type Criticidade = 'P1' | 'P2' | 'P3' | 'P4';
export type Swimlane = 'CRITICIDADE' | 'COMPRADOR' | 'CENTRO_CUSTO';

export interface ConsumoSla {
  percentual: number;
  vencido: boolean;
  horasRestantes: number;
  rotulo: string;
}

export interface CardKanban {
  id: string;
  numero: string;
  status: StatusLote;
  criticidade: Criticidade;
  valor: string | null;
  quantidadeItens: number;
  solicitante: string;
  centroCusto: string;
  compradorId: string;
  compradorNome: string;
  fornecedor: string | null;
  aprovador: string | null;
  anexos: number;
  notas: number;
  bloqueado: boolean;
  abertoEm: string;
  slaVenceEm: string | null;
  sla: ConsumoSla;
  aging: { dias: number; exibir: boolean; critico: boolean };
  cor: 'vermelho' | 'ouro' | 'azul' | 'cinza';
}

export interface ColunaKanban {
  status: StatusLote;
  rotulo: string;
  total: number;
  valor: string;
  cards: CardKanban[];
}

export interface KpisPainel {
  lotesEmAberto: number;
  valorEmNegociacao: string;
  percentualDentroDoSla: number;
  agingAcimaDe10Dias: number;
  savingsDoMes: string;
  pedidosSemNotaFiscal: number;
}

export interface PainelKanban {
  colunas: ColunaKanban[];
  raias: Array<{ chave: string; rotulo: string; totalLotes: number }> | null;
  kpis: KpisPainel;
  swimlane: Swimlane | null;
}

/** Formatacao pt-BR acontece so na apresentacao (secao 13). */
export const moeda = (valor: string | number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor));

/**
 * Valor ainda nao apurado (lote antes do mapa de cotacao) nao e zero - e desconhecido.
 * Exibir R$ 0,00 faria o comprador ler como "lote sem custo".
 */
export const moedaOuTraco = (valor: string | number | null): string => (valor === null ? '—' : moeda(valor));

export const numero = (valor: number): string => new Intl.NumberFormat('pt-BR').format(valor);
