import { Decimal, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Manutencao periodica por medicao: trocas de oleo e servicos de rodagem (secao 7.10).
 *
 * A planilha que a operacao usava fazia sempre a mesma conta, em cinco abas: pega a
 * medicao da ultima troca, soma o intervalo do tipo, compara com a medicao de hoje e
 * mostra o que falta — ou o que ja passou. O que mudava entre as abas era **o intervalo
 * e a unidade de medida**, nao a conta. Este modulo e essa conta, uma vez so.
 *
 * O que a planilha nao tinha e aqui vale:
 *
 * - **Sem troca registrada, o vencimento conta do zero.** Caminhao novo que nunca trocou
 *   vence no primeiro intervalo (na aba MOTOR, a linha sem data mostra 20.000 direto), e
 *   nao fica fora do controle so por nao ter historico. Mas quando o ativo ja rodou mais
 *   de um ciclo inteiro sem nenhum registro, o que ele tem nao e atraso de 400.000 km: e
 *   **falta de historico**, e a tela precisa dizer isso, e nao um numero que ninguem pode
 *   agir. Situacao `SEM_REGISTRO` existe para essa linha nao virar ruido no painel.
 * - **Aviso antes do vencimento.** Enxergar "faltam 555 km" so serve se alguem for
 *   avisado; a faixa de aviso e do plano, e nao um numero na cabeca de quem olha.
 */

export type TipoServicoPeriodico =
  | 'LUBRIFICACAO'
  | 'OLEO_MOTOR'
  | 'OLEO_DIFERENCIAL'
  | 'OLEO_CAIXA_MARCHA'
  | 'OLEO_THERMO_KING'
  | 'ALINHAMENTO'
  | 'BALANCEAMENTO';

/**
 * O que conta o vencimento.
 *
 * `DIAS` nao mede o ativo, mede o calendario: engraxamento de chassi vence por tempo
 * parado tambem, e nao so por quilometro rodado. E por isso que a base e do **plano**, e
 * nao do tipo — o gestor troca de km para dias quando a operacao mudar, sem deploy.
 */
export type BaseMedicao = 'HODOMETRO' | 'HORIMETRO' | 'DIAS';

export type SituacaoPeriodica = 'EM_DIA' | 'PROXIMA' | 'VENCIDA' | 'SEM_REGISTRO';

/** Intervalos que a planilha praticava, por tipo (secao 7.10). */
export const INTERVALO_PADRAO: Record<TipoServicoPeriodico, { base: BaseMedicao; intervalo: number; avisarCom: number }> = {
  // lubrificacao de chassi: a operacao faz de 10 em 10 dias, e nao por quilometragem
  LUBRIFICACAO: { base: 'DIAS', intervalo: 10, avisarCom: 2 },
  OLEO_MOTOR: { base: 'HODOMETRO', intervalo: 20_000, avisarCom: 2_000 },
  OLEO_DIFERENCIAL: { base: 'HODOMETRO', intervalo: 60_000, avisarCom: 5_000 },
  OLEO_CAIXA_MARCHA: { base: 'HODOMETRO', intervalo: 60_000, avisarCom: 5_000 },
  // 1.000 h e o intervalo do CARRIER; o plano do modelo THERMO KING sobrepoe com 2.000 h
  OLEO_THERMO_KING: { base: 'HORIMETRO', intervalo: 1_000, avisarCom: 100 },
  ALINHAMENTO: { base: 'HODOMETRO', intervalo: 10_000, avisarCom: 1_000 },
  BALANCEAMENTO: { base: 'HODOMETRO', intervalo: 10_000, avisarCom: 1_000 },
};

export const ROTULO_TIPO: Record<TipoServicoPeriodico, string> = {
  LUBRIFICACAO: 'Lubrificacao',
  OLEO_MOTOR: 'Oleo do motor',
  OLEO_DIFERENCIAL: 'Oleo do diferencial',
  OLEO_CAIXA_MARCHA: 'Oleo da caixa de marcha',
  OLEO_THERMO_KING: 'Oleo do Thermo King',
  ALINHAMENTO: 'Alinhamento',
  BALANCEAMENTO: 'Balanceamento',
};

export interface PlanoPeriodico {
  tipo: TipoServicoPeriodico;
  base: BaseMedicao;
  /** km ou horas entre uma execucao e a proxima */
  intervalo: ValorMonetario;
  /** quanto antes do vencimento a linha ja aparece como proxima */
  avisarCom: ValorMonetario;
}

export interface EstadoPeriodico {
  plano: PlanoPeriodico;
  /** medicao registrada na ultima execucao; null quando nunca houve */
  medicaoDaUltima?: ValorMonetario | null;
  /** medicao corrente do ativo: hodometro do veiculo ou horimetro do equipamento */
  medicaoAtual?: ValorMonetario | null;
  /** data da ultima execucao; e o que conta quando o plano vence por dias */
  dataDaUltima?: Date | null;
  agora?: Date;
}

export interface PosicaoPeriodica {
  /** medicao em que a proxima execucao vence; null quando o plano vence por dias */
  proxima: Decimal | null;
  /** data do proximo vencimento; preenchida so no plano por dias */
  proximaEm: Date | null;
  /** quanto falta; zero quando ja venceu */
  aVencer: Decimal;
  /** quanto passou do vencimento; zero quando ainda nao venceu */
  vencido: Decimal;
  situacao: SituacaoPeriodica;
  /** nunca executado: o controle comeca do zero, e nao do primeiro registro */
  semHistorico: boolean;
}

/**
 * Posicao de um ativo em um plano.
 *
 * Sem medicao atual nao ha o que comparar — o ativo aparece como em dia, porque o que
 * falta e leitura, nao manutencao. Quem cobra a leitura e a portaria e o checklist (7.1).
 */
export function posicaoPeriodica(estado: EstadoPeriodico): PosicaoPeriodica {
  const intervalo = dinheiro(estado.plano.intervalo);
  if (estado.plano.base === 'DIAS') return posicaoPorDias(estado, intervalo);

  const semHistorico = estado.medicaoDaUltima == null;

  // sem execucao registrada o ciclo conta do zero: o primeiro vencimento e o proprio intervalo
  const base = semHistorico ? new Decimal(0) : dinheiro(estado.medicaoDaUltima as ValorMonetario);
  const proxima = base.plus(intervalo).toDecimalPlaces(1);

  const atual = estado.medicaoAtual == null ? null : dinheiro(estado.medicaoAtual);
  if (atual === null) {
    return {
      proxima,
      proximaEm: null,
      aVencer: intervalo.toDecimalPlaces(1),
      vencido: new Decimal(0),
      situacao: 'EM_DIA',
      semHistorico,
    };
  }

  const diferenca = proxima.minus(atual).toDecimalPlaces(1);
  const aVencer = diferenca.isNegative() ? new Decimal(0) : diferenca;
  const vencido = diferenca.isNegative() ? diferenca.abs() : new Decimal(0);

  /*
   * Mais de um ciclo inteiro de atraso e sem nenhum registro: o ativo nunca entrou no
   * controle. Chamar isso de "vencido ha 421.553 km" e verdade aritmetica e mentira
   * operacional - ninguem trocou oleo 21 vezes de uma vez.
   */
  const nuncaEntrouNoControle = semHistorico && vencido.greaterThan(intervalo);

  const situacao: SituacaoPeriodica = nuncaEntrouNoControle
    ? 'SEM_REGISTRO'
    : diferenca.isNegative()
      ? 'VENCIDA'
      : diferenca.lessThanOrEqualTo(dinheiro(estado.plano.avisarCom))
        ? 'PROXIMA'
        : 'EM_DIA';

  return { proxima, proximaEm: null, aVencer, vencido, situacao, semHistorico };
}

const DIA_MS = 86_400_000;

/**
 * Plano que vence por calendario (lubrificacao de chassi, hoje de 10 em 10 dias).
 *
 * Segue o mesmo desenho do gatilho `DIAS` do plano preventivo (secao 7.5): conta do dia da
 * ultima execucao, e o que falta e dia inteiro — meio dia de atraso nao e atraso para quem
 * agenda engraxamento. Sem nenhuma execucao registrada nao ha de onde contar: a linha
 * aparece como `SEM_REGISTRO` com a data que valeria se fosse feita hoje, e nao como
 * "em dia" — dizer que esta em dia o que nunca foi feito e o erro que a planilha permitia.
 */
function posicaoPorDias(estado: EstadoPeriodico, intervalo: Decimal): PosicaoPeriodica {
  const agora = estado.agora ?? new Date();
  const semHistorico = estado.dataDaUltima == null;
  const partida = estado.dataDaUltima ?? agora;

  const proximaEm = new Date(partida.getTime() + Number(intervalo) * DIA_MS);
  const dias = Math.floor((proximaEm.getTime() - agora.getTime()) / DIA_MS);
  const faltam = new Decimal(dias);

  const aVencer = dias < 0 ? new Decimal(0) : faltam;
  const vencido = dias < 0 ? faltam.abs() : new Decimal(0);

  const situacao: SituacaoPeriodica = semHistorico
    ? 'SEM_REGISTRO'
    : dias < 0
      ? 'VENCIDA'
      : faltam.lessThanOrEqualTo(dinheiro(estado.plano.avisarCom))
        ? 'PROXIMA'
        : 'EM_DIA';

  return { proxima: null, proximaEm, aVencer, vencido, situacao, semHistorico };
}

/** Unidade da base, para a tela e as mensagens dizerem "km", "h" ou "dias". */
export function unidadeDaBase(base: BaseMedicao): 'km' | 'h' | 'dias' {
  if (base === 'HORIMETRO') return 'h';
  if (base === 'DIAS') return 'dias';
  return 'km';
}

/**
 * Bases que o gestor pode escolher para o tipo.
 *
 * Quem vence por hora e o aparelho de frio, que tem horimetro proprio; o resto e do
 * veiculo. **Dias vale para qualquer tipo**: e o pedido da lubrificacao, mas serve a
 * qualquer servico que a operacao prefira lembrar por calendario em vez de rodagem.
 */
export function basesPermitidas(tipo: TipoServicoPeriodico): BaseMedicao[] {
  return tipo === 'OLEO_THERMO_KING' ? ['HORIMETRO', 'DIAS'] : ['HODOMETRO', 'DIAS'];
}

/**
 * Plano que vale para um ativo.
 *
 * O plano do modelo ganha do plano geral do tipo: e o que separa o CARRIER de 1.000 h do
 * THERMO KING de 2.000 h sem precisar de duas abas. Comparacao sem acento e sem caixa,
 * porque "Thermo King" e "THERMO KING" sao o mesmo aparelho.
 */
export function planoAplicavel<T extends { tipo: TipoServicoPeriodico; modelo?: string | null }>(
  planos: T[],
  tipo: TipoServicoPeriodico,
  modeloDoAtivo?: string | null,
): T | null {
  const doTipo = planos.filter((p) => p.tipo === tipo);
  const alvo = normalizar(modeloDoAtivo);

  if (alvo !== '') {
    const porModelo = doTipo.find((p) => {
      const modelo = normalizar(p.modelo);
      return modelo !== '' && (alvo.includes(modelo) || modelo.includes(alvo));
    });
    if (porModelo) return porModelo;
  }

  return doTipo.find((p) => normalizar(p.modelo) === '') ?? null;
}

const normalizar = (v?: string | null): string =>
  (v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

/**
 * Medicao da execucao contra a do ativo.
 *
 * A troca acontece no patio, e a leitura vai para o papel antes de virar registro: leitura
 * menor que a da ultima troca do mesmo tipo e erro de digitacao, e entra como recusa — nao
 * daria para calcular vencimento nenhum a partir dela.
 */
export function medicaoDaExecucaoInvalida(
  medicao: ValorMonetario,
  medicaoDaUltima?: ValorMonetario | null,
): string | null {
  const valor = dinheiro(medicao);
  if (valor.isNegative()) return 'A medicao da troca nao pode ser negativa.';
  if (medicaoDaUltima == null) return null;

  const anterior = dinheiro(medicaoDaUltima);
  if (valor.lessThan(anterior)) {
    return (
      `A medicao informada (${valor.toFixed(1)}) e menor que a da ultima execucao deste tipo ` +
      `(${anterior.toFixed(1)}). Confira a leitura antes de registrar.`
    );
  }
  return null;
}
