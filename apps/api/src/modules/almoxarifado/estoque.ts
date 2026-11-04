import { Decimal, centavos, dinheiro, emPtBr, type ValorMonetario } from '../../core/money.js';

/**
 * Regras de estoque (secao 8). Modulo puro - sem I/O, sem configuracao.
 * Quantidade em 4 casas decimais; dinheiro arredondado so na apresentacao do valor total.
 */

export type TipoMovimentacao =
  | 'ENTRADA_COMPRA' | 'ENTRADA_DEVOLUCAO' | 'ENTRADA_TRANSFERENCIA' | 'ENTRADA_AJUSTE' | 'ENTRADA_ESTORNO'
  | 'SAIDA_REQUISICAO' | 'SAIDA_TRANSFERENCIA' | 'SAIDA_AJUSTE' | 'SAIDA_DESCARTE' | 'SAIDA_ESTORNO';

export const ehEntrada = (tipo: TipoMovimentacao): boolean => tipo.startsWith('ENTRADA_');

export interface PosicaoEstoque {
  quantidade: Decimal;
  custoMedio: Decimal;
}

/**
 * Custo medio ponderado movel, recalculado a cada ENTRADA (secao 8.1):
 *
 *   custo_medio = (saldo_atual x custo_atual + entrada x custo_entrada) / (saldo_atual + entrada)
 *
 * Saida NAO altera o custo medio - consome pelo custo vigente.
 */
export function aplicarEntrada(
  atual: PosicaoEstoque,
  quantidade: ValorMonetario,
  custoUnitario: ValorMonetario,
): PosicaoEstoque {
  const q = dinheiro(quantidade);
  const c = dinheiro(custoUnitario);

  if (q.lessThanOrEqualTo(0)) throw new RangeError('Quantidade de entrada precisa ser maior que zero.');
  if (c.isNegative()) throw new RangeError('Custo unitario nao pode ser negativo.');

  const novoSaldo = atual.quantidade.plus(q);

  // saldo anterior zerado ou negativo: o custo passa a ser o da entrada, sem media
  if (atual.quantidade.lessThanOrEqualTo(0)) {
    return { quantidade: novoSaldo, custoMedio: c.toDecimalPlaces(4) };
  }

  const valorAtual = atual.quantidade.times(atual.custoMedio);
  const valorEntrada = q.times(c);
  const custoMedio = valorAtual.plus(valorEntrada).dividedBy(novoSaldo).toDecimalPlaces(4);

  return { quantidade: novoSaldo, custoMedio };
}

/** Saida consome pelo custo medio vigente e nunca deixa o saldo negativo (secao 11). */
export function aplicarSaida(atual: PosicaoEstoque, quantidade: ValorMonetario): PosicaoEstoque {
  const q = dinheiro(quantidade);
  if (q.lessThanOrEqualTo(0)) throw new RangeError('Quantidade de saida precisa ser maior que zero.');

  if (q.greaterThan(atual.quantidade)) {
    throw new RangeError(
      `Saldo insuficiente: disponivel ${atual.quantidade.toFixed(4)}, solicitado ${q.toFixed(4)}.`,
    );
  }

  return { quantidade: atual.quantidade.minus(q), custoMedio: atual.custoMedio };
}

export const valorEmEstoque = (posicao: PosicaoEstoque): Decimal =>
  centavos(posicao.quantidade.times(posicao.custoMedio));

// ---------------------------------------------------------------- ponto de pedido

export interface ParametrosReposicao {
  consumoMedioMensal: ValorMonetario;
  leadTimeDias: number;
  /** margem de seguranca em dias de consumo; padrao 30% do lead time */
  diasSeguranca?: number;
}

/**
 * PP = (consumo_medio_diario x lead_time_dias) + estoque_seguranca  (secao 8.3).
 * O sistema SUGERE; o gestor confirma. Nunca sobrescreve valor definido manualmente.
 */
export function sugerirPontoPedido(p: ParametrosReposicao): {
  consumoMedioDiario: Decimal;
  estoqueSeguranca: Decimal;
  pontoPedido: Decimal;
} {
  if (p.leadTimeDias < 0) throw new RangeError('Lead time nao pode ser negativo.');

  const consumoMedioDiario = dinheiro(p.consumoMedioMensal).dividedBy(30).toDecimalPlaces(4);
  const diasSeguranca = p.diasSeguranca ?? Math.ceil(p.leadTimeDias * 0.3);
  const estoqueSeguranca = consumoMedioDiario.times(diasSeguranca).toDecimalPlaces(4);
  const pontoPedido = consumoMedioDiario.times(p.leadTimeDias).plus(estoqueSeguranca).toDecimalPlaces(4);

  return { consumoMedioDiario, estoqueSeguranca, pontoPedido };
}

