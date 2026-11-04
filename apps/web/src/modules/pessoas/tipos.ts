/** Tipos das telas de pessoas (F8). */

export type StatusOcorrencia =
  | 'SUGERIDA'
  | 'VALIDADA'
  | 'CONTESTADA'
  | 'MANTIDA'
  | 'REVERTIDA'
  | 'DESCARTADA';

export interface Criterio {
  id: string;
  codigo: string;
  tipo: 'POSITIVO' | 'NEGATIVO';
  descricao: string;
  peso: number;
  automatico: boolean;
}

export interface OcorrenciaNaFicha {
  id: string;
  criterio: string;
  codigo: string;
  tipo: 'POSITIVO' | 'NEGATIVO';
  pontos: number;
  descricao: string;
  status: StatusOcorrencia;
  lancadoEm: string;
  contestarAte: string | null;
  contestacaoTexto: string | null;
  decisao: string | null;
}

export interface Extrato {
  competencia: string;
  pontosBase: number;
  pontosPositivos: number;
  pontosNegativos: number;
  pontosFinal: number;
  ocorrenciasConsideradas: number;
  ocorrenciasIgnoradas: number;
  porCriterio: Array<{ codigo: string; descricao: string; tipo: 'POSITIVO' | 'NEGATIVO'; ocorrencias: number; pontos: number }>;
}

export interface FichaColaborador {
  colaborador: { id: string; nome: string; cargo: string; setor: string; unidadeId: string; fotoUrl?: string | null };
  extrato: Extrato;
  fechado: boolean;
  ocorrencias: OcorrenciaNaFicha[];
  historico: Array<{ competencia: string; pontosFinal: number; fechadoEm: string | null }>;
}

export interface Colaborador {
  id: string;
  matricula: string;
  nome: string;
  cargo: string;
  setor: string;
  status: 'ATIVO' | 'AFASTADO' | 'DESLIGADO';
  unidade: { codigo: string };
  gestor: { nome: string } | null;
}

export interface PainelSetor {
  competencia: string;
  visibilidade: 'PUBLICO' | 'APENAS_GESTOR' | 'ANONIMIZADO';
  painel: {
    colaboradores: number;
    media: number | null;
    mediana: number | null;
    abaixoDaBase: number;
    distribuicao: Array<{ faixa: string; colaboradores: number }>;
  };
  ranking: Array<{
    colaboradorId: string;
    nome: string;
    setor: string;
    cargo?: string;
    fotoUrl?: string | null;
    pontosFinal: number;
    pontosPositivos?: number;
    pontosNegativos?: number;
  }> | null;
  aviso: string;
}

export const ROTULO_STATUS: Record<StatusOcorrencia, string> = {
  SUGERIDA: 'Sugerida pelo sistema',
  VALIDADA: 'Validada',
  CONTESTADA: 'Em contestacao',
  MANTIDA: 'Mantida',
  REVERTIDA: 'Revertida',
  DESCARTADA: 'Descartada',
};

/** Verde quando soma, vermelho quando subtrai, cinza quando nao conta pontos. */
export const tomDoStatus = (status: StatusOcorrencia, pontos: number): 'verde' | 'vermelho' | 'ouro' | 'neutro' => {
  if (status === 'SUGERIDA') return 'ouro';
  if (status === 'REVERTIDA' || status === 'DESCARTADA') return 'neutro';
  return pontos >= 0 ? 'verde' : 'vermelho';
};

export const comSinal = (pontos: number): string => (pontos > 0 ? `+${pontos}` : String(pontos));

export const competenciaAtual = (): string => new Date().toISOString().slice(0, 7);

/** Anda de mes em mes na competencia 'AAAA-MM', virando o ano quando precisa. */
export const deslocarCompetencia = (competencia: string, meses: number): string => {
  const [ano, mes] = competencia.split('-').map(Number);
  if (!ano || !mes) return competencia;
  const d = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  return d.toISOString().slice(0, 7);
};

export const competenciaLegivel = (competencia: string): string => {
  const [ano, mes] = competencia.split('-');
  const nomes = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${nomes[Number(mes) - 1] ?? mes} de ${ano}`;
};
