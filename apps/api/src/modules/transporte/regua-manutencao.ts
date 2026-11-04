import { Decimal, dinheiro, type ValorMonetario } from '../../core/money.js';
import {
  posicaoPeriodica,
  type BaseMedicao,
  type PlanoPeriodico,
  type PosicaoPeriodica,
  type TipoServicoPeriodico,
} from './manutencao-periodica.js';

/**
 * Regua de severidade da manutencao periodica (ADR 0023).
 *
 * `manutencao-periodica.ts` responde **quanto falta** — a conta que a planilha fazia, validada
 * em campo. Este modulo responde a outra pergunta, que a planilha nunca respondeu: **o quanto
 * isso importa hoje**, e em que ordem os caminhoes entram no box.
 *
 * Sao tres coisas que so existem aqui:
 *
 * - **Fracao do ciclo consumida.** "Faltam 555 km do motor" e "faltam 47 h do Thermo King" nao se
 *   comparam em numero absoluto; em fracao de ciclo, sim. E o que permite ordenar a fila.
 * - **Limite de calendario.** Oleo envelhece parado. Caminhao tres meses em Acailandia nao teve o
 *   oleo preservado — ele oxidou. O que vencer primeiro manda, km ou dia.
 * - **Medidor que anda para tras e falta de base, nunca vencimento.** A base real tem reset de
 *   aparelho de frio (ultima troca em 18.195 h, horimetro atual em 21 h). Chamar isso de atraso
 *   jogaria o item em vencido por defeito de leitura.
 */

export type Severidade = 'EM_DIA' | 'ATENCAO' | 'CRITICO' | 'VENCIDO' | 'SEM_BASE';

/** Peso do status para desempatar a fila; e a ordem de gravidade, escrita uma vez so. */
export const PESO_SEVERIDADE: Record<Severidade, number> = {
  VENCIDO: 4,
  CRITICO: 3,
  ATENCAO: 2,
  EM_DIA: 1,
  SEM_BASE: 0,
};

export const ROTULO_SEVERIDADE: Record<Severidade, string> = {
  VENCIDO: 'Vencido',
  CRITICO: 'Critico',
  ATENCAO: 'Atencao',
  EM_DIA: 'Em dia',
  SEM_BASE: 'Sem registro',
};

/** A partir daqui a barra vira dourada: tres quartos do ciclo ja foram. */
const FAIXA_ATENCAO = 0.75;
/** A partir daqui vira laranja: o que sobrou nao cabe numa semana de rodagem. */
const FAIXA_CRITICO = 0.9;

/**
 * Prazo maximo entre execucoes, em dias, ainda que o medidor nao tenha andado.
 *
 * `LUBRIFICACAO` fica de fora de proposito: a base dela **ja e** o calendario (7.10), e somar uma
 * segunda regua de tempo em cima contaria o mesmo prazo duas vezes.
 */
export const LIMITE_DIAS_PADRAO: Record<TipoServicoPeriodico, number | null> = {
  LUBRIFICACAO: null,
  OLEO_MOTOR: 180,
  OLEO_DIFERENCIAL: 730,
  OLEO_CAIXA_MARCHA: 730,
  OLEO_THERMO_KING: 365,
  ALINHAMENTO: 180,
  BALANCEAMENTO: 180,
};

export interface EntradaRegua {
  plano: PlanoPeriodico;
  /** medicao registrada na ultima execucao; null quando nunca houve */
  medicaoDaUltima?: ValorMonetario | null;
  /** medicao corrente do ativo: hodometro do veiculo ou horimetro do equipamento */
  medicaoAtual?: ValorMonetario | null;
  /** data da ultima execucao; e o que o limite de calendario mede */
  dataDaUltima?: Date | null;
  /** prazo maximo em dias; quando ausente, usa o padrao do tipo */
  limiteDias?: number | null;
  agora?: Date;
}

export interface PosicaoNaRegua {
  /** o que falta, do motor validado em campo */
  posicao: PosicaoPeriodica;
  severidade: Severidade;
  peso: number;
  /**
   * fracao do ciclo consumida, de 0 a 1. E o preenchimento da barra na tela — enche conforme
   * o ciclo e gasto. Passa de 1 quando ja venceu, e a tela trunca; o numero cru fica aqui
   * porque quem ordena a fila precisa saber **o quanto** passou.
   */
  usado: number;
  /** por que este item esta neste status, quando nao e obvio pelo numero */
  motivo: string | null;
  /** leitura que nao fecha e precisa de olho humano; nunca vira status sozinha */
  alerta: string | null;
}

