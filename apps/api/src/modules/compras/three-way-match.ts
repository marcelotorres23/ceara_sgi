import { Decimal, centavos, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Three-way match: pedido x NF-e x fisico (secao 6.1.10).
 * Modulo puro - sem I/O, sem configuracao. A tolerancia de preco vem do parametro
 * `compras.tolerancia_divergencia_preco_nfe` e e passada pelo chamador.
 *
 * Regra de ouro 4: nenhum titulo vai para contas a pagar sem aceite de recebimento
 * vinculado ao pedido. E item com divergencia tem o pagamento retido - nao o pedido inteiro.
 */

export type TipoDivergencia =
  | 'QUANTIDADE_MENOR'
  | 'QUANTIDADE_MAIOR'
  | 'PRECO_ACIMA_TOLERANCIA'
  | 'ESPECIFICACAO'
  | 'AVARIA'
  | 'DOCUMENTACAO';

export interface ItemDoPedido {
  pedidoItemId: string;
  descricao: string;
  quantidadePedida: ValorMonetario;
  /** ja recebido em conferencias anteriores */
  quantidadeJaRecebida?: ValorMonetario;
  precoUnitario: ValorMonetario;
}

export interface ItemConferido {
  pedidoItemId: string;
  quantidadeRecebida: ValorMonetario;
  /** preco que veio na NF-e; ausente = mesmo do pedido */
  precoNotaFiscal?: ValorMonetario | null;
  /** divergencia apontada pelo conferente, alem das apuradas automaticamente */
  divergenciaManual?: 'ESPECIFICACAO' | 'AVARIA' | 'DOCUMENTACAO' | null;
  observacao?: string | null;
}

export interface ResultadoItem {
  pedidoItemId: string;
  descricao: string;
  quantidadePedida: Decimal;
  quantidadeRecebida: Decimal;
  quantidadeAcumulada: Decimal;
  quantidadePendente: Decimal;
  precoPedido: Decimal;
  precoNotaFiscal: Decimal;
  variacaoPreco: Decimal;
  conforme: boolean;
  tipoDivergencia: TipoDivergencia | null;
  /** item divergente tem o pagamento retido ate a tratativa */
  pagamentoRetido: boolean;
  valorLiberado: Decimal;
  valorRetido: Decimal;
  observacao: string | null;
}

export type StatusRecebimento = 'EM_CONFERENCIA' | 'ACEITE_TOTAL' | 'ACEITE_PARCIAL' | 'RECUSADO';

export interface ResultadoMatch {
  itens: ResultadoItem[];
  status: StatusRecebimento;
  /** true so quando pedido, NF-e e fisico batem em todos os itens */
  threeWayOk: boolean;
  /** ha item ainda pendente de entrega */
  entregaPendente: boolean;
  valorConferido: Decimal;
  valorLiberado: Decimal;
  valorRetido: Decimal;
  divergencias: TipoDivergencia[];
  /** divergencia de preco acima da tolerancia bloqueia e devolve ao comprador (secao 6.1.11) */
  bloqueiaEntradaFiscal: boolean;
  motivoBloqueio: string | null;
}

/**
 * Confere um item. A ordem de precedencia da divergencia importa: a apontada pelo
 * conferente (avaria, especificacao, documentacao) vem primeiro, porque e observacao
 * fisica; depois preco; por ultimo quantidade.
 */
export function conferirItem(
  pedido: ItemDoPedido,
  conferido: ItemConferido,
  toleranciaPreco: ValorMonetario,
): ResultadoItem {
  const quantidadePedida = dinheiro(pedido.quantidadePedida);
  const jaRecebida = dinheiro(pedido.quantidadeJaRecebida ?? 0);
  const quantidadeRecebida = dinheiro(conferido.quantidadeRecebida);

  if (quantidadeRecebida.isNegative()) {
    throw new RangeError('Quantidade recebida nao pode ser negativa.');
  }

  const acumulada = jaRecebida.plus(quantidadeRecebida);
  const pendente = Decimal.max(quantidadePedida.minus(acumulada), new Decimal(0));

  const precoPedido = dinheiro(pedido.precoUnitario);
  const precoNota = conferido.precoNotaFiscal == null ? precoPedido : dinheiro(conferido.precoNotaFiscal);

  const variacao = precoPedido.isZero()
    ? new Decimal(0)
    : precoNota.minus(precoPedido).dividedBy(precoPedido).toDecimalPlaces(6);

  let tipo: TipoDivergencia | null = null;

  if (conferido.divergenciaManual) {
    tipo = conferido.divergenciaManual;
  } else if (variacao.greaterThan(dinheiro(toleranciaPreco))) {
    // so preco ACIMA do pedido e divergencia: cobranca a maior. Preco menor e desconto.
    tipo = 'PRECO_ACIMA_TOLERANCIA';
  } else if (acumulada.greaterThan(quantidadePedida)) {
    tipo = 'QUANTIDADE_MAIOR';
  } else if (acumulada.lessThan(quantidadePedida)) {
    tipo = 'QUANTIDADE_MENOR';
  }

  const conforme = tipo === null;

  /**
   * Entrega parcial nao retem pagamento: paga-se o que chegou conforme.
   * Retencao vale para cobranca a maior, avaria, especificacao errada e documentacao.
   */
  const retemPagamento =
    tipo !== null && tipo !== 'QUANTIDADE_MENOR';

  const valorConferido = centavos(quantidadeRecebida.times(precoNota));

  return {
    pedidoItemId: pedido.pedidoItemId,
    descricao: pedido.descricao,
    quantidadePedida,
    quantidadeRecebida,
    quantidadeAcumulada: acumulada,
    quantidadePendente: pendente,
    precoPedido,
    precoNotaFiscal: precoNota,
    variacaoPreco: variacao,
    conforme,
    tipoDivergencia: tipo,
    pagamentoRetido: retemPagamento,
    valorLiberado: retemPagamento ? new Decimal(0) : valorConferido,
    valorRetido: retemPagamento ? valorConferido : new Decimal(0),
    observacao: conferido.observacao ?? null,
  };
}

/**
 * Consolida a conferencia do recebimento inteiro.
 * `RECUSADO` quando nada foi aceito; `ACEITE_PARCIAL` quando ha item pendente ou
 * divergente; `ACEITE_TOTAL` so quando tudo bate.
 */
export function conferirRecebimento(
  itensPedido: ItemDoPedido[],
  conferidos: ItemConferido[],
  toleranciaPreco: ValorMonetario,
): ResultadoMatch {
  if (itensPedido.length === 0) throw new RangeError('Pedido sem itens para conferir.');

  const porId = new Map(itensPedido.map((i) => [i.pedidoItemId, i]));
  const itens: ResultadoItem[] = [];

  for (const c of conferidos) {
    const pedido = porId.get(c.pedidoItemId);
    if (!pedido) throw new RangeError(`Item ${c.pedidoItemId} nao pertence a este pedido.`);
    itens.push(conferirItem(pedido, c, toleranciaPreco));
  }

  // item do pedido nao conferido continua pendente de entrega
  const naoConferidos = itensPedido.filter((i) => !conferidos.some((c) => c.pedidoItemId === i.pedidoItemId));
  const pendentePorOmissao = naoConferidos.some((i) =>
    dinheiro(i.quantidadePedida).greaterThan(dinheiro(i.quantidadeJaRecebida ?? 0)),
  );

  const valorConferido = itens.reduce<Decimal>((a, i) => a.plus(i.valorLiberado).plus(i.valorRetido), new Decimal(0));
  const valorLiberado = itens.reduce<Decimal>((a, i) => a.plus(i.valorLiberado), new Decimal(0));
  const valorRetido = itens.reduce<Decimal>((a, i) => a.plus(i.valorRetido), new Decimal(0));

  const divergencias = [...new Set(itens.map((i) => i.tipoDivergencia).filter((t): t is TipoDivergencia => t !== null))];
  const entregaPendente = pendentePorOmissao || itens.some((i) => i.quantidadePendente.greaterThan(0));

  const nadaRecebido = itens.every((i) => i.quantidadeRecebida.isZero());
  const tudoConforme = itens.length > 0 && itens.every((i) => i.conforme);

  let status: StatusRecebimento;
  if (itens.length === 0 || nadaRecebido) status = 'RECUSADO';
  else if (tudoConforme && !entregaPendente) status = 'ACEITE_TOTAL';
  else status = 'ACEITE_PARCIAL';

  const precoDivergente = divergencias.includes('PRECO_ACIMA_TOLERANCIA');

  return {
    itens,
    status,
    threeWayOk: status === 'ACEITE_TOTAL',
    entregaPendente,
    valorConferido: centavos(valorConferido),
    valorLiberado: centavos(valorLiberado),
    valorRetido: centavos(valorRetido),
    divergencias,
    bloqueiaEntradaFiscal: precoDivergente,
    motivoBloqueio: precoDivergente
      ? 'Divergencia de preco na NF-e acima da tolerancia. Devolvido ao comprador para tratativa.'
      : null,
  };
}

/**
 * Regra de ouro 4: o titulo so pode nascer com aceite de recebimento vinculado ao pedido.
 * Recusa integral nao gera titulo. Bloqueio fiscal impede a geracao ate a tratativa.
 */
export function podeGerarTitulo(match: Pick<ResultadoMatch, 'status' | 'bloqueiaEntradaFiscal' | 'valorLiberado'>): {
  pode: boolean;
  motivo?: string;
} {
  if (match.status === 'RECUSADO') {
    return { pode: false, motivo: 'Recebimento recusado nao gera titulo.' };
  }
  if (match.status === 'EM_CONFERENCIA') {
    return { pode: false, motivo: 'Conclua a conferencia antes de lancar a entrada fiscal.' };
  }
  if (match.bloqueiaEntradaFiscal) {
    return { pode: false, motivo: 'Divergencia de preco acima da tolerancia bloqueia a entrada fiscal.' };
  }
  if (match.valorLiberado.lessThanOrEqualTo(0)) {
    return { pode: false, motivo: 'Nenhum valor liberado para pagamento neste recebimento.' };
  }
  return { pode: true };
}

/**
 * Prazo maximo de 48h entre o recebimento fisico e a entrada fiscal (secao 6.1.11).
 * Horas corridas, nao uteis: o indicador do POP fala em 48h de calendario.
 */
export function atrasoEntradaFiscal(
  recebidoEm: Date,
  fiscalEm: Date | null,
  agora = new Date(),
  limiteHoras = 48,
): { horas: number; dentroDoPrazo: boolean } {
  const referencia = fiscalEm ?? agora;
  const horas = Math.round(((referencia.getTime() - recebidoEm.getTime()) / 3_600_000) * 100) / 100;
  return { horas, dentroDoPrazo: horas <= limiteHoras };
}
