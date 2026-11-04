import { Decimal, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Regras da bateria (secao 7.11). Modulo puro: entra estado, sai decisao.
 *
 * Bateria nao avisa que vai morrer — ela morre no patio as 4h da manha, com a carga em
 * cima. Por isso o ponto de troca aqui nao e um numero so: e o encontro de tres coisas
 * que a operacao ja sabe de cor, escritas onde nao se esquecem.
 *
 * 1. **Tensao medida em repouso.** E o unico dado que fala do estado real do elemento.
 *    Medida com o motor desligado ha pelo menos 12h — com o alternador tendo acabado de
 *    rodar, qualquer bateria mede bem, e a leitura mente.
 * 2. **Tempo de uso.** Bateria e ativo que envelhece parado. Passou da vida util prevista,
 *    entra na fila de troca mesmo medindo bem: o que se compra e a viagem que ela nao
 *    interrompe, e nao o volt que ela ainda entrega hoje.
 * 3. **Garantia.** Trocar no dia 361 de uma garantia de 12 meses e jogar dinheiro fora.
 *    Quem decide e a manutencao, mas o sistema tem de dizer que a garantia esta viva.
 */

export type EstadoDaTensao = 'BOA' | 'ATENCAO' | 'CRITICA';

export interface FaixasDeTensao {
  /** a partir daqui a bateria esta saudavel, em volts */
  boa: number;
  /** abaixo daqui e troca imediata */
  critica: number;
}

/**
 * Faixas de bateria chumbo-acido de 12 V em repouso: 12,6 V e carga plena; 12,4 V ja e
 * cerca de 75%; abaixo de 12,0 V (perto de 50%) o arranque de motor diesel frio deixa de
 * ser garantido. Sao parametrizaveis porque banco de 24 V e outro numero.
 */
export const FAIXAS_TENSAO_PADRAO: FaixasDeTensao = { boa: 12.5, critica: 12.0 };

/** Vida util que a operacao pratica, em meses. */
export const VIDA_UTIL_MESES_PADRAO = 18;

/** Antecedencia do aviso de fim de vida, em meses. */
export const AVISAR_COM_MESES_PADRAO = 2;

export function estadoDaTensao(
  tensaoV: ValorMonetario | null | undefined,
  faixas = FAIXAS_TENSAO_PADRAO,
): EstadoDaTensao | null {
  // sem medicao nao se inventa estado: o que falta e medir, e o painel cobra isso
  if (tensaoV == null) return null;
  const tensao = dinheiro(tensaoV);
  if (tensao.greaterThanOrEqualTo(faixas.boa)) return 'BOA';
  if (tensao.greaterThanOrEqualTo(faixas.critica)) return 'ATENCAO';
  return 'CRITICA';
}

export type SituacaoBateria = 'EM_DIA' | 'ATENCAO' | 'TROCAR' | 'SEM_MEDICAO';

export type MotivoDoPonto =
  | 'TENSAO_CRITICA'
  | 'TENSAO_EM_QUEDA'
  | 'VIDA_UTIL_VENCIDA'
  | 'VIDA_UTIL_PROXIMA'
  | 'SEM_MEDICAO';

export interface EstadoDaBateria {
  /** quando entrou em operacao no veiculo; null enquanto esta em estoque */
  instaladaEm?: Date | null;
  vidaUtilMeses?: number | null;
  /** ultima leitura de tensao em repouso */
  tensaoV?: ValorMonetario | null;
  medidaEm?: Date | null;
  /** compra e garantia, para a troca poder ser cobrada do fornecedor */
  dataCompra?: Date | null;
  garantiaMeses?: number | null;
  faixas?: FaixasDeTensao;
  avisarComMeses?: number;
  agora?: Date;
}

export interface PontoDeTroca {
  situacao: SituacaoBateria;
  motivos: MotivoDoPonto[];
  mensagens: string[];
  /** meses inteiros desde a instalacao; null enquanto nao foi instalada */
  mesesEmUso: number | null;
  /** meses que faltam para o fim da vida util prevista; negativo quando ja passou */
  mesesRestantes: number | null;
  estadoDaTensao: EstadoDaTensao | null;
  /** a troca ainda pode ser cobrada do fornecedor */
  naGarantia: boolean;
  garantiaAte: Date | null;
}

const MES_MS = 2_629_800_000; // mes medio: 30,44 dias

const mesesEntre = (de: Date, ate: Date): number => Math.floor((ate.getTime() - de.getTime()) / MES_MS);

/**
 * Ponto de troca da bateria.
 *
 * A pior das tres leituras manda: bateria com tensao critica troca hoje, mesmo nova, e
 * bateria velha entra na fila mesmo medindo bem. Bateria sem nenhuma medicao nao e dada
 * como boa — aparece como `SEM_MEDICAO`, porque nunca medida e o estado que mais esconde
 * problema.
 */
export function pontoDeTroca(estado: EstadoDaBateria): PontoDeTroca {
  const agora = estado.agora ?? new Date();
  const faixas = estado.faixas ?? FAIXAS_TENSAO_PADRAO;
  const avisarCom = estado.avisarComMeses ?? AVISAR_COM_MESES_PADRAO;
  const vidaUtil = estado.vidaUtilMeses ?? VIDA_UTIL_MESES_PADRAO;

  const motivos: MotivoDoPonto[] = [];
  const mensagens: string[] = [];

  const mesesEmUso = estado.instaladaEm ? mesesEntre(estado.instaladaEm, agora) : null;
  const mesesRestantes = mesesEmUso === null ? null : vidaUtil - mesesEmUso;

  const tensao = estadoDaTensao(estado.tensaoV, faixas);

  if (tensao === 'CRITICA') {
    motivos.push('TENSAO_CRITICA');
    mensagens.push(
      `Tensao de ${dinheiro(estado.tensaoV as ValorMonetario).toFixed(2)} V abaixo de ${faixas.critica.toFixed(2)} V. ` +
        'A partida a frio deixa de ser garantida: troque antes de escalar o veiculo.',
    );
  } else if (tensao === 'ATENCAO') {
    motivos.push('TENSAO_EM_QUEDA');
    mensagens.push(
      `Tensao de ${dinheiro(estado.tensaoV as ValorMonetario).toFixed(2)} V abaixo do saudavel ` +
        `(${faixas.boa.toFixed(2)} V). Recarregue e meca de novo; se nao subir, e ponto de troca.`,
    );
  } else if (tensao === null) {
    motivos.push('SEM_MEDICAO');
    mensagens.push('Sem nenhuma medicao de tensao registrada. Bateria sem leitura e risco que ninguem enxerga.');
  }

  if (mesesRestantes !== null && mesesRestantes <= 0) {
    motivos.push('VIDA_UTIL_VENCIDA');
    mensagens.push(
      `Em uso ha ${mesesEmUso} meses, acima da vida util prevista de ${vidaUtil}. ` +
        'Entra na fila de troca programada mesmo medindo bem.',
    );
  } else if (mesesRestantes !== null && mesesRestantes <= avisarCom) {
    motivos.push('VIDA_UTIL_PROXIMA');
    mensagens.push(`Faltam ${mesesRestantes} mes(es) para o fim da vida util prevista de ${vidaUtil} meses.`);
  }

  const garantiaAte =
    estado.dataCompra && estado.garantiaMeses
      ? new Date(estado.dataCompra.getTime() + estado.garantiaMeses * MES_MS)
      : null;
  const naGarantia = garantiaAte !== null && garantiaAte.getTime() >= agora.getTime();

  if (naGarantia && motivos.length > 0) {
    mensagens.push(
      `Garantia vigente ate ${garantiaAte!.toLocaleDateString('pt-BR')}: acione o fornecedor antes de comprar outra.`,
    );
  }

  const situacao: SituacaoBateria = motivos.includes('TENSAO_CRITICA') || motivos.includes('VIDA_UTIL_VENCIDA')
    ? 'TROCAR'
    : motivos.includes('TENSAO_EM_QUEDA') || motivos.includes('VIDA_UTIL_PROXIMA')
      ? 'ATENCAO'
      : motivos.includes('SEM_MEDICAO')
        ? 'SEM_MEDICAO'
        : 'EM_DIA';

  return {
    situacao,
    motivos,
    mensagens,
    mesesEmUso,
    mesesRestantes,
    estadoDaTensao: tensao,
    naGarantia,
    garantiaAte,
  };
}

/**
 * Leitura de tensao que nao serve para decidir.
 *
 * Tensao fora da faixa fisica de um banco 12 V ou 24 V e erro de digitacao ou de ponta de
 * prova — registrar assim contaminaria o historico e o ponto de troca de todo mundo.
 */
export function tensaoInvalida(tensaoV: ValorMonetario): string | null {
  const tensao = dinheiro(tensaoV);
  if (tensao.lessThanOrEqualTo(0)) return 'A tensao precisa ser maior que zero.';
  if (tensao.greaterThan(30)) return 'Tensao acima de 30 V nao e leitura de bateria automotiva. Confira a medicao.';
  return null;
}

/** Km rodados com a bateria instalada, quando o hodometro da instalacao foi registrado. */
export function kmComABateria(
  hodometroInstalacao: ValorMonetario | null | undefined,
  hodometroAtual: ValorMonetario | null | undefined,
): Decimal | null {
  if (hodometroInstalacao == null || hodometroAtual == null) return null;
  const km = dinheiro(hodometroAtual).minus(dinheiro(hodometroInstalacao));
  return km.isNegative() ? null : km.toDecimalPlaces(1);
}
