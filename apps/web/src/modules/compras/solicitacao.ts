/** Tipos e rotulos das telas de solicitacao de compra (secao 6.1.3). */

export type StatusSolicitacao =
  | 'RASCUNHO'
  | 'ABERTA'
  | 'EM_TRIAGEM'
  | 'DEVOLVIDA'
  | 'EM_LOTE'
  | 'ATENDIDA'
  | 'CANCELADA';

export type Criticidade = 'P1' | 'P2' | 'P3' | 'P4';

export interface ItemDaSolicitacao {
  id: string;
  itemId: string | null;
  descricaoLivre: string | null;
  quantidade: string;
  unidadeMedida: string;
  observacao: string | null;
  item?: { codigo: string; descricao: string } | null;
}

export interface Solicitacao {
  id: string;
  numero: string;
  tipo: TipoDemanda;
  criticidade: Criticidade;
  origemDemanda: string;
  dataLimite: string;
  status: StatusSolicitacao;
  loteId: string | null;
  motivoDevolucao: string | null;
  motivoCancelamento: string | null;
  createdAt: string;
  itens: ItemDaSolicitacao[];
  centroCusto: { codigo: string; nome: string };
  solicitante?: { nome: string };
}

export interface ItemCatalogo {
  id: string;
  codigo: string;
  descricao: string;
  unidadeMedida: string;
  statusHomologacao: 'EM_ANALISE' | 'HOMOLOGADO' | 'REPROVADO';
  critico: boolean;
}

export interface CentroCusto {
  id: string;
  codigo: string;
  nome: string;
  unidadeId: string;
  rotulo: string;
}

export const ROTULO_STATUS: Record<StatusSolicitacao, string> = {
  RASCUNHO: 'Rascunho',
  ABERTA: 'Aberta',
  EM_TRIAGEM: 'Em triagem',
  DEVOLVIDA: 'Devolvida',
  EM_LOTE: 'Em cotacao',
  ATENDIDA: 'Atendida',
  CANCELADA: 'Cancelada',
};

export const TOM_STATUS: Record<StatusSolicitacao, 'azul' | 'ouro' | 'verde' | 'vermelho' | 'neutro'> = {
  RASCUNHO: 'neutro',
  ABERTA: 'azul',
  EM_TRIAGEM: 'azul',
  DEVOLVIDA: 'ouro',
  EM_LOTE: 'azul',
  ATENDIDA: 'verde',
  CANCELADA: 'neutro',
};

/**
 * Criticidade define o SLA e nao e escolha de humor (secao 6.5). O rotulo diz
 * a situacao que justifica cada nivel, para o solicitante nao marcar tudo como P1.
 */
export const CRITICIDADES: Array<{ valor: Criticidade; rotulo: string; sla: string }> = [
  { valor: 'P1', rotulo: 'P1 · Parada de operacao', sla: '4h uteis · exige regularizacao em 24h' },
  { valor: 'P2', rotulo: 'P2 · Risco iminente', sla: '24h uteis · minimo 2 propostas' },
  { valor: 'P3', rotulo: 'P3 · Programada', sla: '5 dias uteis · 3 propostas' },
  { valor: 'P4', rotulo: 'P4 · Reposicao ou projeto', sla: '10 dias uteis · 3 propostas' },
];

export const COR_CRITICIDADE: Record<Criticidade, string> = {
  P1: 'bg-ceara-vermelho',
  P2: 'bg-ceara-ouro',
  P3: 'bg-ceara-azul',
  P4: 'bg-ceara-texto2',
};

export const dataBr = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR');

export const quantidadeBr = (valor: string): string =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(Number(valor));

/** Descricao do item, venha ele do catalogo ou da descricao livre. */
export const descricaoDoItem = (item: ItemDaSolicitacao): string =>
  item.item ? `${item.item.codigo} · ${item.item.descricao}` : (item.descricaoLivre ?? 'Sem descricao');

/** Data-limite minima aceitavel no formulario: hoje. */
export const hojeIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * O que se esta pedindo (secao 6.1.1).
 *
 * Nao e rotulo: material entra no estoque e fecha com NF-e, que tem chave de 44 digitos
 * conferida contra o CNPJ do emitente; servico nao entra no estoque e fecha com NFS-e
 * municipal, que nao tem chave nenhuma.
 */
export type TipoDemanda = 'MATERIAL' | 'SERVICO';

export const ROTULO_TIPO: Record<TipoDemanda, string> = {
  MATERIAL: 'Material',
  SERVICO: 'Servico',
};

/** Documento fiscal que fecha cada tipo — o mesmo par que o servidor valida. */
export const DOCUMENTO_DO_TIPO: Record<TipoDemanda, string> = {
  MATERIAL: 'NF-e',
  SERVICO: 'NFS-e',
};
