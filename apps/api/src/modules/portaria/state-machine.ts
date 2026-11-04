import { InvalidTransitionError } from '../../core/errors/index.js';

/**
 * Maquina de estados do acesso de portaria (secao 14.2).
 *
 * Dois fluxos convivem na mesma tabela porque o portao e o mesmo:
 * - quem vem de fora entra e depois sai:      (AGENDADO) -> NO_PATIO -> ENCERRADO
 * - o caminhao da casa comeca dentro:                      EM_TRANSITO -> ENCERRADO
 *
 * Modulo puro - a persistencia da transicao fica no service.
 */

export type StatusAcesso = 'AGENDADO' | 'NO_PATIO' | 'EM_TRANSITO' | 'ENCERRADO' | 'CANCELADO' | 'RECUSADO';

export type TipoAcesso = 'PESSOA' | 'VEICULO_EXTERNO' | 'VEICULO_PROPRIO';

const TRANSICOES: Record<StatusAcesso, StatusAcesso[]> = {
  AGENDADO: ['NO_PATIO', 'CANCELADO', 'RECUSADO'],
  NO_PATIO: ['ENCERRADO'],
  EM_TRANSITO: ['ENCERRADO'],
  // registro fechado nao reabre: quem voltou de novo gera outro acesso, com outro horario
  ENCERRADO: [],
  CANCELADO: [],
  RECUSADO: [],
};

/** Recusa e cancelamento sem motivo viram "porque sim" no relatorio de seguranca. */
const EXIGEM_MOTIVO = new Set<StatusAcesso>(['CANCELADO', 'RECUSADO']);

export const ESTADOS_ABERTOS = new Set<StatusAcesso>(['AGENDADO', 'NO_PATIO', 'EM_TRANSITO']);

export const ESTADOS_FINAIS = new Set<StatusAcesso>(['ENCERRADO', 'CANCELADO', 'RECUSADO']);

/** Estado em que o acesso nasce, conforme o que passa pelo portao. */
export function statusInicial(tipo: TipoAcesso, agendado: boolean): StatusAcesso {
  if (agendado) return 'AGENDADO';
  return tipo === 'VEICULO_PROPRIO' ? 'EM_TRANSITO' : 'NO_PATIO';
}

export const transicoesValidas = (de: StatusAcesso): StatusAcesso[] => [...TRANSICOES[de]];

export const podeTransicionar = (de: StatusAcesso, para: StatusAcesso): boolean =>
  TRANSICOES[de]?.includes(para) ?? false;

export const exigeMotivo = (para: StatusAcesso): boolean => EXIGEM_MOTIVO.has(para);

export interface ResultadoTransicao {
  de: StatusAcesso;
  para: StatusAcesso;
  motivo: string | null;
}

/**
 * Valida a transicao. Nenhum caminho do sistema altera `acessos_portaria.status`
 * sem passar por aqui - inclusive o registro de saida.
 */
export function validarTransicao(de: StatusAcesso, para: StatusAcesso, motivo?: string | null): ResultadoTransicao {
  if (de === para) throw new InvalidTransitionError(de, para);
  if (!podeTransicionar(de, para)) throw new InvalidTransitionError(de, para);

  const texto = motivo?.trim() ?? '';
  if (exigeMotivo(para) && texto.length < 5) throw new InvalidTransitionError(de, para);

  return { de, para, motivo: texto.length > 0 ? texto : null };
}
