import { Decimal, dinheiro, type ValorMonetario } from '../../core/money.js';
import type { TipoAcesso } from './state-machine.js';

/**
 * Regras da guarita (secao 14.3). Modulo puro: recebe o estado, devolve decisao.
 *
 * A guarita nao improvisa. Quem barra e a regra escrita aqui, com motivo registrado -
 * porteiro nao deve ter que decidir sozinho quem entra, nem responder por isso depois.
 */

export interface PessoaParaEntrada {
  nome: string;
  documento: string;
  bloqueado: boolean;
  motivoBloqueio?: string | null;
  /** motorista de terceiro: CNH vencida nao entra dirigindo */
  cnhVencimento?: Date | null;
}

export interface ImpedimentoEntrada {
  codigo: 'PESSOA_BLOQUEADA' | 'CNH_VENCIDA' | 'JA_ESTA_DENTRO' | 'SEM_DOCUMENTO' | 'SEM_MOTIVO';
  mensagem: string;
  /** true quando a guarita pode liberar com autorizacao registrada de quem tem alcada */
  liberavel: boolean;
}

export interface ContextoEntrada {
  tipo: TipoAcesso;
  pessoa?: PessoaParaEntrada | null;
  /** acesso ainda aberto da mesma pessoa, placa ou veiculo */
  jaTemAcessoAberto: boolean;
  motivo: string;
  /** dirigindo: exige CNH valida; a pe, nao */
  aoVolante: boolean;
  agora: Date;
}

/**
 * Impedimentos de entrada, em ordem de gravidade. Lista vazia = pode entrar.
 *
 * Bloqueio da lista restritiva nao e liberavel na guarita: quem bloqueou por escrito
 * e quem desbloqueia por escrito. Os demais admitem liberacao com autorizacao registrada.
 */
export function avaliarEntrada(ctx: ContextoEntrada): ImpedimentoEntrada[] {
  const impedimentos: ImpedimentoEntrada[] = [];

  if (ctx.motivo.trim().length < 3) {
    impedimentos.push({
      codigo: 'SEM_MOTIVO',
      mensagem: 'Informe o motivo da entrada. Registro de portaria sem motivo nao serve a ninguem depois.',
      liberavel: false,
    });
  }

  if (ctx.pessoa) {
    if (ctx.pessoa.documento.trim().length < 3) {
      impedimentos.push({
        codigo: 'SEM_DOCUMENTO',
        mensagem: 'Identifique a pessoa por documento antes de liberar a entrada.',
        liberavel: false,
      });
    }

    if (ctx.pessoa.bloqueado) {
      impedimentos.push({
        codigo: 'PESSOA_BLOQUEADA',
        mensagem:
          `${ctx.pessoa.nome} esta na lista restritiva` +
          (ctx.pessoa.motivoBloqueio ? `: ${ctx.pessoa.motivoBloqueio}.` : '.') +
          ' A entrada depende de desbloqueio registrado, nao de decisao da guarita.',
        liberavel: false,
      });
    }

    if (ctx.aoVolante && ctx.pessoa.cnhVencimento && ctx.pessoa.cnhVencimento < ctx.agora) {
      impedimentos.push({
        codigo: 'CNH_VENCIDA',
        mensagem: `CNH de ${ctx.pessoa.nome} venceu em ${ctx.pessoa.cnhVencimento.toLocaleDateString('pt-BR')}.`,
        liberavel: true,
      });
    }
  }

  if (ctx.jaTemAcessoAberto) {
    impedimentos.push({
      codigo: 'JA_ESTA_DENTRO',
      mensagem:
        'Ja existe um acesso aberto sem saida registrada. Encerre o anterior antes de abrir outro - ' +
        'dois registros abertos fazem o patio mentir.',
      liberavel: false,
    });
  }

  return impedimentos;
}

export const podeEntrar = (ctx: ContextoEntrada): boolean => avaliarEntrada(ctx).length === 0;

export interface PendenciaSaida {
  codigo: 'CRACHA_NAO_DEVOLVIDO' | 'HODOMETRO_MENOR' | 'SEM_ENTRADA';
  mensagem: string;
}