/** cobertura = saldo / consumo_medio_diario, em dias (secao 8.3). */
export function coberturaEmDias(saldo: ValorMonetario, consumoMedioMensal: ValorMonetario): number | null {
  const diario = dinheiro(consumoMedioMensal).dividedBy(30);
  // sem consumo nao ha cobertura a calcular - o item nao gira
  if (diario.lessThanOrEqualTo(0)) return null;
  return Number(dinheiro(saldo).dividedBy(diario).toDecimalPlaces(1));
}

// ---------------------------------------------------------------- painel de alertas

export type NivelAlerta =
  | 'RUPTURA'
  | 'ABAIXO_DO_MINIMO'
  | 'NO_PONTO_DE_PEDIDO'
  | 'COBERTURA_BAIXA'
  | 'EXCESSO'
  | 'SEM_GIRO'
  | 'NORMAL';

export interface LinhaEstoque {
  itemId: string;
  codigo: string;
  descricao: string;
  almoxarifado: string;
  critico: boolean;
  saldo: ValorMonetario;
  custoMedio: ValorMonetario;
  estoqueMinimo: ValorMonetario;
  estoqueMaximo?: ValorMonetario | null;
  pontoPedido: ValorMonetario;
  loteEconomico?: ValorMonetario | null;
  leadTimeDias: number;
  consumoMedioMensal: ValorMonetario;
  ultimaMovimentacaoEm?: Date | null;
}

export interface AlertaEstoque {
  itemId: string;
  codigo: string;
  descricao: string;
  /** de qual almoxarifado e este saldo - o mesmo item aparece em varios */
  almoxarifado: string;
  nivel: NivelAlerta;
  /// vermelho, amarelo, azul, preto ou verde, conforme o semaforo da secao 8.3
  semaforo: 'vermelho' | 'amarelo' | 'azul' | 'preto' | 'verde';
  mensagem: string;
  saldo: string;
  cobertura: number | null;
  /** quantidade sugerida para repor: lote economico, ou o que falta ate o maximo */
  quantidadeSugerida: string;
  valorImobilizado: string;
}

const SEMAFORO: Record<NivelAlerta, AlertaEstoque['semaforo']> = {
  RUPTURA: 'vermelho',
  ABAIXO_DO_MINIMO: 'vermelho',
  NO_PONTO_DE_PEDIDO: 'amarelo',
  COBERTURA_BAIXA: 'amarelo',
  EXCESSO: 'azul',
  SEM_GIRO: 'preto',
  NORMAL: 'verde',
};

/**
 * Classifica a linha no semaforo do painel de alertas (secao 8.3).
 * A ordem de precedencia importa: ruptura de item critico e o pior caso e vem primeiro.
 */
export function classificar(linha: LinhaEstoque, diasSemGiro: number, agora = new Date()): AlertaEstoque {
  const saldo = dinheiro(linha.saldo);
  const cobertura = coberturaEmDias(saldo, linha.consumoMedioMensal);

  const diasParado = linha.ultimaMovimentacaoEm
    ? Math.floor((agora.getTime() - linha.ultimaMovimentacaoEm.getTime()) / 86_400_000)
    : null;

  let nivel: NivelAlerta = 'NORMAL';
  let mensagem = 'Dentro dos parametros.';

  if (saldo.lessThanOrEqualTo(0) && linha.critico) {
    nivel = 'RUPTURA';
    mensagem = 'Item critico com saldo zero. Ruptura em curso.';
  } else if (saldo.lessThan(dinheiro(linha.estoqueMinimo))) {
    nivel = 'ABAIXO_DO_MINIMO';
    mensagem = `Saldo ${emPtBr(saldo)} abaixo do minimo ${emPtBr(linha.estoqueMinimo)}.`;
  } else if (saldo.lessThanOrEqualTo(dinheiro(linha.pontoPedido)) && dinheiro(linha.pontoPedido).greaterThan(0)) {
    nivel = 'NO_PONTO_DE_PEDIDO';
    mensagem = 'Saldo atingiu o ponto de pedido. Hora de repor.';
  } else if (cobertura !== null && cobertura < linha.leadTimeDias) {
    nivel = 'COBERTURA_BAIXA';
    mensagem = `Cobertura de ${cobertura} dias e menor que o lead time de ${linha.leadTimeDias} dias.`;
  } else if (linha.estoqueMaximo != null && saldo.greaterThan(dinheiro(linha.estoqueMaximo))) {
    nivel = 'EXCESSO';
    mensagem = 'Saldo acima do maximo. Capital parado.';
  } else if (diasParado !== null && diasParado > diasSemGiro) {
    nivel = 'SEM_GIRO';
    mensagem = `Sem movimentacao ha ${diasParado} dias. Risco de obsolescencia.`;
  }

  // sugestao de reposicao: lote economico quando definido, senao o que falta ate o maximo
  let sugerida = new Decimal(0);
  if (['RUPTURA', 'ABAIXO_DO_MINIMO', 'NO_PONTO_DE_PEDIDO', 'COBERTURA_BAIXA'].includes(nivel)) {
    sugerida = linha.loteEconomico != null
      ? dinheiro(linha.loteEconomico)
      : linha.estoqueMaximo != null
        ? Decimal.max(dinheiro(linha.estoqueMaximo).minus(saldo), new Decimal(0))
        : Decimal.max(dinheiro(linha.estoqueMinimo).minus(saldo), new Decimal(0));
  }

  return {
    itemId: linha.itemId,
    codigo: linha.codigo,
    descricao: linha.descricao,
    almoxarifado: linha.almoxarifado,
    nivel,
    semaforo: SEMAFORO[nivel],
    mensagem,
    saldo: saldo.toFixed(4),
    cobertura,
    quantidadeSugerida: sugerida.toFixed(4),
    valorImobilizado: centavos(saldo.times(dinheiro(linha.custoMedio))).toFixed(2),
  };
}

