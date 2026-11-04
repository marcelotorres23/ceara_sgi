import { Decimal, centavos, dinheiro, emPtBr, type ValorMonetario } from '../../core/money.js';

/**
 * Abastecimento interno: estoque de combustivel no tanque proprio (secao 7.9).
 * Modulo puro - sem I/O, sem configuracao implicita.
 *
 * A promessa deste modulo e "controlar a entrada e a saida de cada gota". Ele
 * existe porque o abastecimento da F5 media o CONSUMO do veiculo mas nao sabia
 * quanto combustivel havia no tanque: comprava-se 5.000 litros, abastecia-se
 * 4.200, e os 800 restantes eram fe.
 */

export type TipoMovimentacaoTanque =
  | 'ENTRADA_COMPRA'
  | 'ENTRADA_TRANSFERENCIA'
  | 'ENTRADA_ACERTO'
  | 'SAIDA_ABASTECIMENTO'
  | 'SAIDA_TRANSFERENCIA'
  | 'SAIDA_ACERTO';

export const ehEntradaNoTanque = (tipo: TipoMovimentacaoTanque): boolean => tipo.startsWith('ENTRADA_');

export interface PosicaoDoTanque {
  saldoLitros: Decimal;
  custoMedio: Decimal;
}

/**
 * Entrada no tanque com custo medio ponderado movel - mesma matematica do
 * almoxarifado (secao 8.1), aplicada a litro em vez de peca:
 *
 *   custo_medio = (saldo x custo_atual + litros x custo_entrada) / (saldo + litros)
 *
 * Combustivel de nota diferente se mistura fisicamente no tanque; o custo medio
 * e a unica forma honesta de valorizar a saida depois.
 */
export function abastecerTanque(
  atual: PosicaoDoTanque,
  litros: ValorMonetario,
  custoUnitario: ValorMonetario,
  capacidadeLitros: ValorMonetario,
): PosicaoDoTanque {
  const entrada = dinheiro(litros);
  const custo = dinheiro(custoUnitario);
  const capacidade = dinheiro(capacidadeLitros);

  if (entrada.lessThanOrEqualTo(0)) throw new RangeError('A entrada precisa ser maior que zero.');
  if (custo.isNegative()) throw new RangeError('O custo do litro nao pode ser negativo.');

  const novoSaldo = atual.saldoLitros.plus(entrada);

  // tanque nao e elastico: entrada acima da capacidade e erro de digitacao ou de medicao
  if (capacidade.greaterThan(0) && novoSaldo.greaterThan(capacidade)) {
    throw new RangeError(
      `Entrada de ${emPtBr(entrada, 3)} L deixaria o tanque com ${emPtBr(novoSaldo, 3)} L, ` +
        `acima da capacidade de ${emPtBr(capacidade, 3)} L.`,
    );
  }

  // saldo zerado: o custo passa a ser o da entrada, sem media
  if (atual.saldoLitros.lessThanOrEqualTo(0)) {
    return { saldoLitros: novoSaldo, custoMedio: custo.toDecimalPlaces(4) };
  }

  const valorAtual = atual.saldoLitros.times(atual.custoMedio);
  const valorEntrada = entrada.times(custo);

  return {
    saldoLitros: novoSaldo,
    custoMedio: valorAtual.plus(valorEntrada).dividedBy(novoSaldo).toDecimalPlaces(4),
  };
}

/** Saida consome pelo custo medio vigente e nunca deixa o tanque negativo. */
export function retirarDoTanque(atual: PosicaoDoTanque, litros: ValorMonetario): PosicaoDoTanque {
  const saida = dinheiro(litros);
  if (saida.lessThanOrEqualTo(0)) throw new RangeError('A saida precisa ser maior que zero.');

  if (saida.greaterThan(atual.saldoLitros)) {
    throw new RangeError(
      `Saldo insuficiente no tanque: disponivel ${emPtBr(atual.saldoLitros, 3)} L, ` +
        `solicitado ${emPtBr(saida, 3)} L.`,
    );
  }

  return { saldoLitros: atual.saldoLitros.minus(saida), custoMedio: atual.custoMedio };
}

/** Valor financeiro parado no tanque. */
export const valorNoTanque = (posicao: PosicaoDoTanque): Decimal =>
  centavos(posicao.saldoLitros.times(posicao.custoMedio));

// ---------------------------------------------------------------- afericao

