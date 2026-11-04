import { Decimal, centavos, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Regras de pneu (secao 7.4). Modulo puro - sem I/O, sem configuracao implicita.
 * Quem le parametro e faz a consulta e o servico; aqui so entra numero e sai decisao.
 */

export interface FaixasSulco {
  /** verde a partir deste sulco, em mm */
  verde: number;
  /** dourado entre `amarelo` e `verde`; abaixo de `amarelo`, vermelho */
  amarelo: number;
  /** limite legal de circulacao; abaixo disso o pneu sai de operacao */
  legalMm: number;
}

export const FAIXAS_SULCO_PADRAO: FaixasSulco = { verde: 6, amarelo: 4, legalMm: 1.6 };

export type EstadoSulco = 'VERDE' | 'DOURADO' | 'VERMELHO';

/** Cor da posicao no mapa de rodagem (secao 7.4). */
export function estadoDoSulco(sulcoMm: ValorMonetario | null | undefined, faixas = FAIXAS_SULCO_PADRAO): EstadoSulco {
  // sem medicao nao ha o que garantir: trata-se como pior caso, para forcar a inspecao
  if (sulcoMm == null) return 'VERMELHO';
  const sulco = dinheiro(sulcoMm);
  if (sulco.greaterThanOrEqualTo(faixas.verde)) return 'VERDE';
  if (sulco.greaterThanOrEqualTo(faixas.amarelo)) return 'DOURADO';
  return 'VERMELHO';
}

/**
 * CPK = (custo de aquisicao + recapagens + reparos) / km rodados no pneu (secao 7.4).
 * Pneu que ainda nao rodou nao tem CPK - devolver zero mentiria sobre o custo.
 */
export function calcularCpk(custoAcumulado: ValorMonetario, kmRodados: ValorMonetario): Decimal | null {
  const custo = dinheiro(custoAcumulado);
  const km = dinheiro(kmRodados);

  if (custo.isNegative()) throw new RangeError('Custo acumulado nao pode ser negativo.');
  if (km.isNegative()) throw new RangeError('Quilometragem nao pode ser negativa.');
  if (km.isZero()) return null;

  return custo.dividedBy(km).toDecimalPlaces(6);
}

/** Km rodados no periodo entre a instalacao e a leitura atual do hodometro. */
export function kmDoPeriodo(hodometroInstalacao: ValorMonetario, hodometroAtual: ValorMonetario): Decimal {
  const inicio = dinheiro(hodometroInstalacao);
  const fim = dinheiro(hodometroAtual);
  if (fim.lessThan(inicio)) {
    throw new RangeError('Hodometro atual e menor que o da instalacao. Confira a leitura.');
  }
  return fim.minus(inicio).toDecimalPlaces(1);
}

export type AlertaPneu =
  | 'SULCO_ABAIXO_DO_LEGAL'
  | 'SULCO_EM_ATENCAO'
  | 'ACIMA_DA_VIDA_UTIL'
  | 'CANDIDATO_A_RODIZIO';

export interface PneuParaAvaliar {
  numeroFogo: string;
  sulcoAtualMm?: ValorMonetario | null;
  kmAcumulado: ValorMonetario;
  vidaUtilKm?: ValorMonetario | null;
  custoAcumulado: ValorMonetario;
  /** km rodados desde a instalacao vigente; usado para sugerir rodizio */
  kmNaPosicao?: ValorMonetario | null;
}

export interface AvaliacaoPneu {
  numeroFogo: string;
  estado: EstadoSulco;
  cpk: string | null;
  /** percentual da vida util consumido, 0 a 1+; null quando nao ha vida util esperada */
  consumoVidaUtil: number | null;
  alertas: AlertaPneu[];
  /** true quando o pneu nao pode continuar rodando */
  bloqueiaCirculacao: boolean;
}

export interface ParametrosAvaliacao {
  faixas?: FaixasSulco;
  /** km na mesma posicao a partir dos quais o rodizio e sugerido (secao 7.4) */
  kmParaRodizio?: number;
}

export function avaliarPneu(pneu: PneuParaAvaliar, parametros: ParametrosAvaliacao = {}): AvaliacaoPneu {
  const faixas = parametros.faixas ?? FAIXAS_SULCO_PADRAO;
  const kmParaRodizio = parametros.kmParaRodizio ?? 20_000;

  const estado = estadoDoSulco(pneu.sulcoAtualMm, faixas);
  const alertas: AlertaPneu[] = [];

  const sulco = pneu.sulcoAtualMm != null ? dinheiro(pneu.sulcoAtualMm) : null;
  if (sulco && sulco.lessThan(faixas.legalMm)) alertas.push('SULCO_ABAIXO_DO_LEGAL');
  else if (estado !== 'VERDE') alertas.push('SULCO_EM_ATENCAO');

  let consumoVidaUtil: number | null = null;
  if (pneu.vidaUtilKm != null && dinheiro(pneu.vidaUtilKm).greaterThan(0)) {
    consumoVidaUtil = Number(dinheiro(pneu.kmAcumulado).dividedBy(dinheiro(pneu.vidaUtilKm)).toDecimalPlaces(4));
    if (consumoVidaUtil >= 1) alertas.push('ACIMA_DA_VIDA_UTIL');
  }

  if (pneu.kmNaPosicao != null && dinheiro(pneu.kmNaPosicao).greaterThanOrEqualTo(kmParaRodizio)) {
    alertas.push('CANDIDATO_A_RODIZIO');
  }

  const cpk = calcularCpk(pneu.custoAcumulado, pneu.kmAcumulado);

  return {
    numeroFogo: pneu.numeroFogo,
    estado,
    cpk: cpk ? cpk.toFixed(6) : null,
    consumoVidaUtil,
    alertas,
    bloqueiaCirculacao: alertas.includes('SULCO_ABAIXO_DO_LEGAL'),
  };
}

// ---------------------------------------------------------------- ciclo de vida

export type TipoMovimentacaoPneu =
  | 'INSTALACAO' | 'RODIZIO' | 'REMOCAO'
  | 'ENVIO_RECAPAGEM' | 'RETORNO_RECAPAGEM'
  | 'ENVIO_REPARO' | 'RETORNO_REPARO'
  | 'SUCATEAMENTO';

export type StatusPneu = 'EM_ESTOQUE' | 'EM_USO' | 'EM_RECAPAGEM' | 'EM_REPARO' | 'SUCATA';

/**
 * Transicoes validas do ciclo de vida (secao 7.4). Como no lote, transicao invalida
 * e erro explicito - nunca um UPDATE silencioso de status.
 */
const TRANSICOES: Record<TipoMovimentacaoPneu, { de: StatusPneu[]; para: StatusPneu }> = {
  INSTALACAO: { de: ['EM_ESTOQUE'], para: 'EM_USO' },
  RODIZIO: { de: ['EM_USO'], para: 'EM_USO' },
  REMOCAO: { de: ['EM_USO'], para: 'EM_ESTOQUE' },
  ENVIO_RECAPAGEM: { de: ['EM_ESTOQUE', 'EM_USO'], para: 'EM_RECAPAGEM' },
  RETORNO_RECAPAGEM: { de: ['EM_RECAPAGEM'], para: 'EM_ESTOQUE' },
  ENVIO_REPARO: { de: ['EM_ESTOQUE', 'EM_USO'], para: 'EM_REPARO' },
  RETORNO_REPARO: { de: ['EM_REPARO'], para: 'EM_ESTOQUE' },
  SUCATEAMENTO: { de: ['EM_ESTOQUE', 'EM_USO', 'EM_RECAPAGEM', 'EM_REPARO'], para: 'SUCATA' },
};

/** Movimentacoes que exigem veiculo e posicao informados. */
export const EXIGEM_POSICAO = new Set<TipoMovimentacaoPneu>(['INSTALACAO', 'RODIZIO']);

export function proximoStatus(atual: StatusPneu, tipo: TipoMovimentacaoPneu): StatusPneu {
  const regra = TRANSICOES[tipo];
  if (!regra.de.includes(atual)) {
    throw new RangeError(`Pneu em ${atual} nao aceita a movimentacao ${tipo}.`);
  }
  return regra.para;
}

export const transicoesValidasDoPneu = (atual: StatusPneu): TipoMovimentacaoPneu[] =>
  (Object.keys(TRANSICOES) as TipoMovimentacaoPneu[]).filter((t) => TRANSICOES[t].de.includes(atual));

// ---------------------------------------------------------------- consolidacao

export interface PneuComCusto {
  marca: string;
  modelo: string;
  custoAcumulado: ValorMonetario;
  kmAcumulado: ValorMonetario;
}

export interface CpkConsolidado {
  chave: string;
  pneus: number;
  custoTotal: string;
  kmTotal: string;
  /** CPK da frota agregada, nao a media dos CPKs - media de razao distorce */
  cpk: string | null;
}

/**
 * CPK por marca/modelo (secao 7.8): soma custos e km antes de dividir.
 * A media aritmetica dos CPKs individuais daria peso igual a um pneu de 5.000 km
 * e a outro de 120.000 km, e nao e isso que decide compra de pneu.
 */
export function consolidarCpk(pneus: PneuComCusto[], por: 'marca' | 'marcaModelo' = 'marcaModelo'): CpkConsolidado[] {
  const grupos = new Map<string, { custo: Decimal; km: Decimal; pneus: number }>();

  for (const p of pneus) {
    const chave = por === 'marca' ? p.marca : `${p.marca} ${p.modelo}`;
    const atual = grupos.get(chave) ?? { custo: new Decimal(0), km: new Decimal(0), pneus: 0 };
    grupos.set(chave, {
      custo: atual.custo.plus(dinheiro(p.custoAcumulado)),
      km: atual.km.plus(dinheiro(p.kmAcumulado)),
      pneus: atual.pneus + 1,
    });
  }

  return [...grupos.entries()]
    .map(([chave, g]) => ({
      chave,
      pneus: g.pneus,
      custoTotal: centavos(g.custo).toFixed(2),
      kmTotal: g.km.toFixed(1),
      cpk: calcularCpk(g.custo, g.km)?.toFixed(6) ?? null,
    }))
    .sort((a, b) => Number(a.cpk ?? Infinity) - Number(b.cpk ?? Infinity));
}
