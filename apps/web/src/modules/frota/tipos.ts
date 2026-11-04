/** Tipos compartilhados das telas de pneus e manutencao (F7). */

export type EstadoSulco = 'VERDE' | 'DOURADO' | 'VERMELHO';

export type AlertaPneu =
  | 'SULCO_ABAIXO_DO_LEGAL'
  | 'SULCO_EM_ATENCAO'
  | 'ACIMA_DA_VIDA_UTIL'
  | 'CANDIDATO_A_RODIZIO';

export interface AvaliacaoPneu {
  numeroFogo: string;
  estado: EstadoSulco;
  cpk: string | null;
  consumoVidaUtil: number | null;
  alertas: AlertaPneu[];
  bloqueiaCirculacao: boolean;
}

export interface PosicaoDoMapa {
  posicao: { id: string; codigo: string; eixo: number; lado: string; ordem: number };
  pneu: {
    id: string;
    numeroFogo: string;
    marca: string;
    modelo: string;
    medida: string;
    tipo: 'NOVO' | 'RECAPADO';
    recapagens: number;
    sulcoAtualMm: string | null;
    kmAcumulado: string;
    kmNaPosicao: string | null;
    cpk: string | null;
  } | null;
  avaliacao: AvaliacaoPneu | null;
  estado: EstadoSulco | 'VAZIA';
}

export interface MapaDeRodagem {
  veiculo: {
    id: string;
    placa: string;
    frotaNumero: string;
    configEixos: string | null;
    hodometroAtual: string;
    unidade: { codigo: string; nome: string };
  };
  faixas: { verde: number; amarelo: number; legalMm: number };
  posicoes: PosicaoDoMapa[];
  resumo: { total: number; ocupadas: number; criticas: number; emAtencao: number };
}

export interface PlanoNoPainel {
  planoId: string;
  veiculoId: string;
  placa: string;
  frotaNumero: string;
  unidadeId: string;
  descricao: string;
  situacao: 'EM_DIA' | 'EM_ALERTA' | 'VENCIDO';
  proximoValor: string | null;
  proximoEm: string | null;
  faltam: number;
  unidade: 'km' | 'horas' | 'dias';
  mensagem: string;
}

export interface OrdemServico {
  id: string;
  numero: string;
  veiculoId: string;
  tipo: 'PREVENTIVA' | 'CORRETIVA';
  origem: string;
  descricao: string;
  oficina: string | null;
  abertaEm: string;
  fechadaEm: string | null;
  custoPecas: string;
  custoMaoObra: string;
  custoTotal: string;
  tempoParadoHoras: string | null;
  status: 'ABERTA' | 'EM_EXECUCAO' | 'AGUARDANDO_PECA' | 'CONCLUIDA' | 'CANCELADA';
  veiculo: { placa: string; frotaNumero: string };
  itens: Array<{ id: string; descricao: string; quantidade: string; custo: string; maoDeObra: boolean }>;
}

export type TipoConclusaoOs = 'TOTAL' | 'PARCIAL';

/** Listas de apoio do formulario de OS, servidas pela propria rota de manutencao. */
export interface ApoioDaOs {
  veiculos: Array<{
    id: string;
    placa: string;
    frotaNumero: string | null;
    hodometroAtual: string;
    horimetroAtual: string | null;
  }>;
  itens: Array<{ id: string; codigo: string; descricao: string; unidadeMedida: string }>;
  almoxarifados: Array<{ id: string; codigo: string; nome: string }>;
}

/** OS com tudo que a folha impressa e o fechamento precisam. */
export interface OrdemServicoDetalhada extends OrdemServico {
  origem: string;
  terceiro: boolean;
  iniciadaEm: string | null;
  hodometro: string | null;
  horimetro: string | null;
  conclusaoTipo: TipoConclusaoOs | null;
  anotacoesMecanico: string | null;
  mecanico: string | null;
  pendencia: string | null;
  unidade: { codigo: string; nome: string; cidade: string | null; uf: string | null };
  veiculo: {
    placa: string;
    frotaNumero: string;
    marca: string | null;
    modelo: string | null;
    ano: number | null;
    hodometroAtual: string;
  };
  plano: { descricao: string; gatilhoTipo: 'KM' | 'HORAS' | 'DIAS'; gatilhoValor: string } | null;
  osRetorno: { id: string; numero: string; status: string } | null;
  osOrigem: { id: string; numero: string } | null;
}

export interface UnidadeFiltro {
  id: string;
  codigo: string;
  nome: string;
}

/** Numero em pt-BR - formatacao so na apresentacao (secao 13). */
export const decimal = (valor: string | number | null, casas = 1): string =>
  valor === null || valor === ''
    ? '—'
    : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(Number(valor));

/** CPK tem 4 casas na tela: a quinta nao muda decisao de compra. */
export const cpkFormatado = (valor: string | null): string =>
  valor === null ? 'sem base' : `R$ ${decimal(valor, 4)}/km`;

export const ROTULO_ALERTA: Record<AlertaPneu, string> = {
  SULCO_ABAIXO_DO_LEGAL: 'Sulco abaixo do limite legal',
  SULCO_EM_ATENCAO: 'Sulco em atencao',
  ACIMA_DA_VIDA_UTIL: 'Acima da vida util',
  CANDIDATO_A_RODIZIO: 'Candidato a rodizio',
};
