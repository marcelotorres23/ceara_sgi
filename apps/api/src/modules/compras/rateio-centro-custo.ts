import { Decimal, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Rateio do gasto de um lote entre os centros de custo das suas solicitacoes.
 *
 * Cada placa e um centro de custo (secao 5.4): o aprovador precisa ver quanto ja foi
 * comprado para AQUELA placa, e nao apenas o total do lote. O lote, porem, pode agrupar
 * solicitacoes de placas diferentes - foi para isso que a triagem existe.
 *
 * Regra: lote de um centro so vai inteiro para ele. Lote misto rateia pelo peso de cada
 * solicitacao, e o resultado sai marcado como rateado para a tela nao apresentar
 * estimativa como se fosse valor apurado.
 *
 * Modulo puro, sem I/O.
 */

export interface PesoDeSolicitacao {
  solicitacaoId: string;
  centroCustoId: string;
  /** peso do rateio: quantidade de itens da solicitacao (proxy do consumo do lote) */
  peso: number;
}

export interface ParcelaDeCentro {
  centroCustoId: string;
  valor: Decimal;
  /** true quando o valor e estimativa por rateio, nao gasto apurado do centro */
  rateado: boolean;
}

/**
 * Distribui `valor` entre os centros, preservando a soma ao centavo.
 *
 * A sobra da divisao vai para o centro de maior parcela: dividir R$ 100,00 por tres
 * daria 33,33 x 3 = 99,99, e um centavo perdido em todo lote misto desalinha o
 * historico do centro com o total comprado.
 */
export function ratearLote(valor: ValorMonetario, pesos: PesoDeSolicitacao[]): ParcelaDeCentro[] {
  const total = dinheiro(valor).toDecimalPlaces(2);
  if (pesos.length === 0) return [];

  const centros = [...new Set(pesos.map((p) => p.centroCustoId))];
  if (centros.length === 1) {
    return [{ centroCustoId: centros[0]!, valor: total, rateado: false }];
  }

  const pesoPorCentro = new Map<string, number>();
  for (const p of pesos) {
    pesoPorCentro.set(p.centroCustoId, (pesoPorCentro.get(p.centroCustoId) ?? 0) + Math.max(p.peso, 0));
  }

  const somaPesos = [...pesoPorCentro.values()].reduce((a, b) => a + b, 0);
  // sem peso util (toda solicitacao sem item), divide em partes iguais em vez de zerar tudo
  const fatia = (peso: number): Decimal =>
    somaPesos > 0
      ? total.times(peso).dividedBy(somaPesos).toDecimalPlaces(2)
      : total.dividedBy(centros.length).toDecimalPlaces(2);

  const parcelas: ParcelaDeCentro[] = [...pesoPorCentro.entries()].map(([centroCustoId, peso]) => ({
    centroCustoId,
    valor: fatia(peso),
    rateado: true,
  }));

  const sobra = total.minus(parcelas.reduce<Decimal>((acc, p) => acc.plus(p.valor), new Decimal(0)));
  if (!sobra.isZero()) {
    const maior = parcelas.reduce((a, b) => (a.valor.greaterThanOrEqualTo(b.valor) ? a : b));
    maior.valor = maior.valor.plus(sobra);
  }

  return parcelas;
}

export interface GastoMensal {
  /** competencia no formato AAAA-MM */
  mes: string;
  valor: Decimal;
  pedidos: number;
}

/** Serie mensal do centro, para a tela mostrar tendencia sem calculo no front. */
export function agruparPorMes(
  lancamentos: Array<{ data: Date; valor: ValorMonetario }>,
): GastoMensal[] {
  const mapa = new Map<string, { valor: Decimal; pedidos: number }>();

  for (const l of lancamentos) {
    const mes = `${l.data.getUTCFullYear()}-${String(l.data.getUTCMonth() + 1).padStart(2, '0')}`;
    const atual = mapa.get(mes) ?? { valor: new Decimal(0), pedidos: 0 };
    mapa.set(mes, { valor: atual.valor.plus(dinheiro(l.valor)), pedidos: atual.pedidos + 1 });
  }

  return [...mapa.entries()]
    .map(([mes, v]) => ({ mes, valor: v.valor.toDecimalPlaces(2), pedidos: v.pedidos }))
    .sort((a, b) => a.mes.localeCompare(b.mes));
}

/**
 * Consumo do orcamento mensal do centro no mes corrente.
 * Sem orcamento cadastrado nao ha percentual - e melhor omitir que inventar base.
 */
export function consumoDoOrcamento(
  gastoDoMes: ValorMonetario,
  orcamentoMensal: ValorMonetario | null,
): { percentual: number | null; estourou: boolean } {
  if (orcamentoMensal === null) return { percentual: null, estourou: false };
  const orcamento = dinheiro(orcamentoMensal);
  if (orcamento.lessThanOrEqualTo(0)) return { percentual: null, estourou: false };
  const percentual = dinheiro(gastoDoMes).dividedBy(orcamento).toDecimalPlaces(4).toNumber();
  return { percentual, estourou: percentual > 1 };
}