const DIA_MS = 86_400_000;

/**
 * Severidade de um item de um ativo.
 *
 * Ordem de apuracao, e ela importa: primeiro a falta de base (sem o que comparar, nao ha
 * severidade a apurar), depois a regua de medicao, e por ultimo o calendario — que **so agrava**,
 * nunca abranda. Um item vencido por km nao volta a ser critico porque a troca foi recente.
 */
export function posicaoNaRegua(entrada: EntradaRegua): PosicaoNaRegua {
  const posicao = posicaoPeriodica(entrada);
  const porDias = entrada.plano.base === 'DIAS';

  const invertido = medidorInvertido(entrada);
  if (invertido !== null) {
    return { posicao, severidade: 'SEM_BASE', peso: 0, usado: 0, motivo: null, alerta: invertido };
  }

  // sem leitura do painel nao ha o que comparar, e sem historico nem ciclo comecou
  const semLeitura = !porDias && entrada.medicaoAtual == null;
  if (semLeitura || posicao.situacao === 'SEM_REGISTRO') {
    return {
      posicao,
      severidade: 'SEM_BASE',
      peso: 0,
      usado: 0,
      motivo: semLeitura ? 'Sem leitura do medidor' : 'Sem execucao registrada',
      alerta: null,
    };
  }

  const intervalo = dinheiro(entrada.plano.intervalo);
  if (intervalo.lessThanOrEqualTo(0)) {
    return { posicao, severidade: 'SEM_BASE', peso: 0, usado: 0, motivo: 'Intervalo do plano invalido', alerta: null };
  }

  // restante negativo e o quanto passou; a fracao usada segue crescendo alem de 1
  const restante = posicao.aVencer.minus(posicao.vencido);
  const usado = Number(intervalo.minus(restante).dividedBy(intervalo).toDecimalPlaces(4));

  let severidade: Severidade = restante.lessThanOrEqualTo(0)
    ? 'VENCIDO'
    : usado >= FAIXA_CRITICO
      ? 'CRITICO'
      : usado >= FAIXA_ATENCAO
        ? 'ATENCAO'
        : 'EM_DIA';

  let motivo: string | null = null;
  let usadoFinal = usado;

  const calendario = agravamentoPorCalendario(entrada, severidade, porDias);
  if (calendario !== null) {
    severidade = calendario.severidade;
    motivo = calendario.motivo;
    usadoFinal = Math.max(usado, calendario.usadoMinimo);
  }

  return { posicao, severidade, peso: PESO_SEVERIDADE[severidade], usado: usadoFinal, motivo, alerta: null };
}

/**
 * Medidor que retrocedeu.
 *
 * Reset de aparelho de frio, troca de painel ou digito a menos do frentista — tres historias
 * diferentes, e so quem esta no patio sabe qual. Por isso a regua **descreve e para**: nao
 * corrige o numero sozinha, nao chuta o ciclo e nao deixa o item virar vencido por defeito de
 * leitura. Fica pedindo confirmacao humana, que e o unico desfecho honesto.
 */
function medidorInvertido(entrada: EntradaRegua): string | null {
  if (entrada.plano.base === 'DIAS') return null;
  if (entrada.medicaoAtual == null || entrada.medicaoDaUltima == null) return null;

  const atual = dinheiro(entrada.medicaoAtual);
  const ultima = dinheiro(entrada.medicaoDaUltima);
  if (atual.greaterThanOrEqualTo(ultima)) return null;

  const unidade = entrada.plano.base === 'HORIMETRO' ? 'h' : 'km';
  return (
    `Leitura atual (${atual.toFixed(1)} ${unidade}) menor que a da ultima execucao ` +
    `(${ultima.toFixed(1)} ${unidade}). Confirme se houve reset ou troca do medidor.`
  );
}

/**
 * O calendario so agrava.
 *
 * Passado o limite, o item vence por tempo ainda que o hodometro nao tenha andado; a 90% do
 * limite, vira critico. Nos dois casos o motivo vai escrito em portugues, porque "vencido" sem
 * numero de km ao lado deixa o encarregado achando que a tela quebrou.
 */
