import type { Criticidade, StatusLote } from './tipos';

/** Centro de custo onerado pelo lote. No desenho da frota, uma placa = um centro (secao 5.4). */
export interface CentroDoLote {
  id: string;
  codigo: string;
  nome: string;
  placas: string[];
  valorAtribuido: string;
  /** true quando o valor veio de rateio de lote misto, nao de gasto exclusivo do centro */
  rateado: boolean;
}

export interface LoteNaFila {
  id: string;
  numero: string;
  criticidade: Criticidade;
  valorEstimado: string | null;
  nivelAlcada: number | null;
  comprador: { id: string; nome: string };
  solicitantesIds: string[];
  solicitacoes: Array<{ id: string; numero: string; itens: number }>;
  cotacoes: number;
  centros: CentroDoLote[];
  divergenteMenorPreco: boolean;
  justificativa: string | null;
  submetidoEm: string | null;
  slaHoras: number | null;
  prazoLimite: string | null;
  horasRestantes: number | null;
  atrasado: boolean;
}

export interface CompraDoCentro {
  loteId: string;
  loteNumero: string;
  loteStatus: StatusLote;
  pedidoId: string | null;
  pedidoNumero: string | null;
  fornecedor: string | null;
  data: string;
  valorCentro: string;
  valorTotalLote: string;
  rateado: boolean;
  /** false enquanto o lote nao tem valor apurado: a tela mostra traco, nao R$ 0,00 */
  valorApurado: boolean;
  situacao: 'PEDIDO' | 'EM_ANDAMENTO';
  itens: Array<{ descricao: string; quantidade: string; precoUnitario: string }>;
}

export interface HistoricoDoCentro {
  centro: {
    id: string;
    codigo: string;
    nome: string;
    orcamentoMensal: string | null;
    responsavel: { id: string; nome: string } | null;
    veiculos: Array<{
      id: string;
      placa: string;
      frotaNumero: string | null;
      marca: string | null;
      modelo: string | null;
      status: string;
    }>;
  };
  janela: { meses: number; desde: string };
  resumo: {
    totalPedido: string;
    totalEmAndamento: string;
    pedidos: number;
    solicitacoes: number;
    ticketMedio: string;
    gastoDoMes: string;
    percentualDoOrcamento: number | null;
    estourouOrcamento: boolean;
  };
  porMes: Array<{ mes: string; valor: string; pedidos: number }>;
  itensRecorrentes: Array<{ descricao: string; quantidade: string; valor: string; vezes: number }>;
  compras: CompraDoCentro[];
  memoriaDeCalculo: Record<string, string>;
}

export type Decisao = 'APROVADO' | 'APROVADO_COM_RESSALVA' | 'DEVOLVIDO' | 'REPROVADO';

/** Competencia AAAA-MM vira "mar/26", que e como o aprovador le a serie. */
export function mesBr(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, 1));
  return data.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/**
 * SLA em horas uteis, ja assinado pelo servidor: negativo e atraso.
 * O texto e explicito no atraso porque a alcada tem prazo proprio (secao 6.4).
 */
export function prazoBr(horasRestantes: number | null): string {
  if (horasRestantes === null) return 'sem prazo apurado';
  const horas = Math.abs(Math.round(horasRestantes));
  if (horasRestantes < 0) return `atrasado ha ${horas}h uteis`;
  return `${horas}h uteis restantes`;
}

export const percentualBr = (v: number | null): string =>
  v === null ? '—' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v * 100)}%`;