export interface ContextoSaida {
  tipo: TipoAcesso;
  cracha?: string | null;
  crachaDevolvido: boolean;
  /** para o caminhao da casa, o hodometro fecha a viagem */
  hodometroSaida?: ValorMonetario | null;
  hodometroRetorno?: ValorMonetario | null;
  /** momento do evento que abriu o acesso */
  abertoEm: Date | null;
}

/**
 * Pendencias que impedem fechar o acesso. Cracha entregue e nao devolvido nao vira
 * observacao no caderno: vira ocorrencia, e por isso trava a saida ate a decisao.
 */
export function avaliarSaida(ctx: ContextoSaida): PendenciaSaida[] {
  const pendencias: PendenciaSaida[] = [];

  if (!ctx.abertoEm) {
    pendencias.push({
      codigo: 'SEM_ENTRADA',
      mensagem: 'Este acesso nao tem entrada registrada. Nao ha saida a registrar.',
    });
  }

  if (ctx.cracha && ctx.cracha.trim().length > 0 && !ctx.crachaDevolvido) {
    pendencias.push({
      codigo: 'CRACHA_NAO_DEVOLVIDO',
      mensagem: `Cracha ${ctx.cracha} nao devolvido. Registre a devolucao ou abra ocorrencia.`,
    });
  }

  if (ctx.tipo === 'VEICULO_PROPRIO' && ctx.hodometroSaida != null && ctx.hodometroRetorno != null) {
    if (dinheiro(ctx.hodometroRetorno).lessThan(dinheiro(ctx.hodometroSaida))) {
      pendencias.push({
        codigo: 'HODOMETRO_MENOR',
        mensagem: 'Hodometro de retorno menor que o de saida. Confira a leitura antes de fechar a viagem.',
      });
    }
  }

  return pendencias;
}

/** Km da viagem do caminhao da casa. Null quando falta uma das leituras. */
export function kmDaViagem(
  hodometroSaida: ValorMonetario | null | undefined,
  hodometroRetorno: ValorMonetario | null | undefined,
): Decimal | null {
  if (hodometroSaida == null || hodometroRetorno == null) return null;
  const km = dinheiro(hodometroRetorno).minus(dinheiro(hodometroSaida));
  return km.isNegative() ? null : km.toDecimalPlaces(1);
}

/** Permanencia em minutos, do evento de abertura ao de fechamento (ou ate agora). */
export function permanenciaEmMinutos(abertoEm: Date | null, fechadoEm: Date | null, agora: Date): number | null {
  if (!abertoEm) return null;
  const fim = fechadoEm ?? agora;
  const minutos = Math.floor((fim.getTime() - abertoEm.getTime()) / 60_000);
  return minutos < 0 ? 0 : minutos;
}

export type EstadoPermanencia = 'NORMAL' | 'ATENCAO' | 'EXCEDIDA';

/**
 * Alerta de permanencia longa (secao 14.3). Visitante que entrou de manha e nao saiu
 * ate a noite e, quase sempre, saida que ninguem registrou - e o patio deixa de valer.
 */
export function avaliarPermanencia(
  minutos: number | null,
  limiteHoras: number,
): { estado: EstadoPermanencia; percentual: number | null } {
  if (minutos === null || limiteHoras <= 0) return { estado: 'NORMAL', percentual: null };
  const percentual = minutos / (limiteHoras * 60);
  if (percentual >= 1) return { estado: 'EXCEDIDA', percentual };
  if (percentual >= 0.8) return { estado: 'ATENCAO', percentual };
  return { estado: 'NORMAL', percentual };
}

/** Placa no padrao antigo ou Mercosul, normalizada sem hifen para comparar sempre igual. */
const PLACA = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/;

export function normalizarPlaca(placa: string): string {
  const limpa = placa.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!PLACA.test(limpa)) {
    throw new RangeError(`Placa invalida: ${placa}. Use o formato ABC1234 ou ABC1D23.`);
  }
  return limpa;
}

/** Documento so com digitos e letras, para o mesmo CPF nao virar dois cadastros. */
export const normalizarDocumento = (documento: string): string =>
  documento.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