function agravamentoPorCalendario(
  entrada: EntradaRegua,
  atual: Severidade,
  porDias: boolean,
): { severidade: Severidade; motivo: string; usadoMinimo: number } | null {
  if (porDias) return null;

  const limite = entrada.limiteDias ?? LIMITE_DIAS_PADRAO[entrada.plano.tipo];
  if (limite == null || limite <= 0 || entrada.dataDaUltima == null) return null;

  const agora = entrada.agora ?? new Date();
  const idade = Math.floor((agora.getTime() - entrada.dataDaUltima.getTime()) / DIA_MS);
  if (idade < 0) return null;

  const motivo = `${idade} dias desde a ultima (limite ${limite})`;

  if (idade >= limite && PESO_SEVERIDADE[atual] < PESO_SEVERIDADE.VENCIDO) {
    return { severidade: 'VENCIDO', motivo, usadoMinimo: 1 };
  }
  if (idade >= limite * FAIXA_CRITICO && PESO_SEVERIDADE[atual] < PESO_SEVERIDADE.CRITICO) {
    return { severidade: 'CRITICO', motivo, usadoMinimo: 0.92 };
  }
  return null;
}

/**
 * Ordem da fila da oficina.
 *
 * `(vencidos x 100) + (criticos x 10) + peso(pior)`. Nao e ranking estetico: um caminhao com tres
 * itens vencidos sobe porque **a mesma parada resolve os tres**, e o ganho operacional do painel
 * inteiro e nao perder a viagem ao box. O peso do pior desempata ativos com a mesma contagem.
 *
 * `SEM_BASE` nao pontua: falta de leitura nao e falta de manutencao, e deixar a ausencia de dado
 * empurrar caminhao para o box enche a oficina de servico que talvez nem esteja vencido.
 */
export function scoreDoAtivo(itens: readonly { severidade: Severidade }[]): number {
  let vencidos = 0;
  let criticos = 0;
  let pior: Severidade = 'SEM_BASE';

  for (const item of itens) {
    if (item.severidade === 'VENCIDO') vencidos += 1;
    if (item.severidade === 'CRITICO') criticos += 1;
    if (PESO_SEVERIDADE[item.severidade] > PESO_SEVERIDADE[pior]) pior = item.severidade;
  }

  return vencidos * 100 + criticos * 10 + PESO_SEVERIDADE[pior];
}

/** Pior severidade de um conjunto — o selo que a linha do patio mostra ao lado da placa. */
export function piorSeveridade(itens: readonly { severidade: Severidade }[]): Severidade {
  return itens.reduce<Severidade>(
    (pior, item) => (PESO_SEVERIDADE[item.severidade] > PESO_SEVERIDADE[pior] ? item.severidade : pior),
    'SEM_BASE',
  );
}

/**
 * Ordem fixa de exibicao dos itens na linha do patio.
 *
 * O olho do encarregado decora posicao, nao rotulo: a coluna do motor tem que estar sempre no
 * mesmo lugar, em todas as linhas, todos os dias.
 */
export const ORDEM_ITENS: readonly TipoServicoPeriodico[] = [
  'OLEO_MOTOR',
  'ALINHAMENTO',
  'BALANCEAMENTO',
  'OLEO_CAIXA_MARCHA',
  'OLEO_DIFERENCIAL',
  'OLEO_THERMO_KING',
  'LUBRIFICACAO',
];

/**
 * Texto do que falta, para a tela nao precisar saber de Decimal.
 *
 * Recebe a posicao **na regua**, e nao a posicao crua, porque sem base nao ha numero a
 * mostrar. O ativo sem historico tem um restante aritmeticamente correto — o ciclo conta do
 * zero — e operacionalmente falso: dizer "401.553 km vencidos" ao lado de "sem registro" e
 * a mesma mentira que a planilha contava, so que agora com selo de sistema.
 */
export function textoDoRestante(posicao: PosicaoNaRegua, base: BaseMedicao): string {
  if (posicao.severidade === 'SEM_BASE') return 'sem base para calcular';

  const unidade = base === 'HORIMETRO' ? 'h' : base === 'DIAS' ? 'dias' : 'km';
  if (posicao.posicao.vencido.greaterThan(0)) {
    return `${formatar(posicao.posicao.vencido)} ${unidade} vencidos`;
  }
  return `faltam ${formatar(posicao.posicao.aVencer)} ${unidade}`;
}

const formatar = (v: Decimal): string => v.toDecimalPlaces(0).toNumber().toLocaleString('pt-BR');