export type ResultadoAfericao = 'CONFORME' | 'PERDA' | 'SOBRA';

export interface Afericao {
  saldoSistema: string;
  saldoMedido: string;
  /** medido - sistema: negativo e perda, positivo e sobra */
  diferenca: string;
  /** diferenca sobre o saldo do sistema, 0 a 1 */
  percentual: number;
  resultado: ResultadoAfericao;
  dentroDaTolerancia: boolean;
  /** valor financeiro da diferenca, ao custo medio do tanque */
  impactoFinanceiro: string;
  mensagem: string;
  exigeJustificativa: boolean;
}

/**
 * Confronto entre a regua e o sistema (secao 7.9).
 *
 * Perda pequena e esperada: diesel evapora, a regua tem imprecisao e a bomba tem
 * folga. O que a tolerancia separa e "evaporacao" de "alguem levou" — e por isso
 * a diferenca acima dela **exige justificativa**, em vez de virar ajuste silencioso.
 */
export function apurarAfericao(
  saldoSistema: ValorMonetario,
  saldoMedido: ValorMonetario,
  custoMedio: ValorMonetario,
  toleranciaPercentual: number,
): Afericao {
  const sistema = dinheiro(saldoSistema);
  const medido = dinheiro(saldoMedido);

  if (medido.isNegative()) throw new RangeError('O saldo medido nao pode ser negativo.');
  if (toleranciaPercentual < 0) throw new RangeError('A tolerancia nao pode ser negativa.');

  const diferenca = medido.minus(sistema);

  // tanque vazio no sistema: qualquer sobra e 100% de divergencia, nao divisao por zero
  const percentual = sistema.greaterThan(0)
    ? Number(diferenca.dividedBy(sistema).toDecimalPlaces(6))
    : diferenca.isZero()
      ? 0
      : 1;

  const resultado: ResultadoAfericao = diferenca.isZero() ? 'CONFORME' : diferenca.isNegative() ? 'PERDA' : 'SOBRA';
  const dentroDaTolerancia = Math.abs(percentual) <= toleranciaPercentual;

  const impacto = centavos(diferenca.times(dinheiro(custoMedio)));

  const mensagem =
    resultado === 'CONFORME'
      ? 'Medicao bate com o sistema.'
      : `${resultado === 'PERDA' ? 'Falta' : 'Sobra'} de ${emPtBr(diferenca.abs(), 3)} L ` +
        `(${emPtBr(Math.abs(percentual) * 100, 2)}% do saldo). ` +
        (dentroDaTolerancia
          ? 'Dentro da tolerancia de evaporacao e medicao.'
          : 'Acima da tolerancia: exige justificativa e apuracao.');

  return {
    saldoSistema: sistema.toFixed(3),
    saldoMedido: medido.toFixed(3),
    diferenca: diferenca.toFixed(3),
    percentual,
    resultado,
    dentroDaTolerancia,
    impactoFinanceiro: impacto.toFixed(2),
    mensagem,
    exigeJustificativa: !dentroDaTolerancia,
  };
}

// ---------------------------------------------------------------- encerrante

export interface ConferenciaEncerrante {
  litrosInformados: string;
  litrosPeloEncerrante: string;
  diferenca: string;
  confere: boolean;
  mensagem: string;
}

/**
 * O encerrante da bomba e um contador mecanico que so avanca. A diferenca entre
 * a leitura final e a inicial **e** o volume que passou pelo bico - por isso ele
 * confere o que foi digitado.
 *
 * Encerrante que retrocede indica troca de bomba, reset ou digitacao errada, e e
 * recusado: aceitar retrocesso apagaria litros do controle.
 */
export function conferirEncerrante(
  inicial: ValorMonetario,
  final: ValorMonetario,
  litrosInformados: ValorMonetario,
  toleranciaLitros = 0.5,
): ConferenciaEncerrante {
  const de = dinheiro(inicial);
  const ate = dinheiro(final);
  const informados = dinheiro(litrosInformados);

  if (ate.lessThan(de)) {
    throw new RangeError(
      `Encerrante final (${emPtBr(ate, 3)}) menor que o inicial (${emPtBr(de, 3)}). ` +
        'Contador de bomba nao retrocede: confira a leitura ou registre a troca do equipamento.',
    );
  }

  const pelaBomba = ate.minus(de);
  const diferenca = informados.minus(pelaBomba);
  const confere = diferenca.abs().lessThanOrEqualTo(toleranciaLitros);

  return {
    litrosInformados: informados.toFixed(3),
    litrosPeloEncerrante: pelaBomba.toFixed(3),
    diferenca: diferenca.toFixed(3),
    confere,
    mensagem: confere
      ? 'Volume confere com o encerrante da bomba.'
      : `Volume informado difere do encerrante em ${emPtBr(diferenca.abs(), 3)} L. ` +
        `A bomba registrou ${emPtBr(pelaBomba, 3)} L.`,
  };
}

