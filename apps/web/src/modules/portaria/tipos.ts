export type TipoAcesso = 'PESSOA' | 'VEICULO_EXTERNO' | 'VEICULO_PROPRIO';
export type StatusAcesso = 'AGENDADO' | 'NO_PATIO' | 'EM_TRANSITO' | 'ENCERRADO' | 'CANCELADO' | 'RECUSADO';
export type TipoPessoaExterna = 'VISITANTE' | 'MOTORISTA_EXTERNO' | 'CLIENTE' | 'FORNECEDOR' | 'PRESTADOR';
export type Gravidade = 'BAIXA' | 'MEDIA' | 'ALTA';
export type EstadoPermanencia = 'NORMAL' | 'ATENCAO' | 'EXCEDIDA';

export interface PontoAcesso {
  id: string;
  codigo: string;
  nome: string;
}

export interface PessoaExterna {
  id: string;
  nome: string;
  documento: string;
  tipo: TipoPessoaExterna;
  empresa: string | null;
  telefone: string | null;
  cnhNumero: string | null;
  cnhVencimento: string | null;
  bloqueado: boolean;
  motivoBloqueio: string | null;
}

export interface ItemDoPatio {
  id: string;
  tipo: TipoAcesso;
  status: StatusAcesso;
  quem: string;
  documento: string | null;
  tipoPessoa: TipoPessoaExterna | null;
  empresa: string | null;
  placa: string | null;
  frotaNumero: string | null;
  ponto: PontoAcesso;
  destino: string | null;
  responsavel: { id: string; nome: string } | null;
  motivo: string;
  cracha: string | null;
  previstoPara: string | null;
  abertoEm: string | null;
  minutos: number | null;
  permanencia: EstadoPermanencia;
  percentualDoLimite: number | null;
}

export interface Patio {
  limitePermanenciaHoras: number;
  resumo: {
    pessoasNoPatio: number;
    veiculosNoPatio: number;
    caminhoesEmTransito: number;
    agendadosPendentes: number;
    permanenciaExcedida: number;
  };
  itens: ItemDoPatio[];
}

export interface AcessoNaLista {
  id: string;
  tipo: TipoAcesso;
  status: StatusAcesso;
  motivo: string;
  destino: string | null;
  placaExterna: string | null;
  transportadora: string | null;
  cracha: string | null;
  entradaEm: string | null;
  saidaEm: string | null;
  permanenciaMinutos: number | null;
  kmViagem: string | null;
  pessoaExterna: {
    id: string;
    nome: string;
    tipo: TipoPessoaExterna;
    empresa: string | null;
  } | null;
  veiculo: { id: string; placa: string; frotaNumero: string | null } | null;
  motorista: { id: string; nome: string } | null;
  rota: { id: string; codigo: string; nome: string } | null;
  pontoAcesso: PontoAcesso;
}

export interface OcorrenciaPortaria {
  id: string;
  gravidade: Gravidade;
  descricao: string;
  ocorridoEm: string;
  pontoAcesso: { codigo: string; nome: string } | null;
  acesso: {
    id: string;
    motivo: string;
    pessoaExterna: { nome: string } | null;
  } | null;
}

export interface RotaDaGuarita {
  id: string;
  codigo: string;
  nome: string;
  fechamento: string | null;
  largada: string | null;
}

export interface FrotaDaGuarita {
  veiculos: Array<{
    id: string;
    placa: string;
    frotaNumero: string | null;
    hodometroAtual: string;
  }>;
  motoristas: Array<{ id: string; nome: string; cnhVencimento: string; telefone: string | null }>;
  rotas: RotaDaGuarita[];
}

export const ROTULO_TIPO_ACESSO: Record<TipoAcesso, string> = {
  PESSOA: 'Pessoa a pe',
  VEICULO_EXTERNO: 'Veiculo de terceiro',
  VEICULO_PROPRIO: 'Caminhao da frota',
};

export const ROTULO_TIPO_PESSOA: Record<TipoPessoaExterna, string> = {
  VISITANTE: 'Visitante',
  MOTORISTA_EXTERNO: 'Motorista externo',
  CLIENTE: 'Cliente',
  FORNECEDOR: 'Fornecedor',
  PRESTADOR: 'Prestador',
};

export const ROTULO_STATUS: Record<StatusAcesso, string> = {
  AGENDADO: 'agendado',
  NO_PATIO: 'no patio',
  EM_TRANSITO: 'em transito',
  ENCERRADO: 'encerrado',
  CANCELADO: 'cancelado',
  RECUSADO: 'recusado',
};

/** Duracao em h/min: "3h12" diz mais que "192 minutos" para quem opera a guarita. */
export function duracaoBr(minutos: number | null): string {
  if (minutos === null) return '—';
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
}

export const horaBr = (iso: string | null): string =>
  iso === null
    ? '—'
    : new Date(iso).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      });

/** Uma linha do relatorio de movimento de veiculos (secao 14.5). */
export interface LinhaDoRelatorio {
  id: string;
  tipo: TipoAcesso;
  status: StatusAcesso;
  placa: string | null;
  frotaNumero: string | null;
  rota: string | null;
  rotaCodigo: string | null;
  motorista: string | null;
  ponto: string;
  inicioEm: string | null;
  fimEm: string | null;
  registradoEm: string;
  permanenciaMinutos: number | null;
  kmViagem: string | null;
  motivo: string;
  destino: string | null;
  emAberto: boolean;
}

export interface RelatorioDeMovimentos {
  periodo: { de: string; ate: string };
  unidades: string[] | 'TODAS';
  limitePermanenciaHoras: number;
  truncado: boolean;
  tetoDeLinhas: number;
  totais: {
    movimentos: number;
    encerrados: number;
    emAberto: number;
    saidasDaFrota: number;
    entradasDeTerceiros: number;
    permanenciaMediaMinutos: number | null;
    kmTotal: string | null;
    veiculosDistintos: number;
    rotasDistintas: number;
  };
  linhas: LinhaDoRelatorio[];
  memoriaDeCalculo: Record<string, string>;
}

export const dataHoraBr = (iso: string | null): string =>
  iso === null
    ? '—'
    : new Date(iso).toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      });

/** Ficha de largada emitida no registro da saida do caminhao (secao 14.7). */
export type SituacaoDoEnvio = 'ENTREGUE' | 'NA_FILA' | 'CANAL_NAO_CONFIGURADO';

export interface EnvioDaFicha {
  mensagemId: string;
  anexoId: string;
  situacao: SituacaoDoEnvio;
  telefone: string;
  detalhe: string | null;
}

export interface FichaLargadaEmitida {
  anexoId: string | null;
  nome: string | null;
  envio: EnvioDaFicha | null;
  /** o que impediu a emissao ou o envio; a ficha continua reemitivel pelo botao */
  avisos: string[];
}

/** Resposta do registro de acesso: alertas do hodometro e a ficha da largada. */
export interface AcessoRegistrado {
  id: string;
  tipo: TipoAcesso;
  alertasHodometro?: Array<{ mensagem: string }>;
  fichaLargada?: FichaLargadaEmitida | null;
}

export const RECADO_DO_ENVIO: Record<SituacaoDoEnvio, string> = {
  ENTREGUE: 'Ficha entregue no WhatsApp de',
  NA_FILA: 'Ficha na fila de envio para',
  CANAL_NAO_CONFIGURADO: 'WhatsApp nao configurado; a ficha aguarda na fila para',
};
