import { Decimal, centavos, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Mapa de cotacao comparado por VALOR PRESENTE, nao por valor de face (secao 6.1.6).
 *
 *   VP = valor_liquido / (1 + taxa_mensal) ^ (prazo_dias / 30)
 *
 * Modulo puro: sem I/O, sem configuracao. A taxa vem do parametro
 * `compras.taxa_mensal_valor_presente` e e passada pelo chamador.
 */

export interface PropostaParaComparar {
  cotacaoId: string;
  fornecedorNome: string;
  /** soma dos itens (preco unitario x quantidade) */
  valorItens: ValorMonetario;
  /** frete cobrado; em FOB o valor entra igual, pois e desembolso do comprador */
  freteValor?: ValorMonetario | null;
  /** desconto concedido para pagamento a vista */
  descontoAvista?: ValorMonetario | null;
  /** prazo de pagamento em dias; 0 = a vista */
  prazoDias: number;
  /** prazo de entrega, usado como criterio de desempate */
  prazoEntregaDias?: number | null;
  recusada?: boolean;
}

export interface PropostaAvaliada extends PropostaParaComparar {
  valorLiquido: Decimal;
  valorPresente: Decimal;
  /** 1 = melhor valor presente */
  posicao: number;
  /** diferenca percentual em relacao ao melhor VP, positiva */
  diferencaPercentual: Decimal;
}

/** valor_liquido = itens + frete - desconto a vista */
export function calcularValorLiquido(p: PropostaParaComparar): Decimal {
  return centavos(
    dinheiro(p.valorItens)
      .plus(dinheiro(p.freteValor ?? 0))
      .minus(dinheiro(p.descontoAvista ?? 0)),
  );
}

/**
 * Desconta o valor liquido ate a data de hoje pelo prazo de pagamento.
 * Prazo maior com mesmo valor de face significa VP menor - o dinheiro fica mais tempo em caixa.
 */
export function calcularValorPresente(
  valorLiquido: ValorMonetario,
  taxaMensal: ValorMonetario,
  prazoDias: number,
): Decimal {
  if (prazoDias < 0) throw new RangeError('prazoDias nao pode ser negativo.');

  const taxa = dinheiro(taxaMensal);
  if (taxa.isNegative()) throw new RangeError('taxaMensal nao pode ser negativa.');

  // taxa zero ou pagamento a vista: nao ha desconto financeiro a aplicar
  if (taxa.isZero() || prazoDias === 0) return centavos(valorLiquido);

  const expoente = new Decimal(prazoDias).dividedBy(30);
  const fator = new Decimal(1).plus(taxa).pow(expoente);
  return centavos(dinheiro(valorLiquido).dividedBy(fator));
}

/**
 * Ordena as propostas por valor presente crescente. Empate no VP e resolvido pelo
 * menor prazo de entrega; persistindo, pelo menor valor liquido.
 * Propostas recusadas ficam fora do ranking.
 */
export function montarRanking(
  propostas: PropostaParaComparar[],
  taxaMensal: ValorMonetario,
): PropostaAvaliada[] {
  const avaliadas = propostas
    .filter((p) => !p.recusada)
    .map((p) => {
      const valorLiquido = calcularValorLiquido(p);
      return {
        ...p,
        valorLiquido,
        valorPresente: calcularValorPresente(valorLiquido, taxaMensal, p.prazoDias),
        posicao: 0,
        diferencaPercentual: new Decimal(0),
      };
    });

  avaliadas.sort((a, b) => {
    const porVp = a.valorPresente.comparedTo(b.valorPresente);
    if (porVp !== 0) return porVp;
    const entregaA = a.prazoEntregaDias ?? Number.MAX_SAFE_INTEGER;
    const entregaB = b.prazoEntregaDias ?? Number.MAX_SAFE_INTEGER;
    if (entregaA !== entregaB) return entregaA - entregaB;
    return a.valorLiquido.comparedTo(b.valorLiquido);
  });

  const melhor = avaliadas[0]?.valorPresente;
  return avaliadas.map((p, i) => ({
    ...p,
    posicao: i + 1,
    diferencaPercentual:
      melhor && !melhor.isZero()
        ? p.valorPresente.minus(melhor).dividedBy(melhor).times(100).toDecimalPlaces(4)
        : new Decimal(0),
  }));
}

/**
 * A escolha diverge do menor preco quando a cotacao escolhida nao e a de menor
 * VALOR DE FACE (valor liquido). O criterio e o preco, nao o ranking de VP:
 * escolher a de melhor VP mas maior valor de face ainda e uma divergencia que
 * o aprovador precisa enxergar, e que sobe um nivel de alcada (secao 6.4).
 */
export function ehEscolhaDivergente(avaliadas: PropostaAvaliada[], cotacaoEscolhidaId: string): boolean {
  if (avaliadas.length === 0) return false;
  const menorFace = avaliadas.reduce((min, p) => (p.valorLiquido.lessThan(min.valorLiquido) ? p : min));
  return menorFace.cotacaoId !== cotacaoEscolhidaId;
}

/** Savings = (base - fechado) / base, onde base e o maior valor liquido cotado (secao 6.6). */
export function calcularSavings(avaliadas: PropostaAvaliada[], cotacaoEscolhidaId: string): Decimal {
  const escolhida = avaliadas.find((p) => p.cotacaoId === cotacaoEscolhidaId);
  if (!escolhida || avaliadas.length < 2) return new Decimal(0);
  const base = avaliadas.reduce((max, p) => (p.valorLiquido.greaterThan(max.valorLiquido) ? p : max));
  return centavos(base.valorLiquido.minus(escolhida.valorLiquido));
}
