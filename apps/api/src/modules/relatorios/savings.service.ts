import { prisma } from '../../core/db.js';
import { Decimal, centavos, dinheiro } from '../../core/money.js';

/**
 * Savings por comprador e por lote (secao 10.2), com memoria de calculo.
 *
 * A base do savings e a **maior proposta respondida** do lote, nao um preco de
 * referencia externo: o que o comprador evitou de gastar foi a diferenca entre o
 * que pagaria na pior proposta que ele mesmo levantou e o que fechou. Por isso
 * lote com uma proposta so tem savings zero - sem comparacao, nao ha economia
 * demonstravel, e inventar uma base transformaria o indicador em ficcao.
 *
 * O calculo em si vive em `compras/valor-presente.ts` e e gravado em `lotes.savings`
 * no momento do mapa. Aqui so se consolida o que ja foi apurado.
 */

export interface SavingsDoComprador {
  compradorId: string;
  comprador: string;
  lotes: number;
  /** lotes com mais de uma proposta respondida - os unicos onde ha o que economizar */
  lotesComparaveis: number;
  valorNegociado: string;
  savings: string;
  /** savings / valor negociado; null quando nao houve valor negociado */
  percentual: number | null;
  /** true quando atingiu a meta de 5% da secao 6.6 */
  dentroDaMeta: boolean | null;
}

export interface SavingsDoLote {
  loteId: string;
  numero: string;
  comprador: string;
  competencia: string;
  propostasRespondidas: number;
  /** maior proposta: a base de comparacao */
  base: string | null;
  fechado: string | null;
  savings: string;
  percentual: number | null;
  escolhaDivergente: boolean;
  justificativa: string | null;
}

const META_SAVINGS = 0.05;

const percentualDe = (savings: Decimal, negociado: Decimal): number | null =>
  negociado.greaterThan(0) ? Number(savings.dividedBy(negociado).toDecimalPlaces(4)) : null;

/**
 * Consolida por comprador na competencia. Lote sem valor fechado ainda nao tem
 * savings apurado e nao entra na conta - so distorceria o percentual para baixo.
 */
export async function savingsPorComprador(unidades: string[], competencia: string) {
  const inicio = new Date(`${competencia}-01T00:00:00Z`);
  const fim = new Date(inicio);
  fim.setUTCMonth(fim.getUTCMonth() + 1);

  const lotes = await prisma.lote.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['CANCELADO', 'REPROVADO'] },
      aprovadoEm: { gte: inicio, lt: fim },
      ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}),
    },
    select: {
      id: true,
      savings: true,
      valorFechado: true,
      valorEstimado: true,
      compradorId: true,
      comprador: { select: { nome: true } },
      _count: { select: { cotacoes: true } },
      cotacoes: { where: { deletedAt: null, respondidaEm: { not: null }, recusada: false }, select: { id: true } },
    },
  });

  const grupos = new Map<string, { comprador: string; lotes: number; comparaveis: number; negociado: Decimal; savings: Decimal }>();

  for (const l of lotes) {
    const atual = grupos.get(l.compradorId) ?? {
      comprador: l.comprador.nome,
      lotes: 0,
      comparaveis: 0,
      negociado: new Decimal(0),
      savings: new Decimal(0),
    };

    atual.lotes += 1;
    if (l.cotacoes.length > 1) atual.comparaveis += 1;
    atual.negociado = atual.negociado.plus(dinheiro((l.valorFechado ?? l.valorEstimado ?? 0).toString()));
    atual.savings = atual.savings.plus(dinheiro((l.savings ?? 0).toString()));

    grupos.set(l.compradorId, atual);
  }

  const itens: SavingsDoComprador[] = [...grupos.entries()]
    .map(([compradorId, g]) => {
      const percentual = percentualDe(g.savings, g.negociado);
      return {
        compradorId,
        comprador: g.comprador,
        lotes: g.lotes,
        lotesComparaveis: g.comparaveis,
        valorNegociado: centavos(g.negociado).toFixed(2),
        savings: centavos(g.savings).toFixed(2),
        percentual,
        dentroDaMeta: percentual === null ? null : percentual >= META_SAVINGS,
      };
    })
    .sort((a, b) => Number(b.savings) - Number(a.savings));

  const negociadoTotal = [...grupos.values()].reduce<Decimal>((s, g) => s.plus(g.negociado), new Decimal(0));
  const savingsTotal = [...grupos.values()].reduce<Decimal>((s, g) => s.plus(g.savings), new Decimal(0));

  return {
    competencia,
    itens,
    total: {
      lotes: lotes.length,
      lotesComparaveis: lotes.filter((l) => l.cotacoes.length > 1).length,
      valorNegociado: centavos(negociadoTotal).toFixed(2),
      savings: centavos(savingsTotal).toFixed(2),
      percentual: percentualDe(savingsTotal, negociadoTotal),
      meta: META_SAVINGS,
    },
    memoriaDeCalculo: {
      base: 'maior proposta respondida do lote - o que se pagaria na pior alternativa levantada',
      savings: 'base - valor fechado, apurado no momento do mapa e gravado no lote',
      semComparacao: 'lote com uma unica proposta tem savings zero: sem alternativa nao ha economia demonstravel',
      percentual: 'savings / valor negociado no periodo · meta de 5% (secao 6.6)',
      recorte: 'lotes aprovados na competencia, exceto cancelados e reprovados',
    },
  };
}

/** Detalhe por lote, para a memoria de calculo aparecer ao lado do numero. */
export async function savingsPorLote(unidades: string[], competencia: string): Promise<SavingsDoLote[]> {
  const inicio = new Date(`${competencia}-01T00:00:00Z`);
  const fim = new Date(inicio);
  fim.setUTCMonth(fim.getUTCMonth() + 1);

  const lotes = await prisma.lote.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['CANCELADO', 'REPROVADO'] },
      aprovadoEm: { gte: inicio, lt: fim },
      ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}),
    },
    include: {
      comprador: { select: { nome: true } },
      cotacoes: {
        where: { deletedAt: null, respondidaEm: { not: null }, recusada: false },
        include: { itens: true },
      },
      mapas: { orderBy: { geradoEm: 'desc' }, take: 1 },
    },
    orderBy: { aprovadoEm: 'desc' },
  });

  return lotes.map((l) => {
    // a base e reconstruida das propostas: e ela que explica o numero gravado
    const valores = l.cotacoes.map((c) =>
      c.itens.reduce<Decimal>(
        (soma, i) => soma.plus(dinheiro(i.precoUnitario.toString()).times(dinheiro(i.quantidade.toString()))),
        new Decimal(0),
      ),
    );

    const base = valores.length > 1 ? valores.reduce((max, v) => (v.greaterThan(max) ? v : max)) : null;
    const savings = dinheiro((l.savings ?? 0).toString());
    const fechado = l.valorFechado ? dinheiro(l.valorFechado.toString()) : null;

    return {
      loteId: l.id,
      numero: l.numero,
      comprador: l.comprador.nome,
      competencia,
      propostasRespondidas: l.cotacoes.length,
      base: base ? centavos(base).toFixed(2) : null,
      fechado: fechado ? centavos(fechado).toFixed(2) : null,
      savings: centavos(savings).toFixed(2),
      percentual: fechado ? percentualDe(savings, fechado) : null,
      escolhaDivergente: l.mapas[0]?.divergenteMenorPreco ?? false,
      justificativa: l.mapas[0]?.justificativa ?? null,
    };
  });
}