/** Alertas ordenados por gravidade, para o painel e para o job diario das 06:00. */
export function montarPainelDeAlertas(
  linhas: LinhaEstoque[],
  diasSemGiro: number,
  agora = new Date(),
): { alertas: AlertaEstoque[]; resumo: Record<NivelAlerta, number> } {
  const ordem: NivelAlerta[] = [
    'RUPTURA', 'ABAIXO_DO_MINIMO', 'NO_PONTO_DE_PEDIDO', 'COBERTURA_BAIXA', 'EXCESSO', 'SEM_GIRO', 'NORMAL',
  ];

  const alertas = linhas
    .map((l) => classificar(l, diasSemGiro, agora))
    .sort((a, b) => ordem.indexOf(a.nivel) - ordem.indexOf(b.nivel));

  const resumo = Object.fromEntries(ordem.map((n) => [n, 0])) as Record<NivelAlerta, number>;
  for (const a of alertas) resumo[a.nivel] += 1;

  return { alertas, resumo };
}

// ---------------------------------------------------------------- inventario

export interface ContagemItem {
  itemId: string;
  saldoSistema: ValorMonetario;
  saldoContado: ValorMonetario | null;
  custoMedio: ValorMonetario;
}

export interface ResultadoInventario {
  itensContados: number;
  itensCorretos: number;
  /** itens corretos / itens contados (secao 8.4) */
  acuracidade: Decimal;
  atingiuMeta: boolean;
  divergencias: Array<{ itemId: string; divergencia: Decimal; valorDivergencia: Decimal }>;
  impactoFinanceiro: Decimal;
}

/** Acuracidade = itens corretos / itens contados. Meta padrao 95% (secao 8.4). */
export function apurarInventario(contagens: ContagemItem[], meta = 0.95): ResultadoInventario {
  const contados = contagens.filter((c) => c.saldoContado !== null);
  if (contados.length === 0) {
    return {
      itensContados: 0,
      itensCorretos: 0,
      acuracidade: new Decimal(0),
      atingiuMeta: false,
      divergencias: [],
      impactoFinanceiro: new Decimal(0),
    };
  }

  const divergencias: ResultadoInventario['divergencias'] = [];
  let corretos = 0;

  for (const c of contados) {
    const sistema = dinheiro(c.saldoSistema);
    const contado = dinheiro(c.saldoContado!);
    const diferenca = contado.minus(sistema);

    if (diferenca.isZero()) {
      corretos += 1;
    } else {
      divergencias.push({
        itemId: c.itemId,
        divergencia: diferenca,
        valorDivergencia: centavos(diferenca.times(dinheiro(c.custoMedio))),
      });
    }
  }

  const acuracidade = new Decimal(corretos).dividedBy(contados.length).toDecimalPlaces(4);

  return {
    itensContados: contados.length,
    itensCorretos: corretos,
    acuracidade,
    atingiuMeta: acuracidade.greaterThanOrEqualTo(meta),
    divergencias,
    // impacto liquido: sobras compensam faltas
    impactoFinanceiro: centavos(divergencias.reduce<Decimal>((a, d) => a.plus(d.valorDivergencia), new Decimal(0))),
  };
}