// ---------------------------------------------------------------- turno

export interface FaixaDeTurno {
  nome: string;
  /** 'HH:MM' */
  inicio: string;
  fim: string;
}

export const TURNOS_PADRAO: FaixaDeTurno[] = [
  { nome: 'Manha', inicio: '06:00', fim: '14:00' },
  { nome: 'Tarde', inicio: '14:00', fim: '22:00' },
  { nome: 'Noite', inicio: '22:00', fim: '06:00' },
];

const minutosDe = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Turno da operacao a partir do horario (secao 7.9). O turno da noite atravessa
 * a meia-noite, e e justamente nele que a maior parte do desvio acontece - por
 * isso ele nao pode cair fora da classificacao.
 */
export function turnoDe(dataHora: Date, turnos: FaixaDeTurno[] = TURNOS_PADRAO): string | null {
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Fortaleza',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dataHora);

  const agora = minutosDe(local);

  for (const turno of turnos) {
    const inicio = minutosDe(turno.inicio);
    const fim = minutosDe(turno.fim);

    const dentro = inicio < fim ? agora >= inicio && agora < fim : agora >= inicio || agora < fim;
    if (dentro) return turno.nome;
  }

  return null;
}

// ---------------------------------------------------------------- consumo consolidado

export interface AbastecimentoParaMedia {
  chave: string;
  rotulo: string;
  litros: ValorMonetario;
  kmPercorridos: ValorMonetario | null;
  valorTotal: ValorMonetario;
}

export interface MediaConsolidada {
  chave: string;
  rotulo: string;
  abastecimentos: number;
  litros: string;
  kmRodados: string;
  /** km / litro; null quando nao houve litro ou quilometragem apurada */
  consumoMedioKml: string | null;
  custoTotal: string;
  custoPorKm: string | null;
  custoPorLitro: string | null;
}

/**
 * Media de consumo por qualquer recorte - modelo, motorista, categoria, turno,
 * obra (secao 7.9). Soma litros e km antes de dividir: media de medias daria o
 * mesmo peso a um caminhao que rodou 200 km e a outro que rodou 4.000.
 */
export function consolidarConsumo(itens: AbastecimentoParaMedia[]): MediaConsolidada[] {
  const grupos = new Map<string, { rotulo: string; litros: Decimal; km: Decimal; valor: Decimal; n: number }>();

  for (const item of itens) {
    const atual = grupos.get(item.chave) ?? {
      rotulo: item.rotulo,
      litros: new Decimal(0),
      km: new Decimal(0),
      valor: new Decimal(0),
      n: 0,
    };

    atual.litros = atual.litros.plus(dinheiro(item.litros));
    atual.km = atual.km.plus(dinheiro(item.kmPercorridos ?? 0));
    atual.valor = atual.valor.plus(dinheiro(item.valorTotal));
    atual.n += 1;

    grupos.set(item.chave, atual);
  }

  return [...grupos.entries()]
    .map(([chave, g]) => ({
      chave,
      rotulo: g.rotulo,
      abastecimentos: g.n,
      litros: g.litros.toFixed(3),
      kmRodados: g.km.toFixed(1),
      consumoMedioKml: g.litros.greaterThan(0) && g.km.greaterThan(0)
        ? g.km.dividedBy(g.litros).toDecimalPlaces(3).toFixed(3)
        : null,
      custoTotal: centavos(g.valor).toFixed(2),
      custoPorKm: g.km.greaterThan(0) ? g.valor.dividedBy(g.km).toDecimalPlaces(4).toFixed(4) : null,
      custoPorLitro: g.litros.greaterThan(0) ? g.valor.dividedBy(g.litros).toDecimalPlaces(4).toFixed(4) : null,
    }))
    // pior consumo primeiro: e o que exige olhar
    .sort((a, b) => Number(a.consumoMedioKml ?? Infinity) - Number(b.consumoMedioKml ?? Infinity));
}
