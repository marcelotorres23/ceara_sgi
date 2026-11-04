import { Decimal, centavos, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Indicadores estrategicos (secao 10). Modulo puro: recebe as linhas ja agregadas
 * pelas views materializadas e devolve o numero com a memoria de calculo.
 *
 * Regra que vale para o arquivo inteiro: **sem base, devolve `null`, nunca zero**.
 * Zero afirma "medi e deu zero"; null afirma "nao ha o que medir". Confundir os dois
 * e como um painel de savings mostrar 0% num mes sem compras.
 */

// ---------------------------------------------------------------- curva ABC

export interface ItemValorizado {
  itemId: string;
  codigo: string;
  descricao: string;
  valor: ValorMonetario;
}

export interface LinhaCurvaAbc extends ItemValorizado {
  curva: 'A' | 'B' | 'C';
  valorFormatado: string;
  /** participacao do item no valor total, 0 a 1 */
  participacao: number;
  /** participacao acumulada ate este item, 0 a 1 */
  acumulado: number;
}

export interface CurvaAbc {
  itens: LinhaCurvaAbc[];
  resumo: Record<'A' | 'B' | 'C', { itens: number; valor: string; participacao: number }>;
  valorTotal: string;
}

/**
 * Curva ABC por valor (secao 8.5): A ate 80% do valor acumulado, B ate 95%, C o resto.
 * Os cortes sao parametros porque a distribuicao de um almoxarifado de frota nao e
 * a mesma de um de consumo.
 */
export function curvaAbc(itens: ItemValorizado[], corteA = 0.8, corteB = 0.95): CurvaAbc {
  const total = itens.reduce<Decimal>((soma, i) => soma.plus(dinheiro(i.valor)), new Decimal(0));

  const vazio = {
    itens: [] as LinhaCurvaAbc[],
    resumo: {
      A: { itens: 0, valor: '0.00', participacao: 0 },
      B: { itens: 0, valor: '0.00', participacao: 0 },
      C: { itens: 0, valor: '0.00', participacao: 0 },
    },
    valorTotal: centavos(total).toFixed(2),
  };
  if (itens.length === 0 || total.lessThanOrEqualTo(0)) return vazio;

  const ordenados = [...itens].sort((a, b) => Number(dinheiro(b.valor).minus(dinheiro(a.valor))));

  let acumulado = new Decimal(0);
  const linhas: LinhaCurvaAbc[] = ordenados.map((item) => {
    const valor = dinheiro(item.valor);

    // acumulado ANTES deste item, em Decimal: subtrair percentuais em float
    // erra a fronteira (0,95 - 0,15 da 0,7999...) e joga o item na faixa errada
    const antes = acumulado.dividedBy(total);
    acumulado = acumulado.plus(valor);

    const participacao = Number(valor.dividedBy(total).toDecimalPlaces(6));
    const acumuladoPct = Number(acumulado.dividedBy(total).toDecimalPlaces(6));

    // o corte olha o acumulado ATE o item: o item que cruza os 80% ainda e A
    const curva: 'A' | 'B' | 'C' =
      antes.lessThan(corteA) ? 'A' : antes.lessThan(corteB) ? 'B' : 'C';

    return {
      ...item,
      curva,
      valorFormatado: centavos(valor).toFixed(2),
      participacao,
      acumulado: acumuladoPct,
    };
  });

  const resumo = { ...vazio.resumo };
  for (const curva of ['A', 'B', 'C'] as const) {
    const doGrupo = linhas.filter((l) => l.curva === curva);
    const valor = doGrupo.reduce<Decimal>((soma, l) => soma.plus(dinheiro(l.valor)), new Decimal(0));
    resumo[curva] = {
      itens: doGrupo.length,
      valor: centavos(valor).toFixed(2),
      participacao: Number(valor.dividedBy(total).toDecimalPlaces(4)),
    };
  }

  return { itens: linhas, resumo, valorTotal: centavos(total).toFixed(2) };
}

// ---------------------------------------------------------------- concentracao de fornecedores

export interface GastoPorFornecedor {
  fornecedorId: string;
  fornecedor: string;
  valor: ValorMonetario;
}

export interface Concentracao {
  fornecedores: number;
  valorTotal: string;
  /** participacao do maior fornecedor, 0 a 1 */
  maiorParticipacao: number | null;
  /** participacao somada dos cinco maiores */
  top5: number | null;
  /** Herfindahl-Hirschman normalizado, 0 a 1: perto de 1 e fonte unica */
  hhi: number | null;
  risco: 'FONTE_UNICA' | 'ALTA' | 'MODERADA' | 'DILUIDA' | null;
  ranking: Array<{ fornecedorId: string; fornecedor: string; valor: string; participacao: number }>;
}

/**
 * Concentracao e risco de fonte unica (secao 10.2).
 *
 * O HHI e a soma dos quadrados das participacoes. Usa-se ele, e nao so o "maior
 * fornecedor", porque duas carteiras com o mesmo lider podem ter riscos bem
 * diferentes: 40/30/30 nao e 40/2/2/2...
 */
export function concentracaoDeFornecedores(gastos: GastoPorFornecedor[]): Concentracao {
  const total = gastos.reduce<Decimal>((soma, g) => soma.plus(dinheiro(g.valor)), new Decimal(0));

  if (gastos.length === 0 || total.lessThanOrEqualTo(0)) {
    return {
      fornecedores: gastos.length,
      valorTotal: centavos(total).toFixed(2),
      maiorParticipacao: null,
      top5: null,
      hhi: null,
      risco: null,
      ranking: [],
    };
  }

  const ranking = [...gastos]
    .map((g) => ({
      fornecedorId: g.fornecedorId,
      fornecedor: g.fornecedor,
      valorDecimal: dinheiro(g.valor),
      participacao: Number(dinheiro(g.valor).dividedBy(total).toDecimalPlaces(6)),
    }))
    .sort((a, b) => b.participacao - a.participacao);

  const hhi = Number(ranking.reduce((soma, r) => soma + r.participacao ** 2, 0).toFixed(4));
  const maior = ranking[0]!.participacao;
  const top5 = Number(ranking.slice(0, 5).reduce((soma, r) => soma + r.participacao, 0).toFixed(4));

  const risco: Concentracao['risco'] =
    ranking.length === 1 || maior >= 0.9 ? 'FONTE_UNICA' : hhi >= 0.25 ? 'ALTA' : hhi >= 0.15 ? 'MODERADA' : 'DILUIDA';

  return {
    fornecedores: ranking.length,
    valorTotal: centavos(total).toFixed(2),
    maiorParticipacao: maior,
    top5,
    hhi,
    risco,
    ranking: ranking.map(({ valorDecimal, ...r }) => ({ ...r, valor: centavos(valorDecimal).toFixed(2) })),
  };
}

// ---------------------------------------------------------------- KPIs do POP

export interface LinhaKpiCompras {
  competencia: string;
  lotes: number;
  lotesEncerrados: number;
  lotesCancelados: number;
  lotesEmergenciais: number;
  lotesComTresPropostas: number;
  lotesAcimaDeMil: number;
  lotesNoSla: number;
  lotesComSla: number;
  leadTimeAteAprovacaoDias: number | null;
  savings: ValorMonetario;
  valorNegociado: ValorMonetario;
}

export interface KpiApurado {
  valor: number | null;
  meta: number | null;
  /** true quando o valor cumpre a meta; null quando nao ha base para dizer */
  dentroDaMeta: boolean | null;
  formula: string;
}

export interface KpisCompras {
  competencia: string;
  lotes: number;
  valorNegociado: string;
  savingsValor: string;
  aderenciaSla: KpiApurado;
  taxaEmergencial: KpiApurado;
  percentualTresPropostas: KpiApurado;
  taxaCancelamento: KpiApurado;
  savings: KpiApurado;
  leadTime: KpiApurado;
}

/** Divisao que devolve null quando nao ha denominador - sem base nao ha indicador. */
const razao = (numerador: number, denominador: number): number | null =>
  denominador > 0 ? Number((numerador / denominador).toFixed(4)) : null;

/** Metas da secao 6.6. */
export function apurarKpisCompras(linha: LinhaKpiCompras): KpisCompras {
  const savingsValor = dinheiro(linha.savings);
  const negociado = dinheiro(linha.valorNegociado);

  const aderencia = razao(linha.lotesNoSla, linha.lotesComSla);
  const emergencial = razao(linha.lotesEmergenciais, linha.lotes);
  const tresPropostas = razao(linha.lotesComTresPropostas, linha.lotesAcimaDeMil);
  const cancelamento = razao(linha.lotesCancelados, linha.lotes);
  const savingsPct = negociado.greaterThan(0)
    ? Number(savingsValor.dividedBy(negociado).toDecimalPlaces(4))
    : null;

  return {
    competencia: linha.competencia,
    lotes: linha.lotes,
    valorNegociado: centavos(negociado).toFixed(2),
    savingsValor: centavos(savingsValor).toFixed(2),
    aderenciaSla: {
      valor: aderencia,
      meta: 0.9,
      dentroDaMeta: aderencia === null ? null : aderencia >= 0.9,
      formula: 'lotes aprovados dentro do SLA / lotes com SLA definido',
    },
    taxaEmergencial: {
      valor: emergencial,
      meta: 0.1,
      // aqui menor e melhor
      dentroDaMeta: emergencial === null ? null : emergencial <= 0.1,
      formula: 'lotes P1 / total de lotes da competencia',
    },
    percentualTresPropostas: {
      valor: tresPropostas,
      meta: 0.95,
      dentroDaMeta: tresPropostas === null ? null : tresPropostas >= 0.95,
      formula: 'lotes com 3 ou mais propostas respondidas / lotes acima de R$ 1.000',
    },
    taxaCancelamento: {
      valor: cancelamento,
      meta: null,
      dentroDaMeta: null,
      formula: 'lotes cancelados / total de lotes. Indicador de monitoramento, sem meta',
    },
    savings: {
      valor: savingsPct,
      meta: 0.05,
      dentroDaMeta: savingsPct === null ? null : savingsPct >= 0.05,
      formula: 'savings apurado / valor negociado',
    },
    leadTime: {
      valor: linha.leadTimeAteAprovacaoDias,
      meta: 5,
      dentroDaMeta: linha.leadTimeAteAprovacaoDias === null ? null : linha.leadTimeAteAprovacaoDias <= 5,
      formula: 'media de dias corridos entre abertura do lote e aprovacao',
    },
  };
}

// ---------------------------------------------------------------- OTIF

export interface LinhaOtif {
  fornecedorId: string;
  fornecedor: string;
  pedidos: number;
  entregues: number;
  otif: number;
  comDivergencia: number;
}

export interface ScorecardFornecedor extends LinhaOtif {
  /** entregas no prazo e completas / pedidos */
  otifPercentual: number | null;
  indiceDivergencia: number | null;
  pendentes: number;
}

/** Scorecard do fornecedor (secao 6.1.12), do pior OTIF para o melhor. */
export function scorecardDeFornecedores(linhas: LinhaOtif[]): {
  itens: ScorecardFornecedor[];
  consolidado: { pedidos: number; otifPercentual: number | null; indiceDivergencia: number | null };
} {
  const itens = linhas
    .map((l) => ({
      ...l,
      otifPercentual: razao(l.otif, l.pedidos),
      indiceDivergencia: razao(l.comDivergencia, l.pedidos),
      pendentes: l.pedidos - l.entregues,
    }))
    // pior primeiro: fornecedor sem base vai para o fim, nao para o topo do risco
    .sort((a, b) => (a.otifPercentual ?? 2) - (b.otifPercentual ?? 2));

  const pedidos = linhas.reduce((s, l) => s + l.pedidos, 0);

  return {
    itens,
    consolidado: {
      pedidos,
      otifPercentual: razao(linhas.reduce((s, l) => s + l.otif, 0), pedidos),
      indiceDivergencia: razao(linhas.reduce((s, l) => s + l.comDivergencia, 0), pedidos),
    },
  };
}

// ---------------------------------------------------------------- comparativos

export interface Variacao {
  atual: string;
  anterior: string;
  diferenca: string;
  /** variacao percentual; null quando o periodo anterior foi zero */
  percentual: number | null;
  sentido: 'ALTA' | 'QUEDA' | 'ESTAVEL';
}

/**
 * Comparativo mes a mes (secao 10.2). Base zero nao vira "aumento de 100%":
 * sair de zero para qualquer coisa e infinito, e infinito nao e informacao.
 */
export function variacao(atual: ValorMonetario, anterior: ValorMonetario): Variacao {
  const a = dinheiro(atual);
  const b = dinheiro(anterior);
  const diferenca = a.minus(b);

  return {
    atual: centavos(a).toFixed(2),
    anterior: centavos(b).toFixed(2),
    diferenca: centavos(diferenca).toFixed(2),
    percentual: b.greaterThan(0) ? Number(diferenca.dividedBy(b).toDecimalPlaces(4)) : null,
    sentido: diferenca.isZero() ? 'ESTAVEL' : diferenca.isPositive() ? 'ALTA' : 'QUEDA',
  };
}

/** Competencia anterior a uma competencia 'YYYY-MM'. */
export function competenciaAnterior(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number);
  if (!ano || !mes) throw new RangeError('Competencia deve estar no formato YYYY-MM.');
  return mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`;
}

/** Competencias do ano corrente ate a informada, para o acumulado YTD. */
export function competenciasDoAno(competencia: string): string[] {
  const [ano, mes] = competencia.split('-').map(Number);
  if (!ano || !mes) throw new RangeError('Competencia deve estar no formato YYYY-MM.');
  return Array.from({ length: mes }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
}

// ---------------------------------------------------------------- estoque

export interface LinhaPosicaoEstoque {
  itemId: string;
  codigo: string;
  descricao: string;
  valor: ValorMonetario;
  diasSemGiro: number | null;
}

export interface ResumoEstoque {
  itens: number;
  valorTotal: string;
  valorSemGiro: string;
  /** valor parado / valor total, 0 a 1 */
  percentualSemGiro: number | null;
  itensSemGiro: number;
}

/** Valor imobilizado e obsolescencia (secoes 8.5 e 10.1). */
export function resumirEstoque(linhas: LinhaPosicaoEstoque[], diasSemGiro: number): ResumoEstoque {
  const total = linhas.reduce<Decimal>((s, l) => s.plus(dinheiro(l.valor)), new Decimal(0));
  const parados = linhas.filter((l) => l.diasSemGiro !== null && l.diasSemGiro > diasSemGiro);
  const valorParado = parados.reduce<Decimal>((s, l) => s.plus(dinheiro(l.valor)), new Decimal(0));

  return {
    itens: linhas.length,
    valorTotal: centavos(total).toFixed(2),
    valorSemGiro: centavos(valorParado).toFixed(2),
    percentualSemGiro: total.greaterThan(0) ? Number(valorParado.dividedBy(total).toDecimalPlaces(4)) : null,
    itensSemGiro: parados.length,
  };
}
