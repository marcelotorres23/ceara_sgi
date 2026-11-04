import { Decimal, centavos, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Calculo de consumo e deteccao de anomalias de abastecimento (secao 7.2).
 * Modulo puro - sem I/O. Os parametros (desvio tolerado, janela minima) chegam do chamador.
 */

export type TipoAnomalia =
  | 'CONSUMO_FORA_DA_MEDIA'
  | 'LITRAGEM_ACIMA_DO_TANQUE'
  | 'HODOMETRO_RETROCEDEU'
  | 'ABASTECIMENTOS_MUITO_PROXIMOS';

export interface AbastecimentoAnterior {
  dataHora: Date;
  hodometro: ValorMonetario;
}

export interface NovoAbastecimento {
  dataHora: Date;
  litros: ValorMonetario;
  valorUnitario: ValorMonetario;
  hodometro: ValorMonetario;
}

export interface ContextoVeiculo {
  capacidadeTanque?: ValorMonetario | null;
  /** media historica de km/l do veiculo; null quando ainda nao ha base */
  consumoMedioHistorico?: ValorMonetario | null;
  anterior?: AbastecimentoAnterior | null;
}

export interface ParametrosAnomalia {
  /** desvio tolerado de consumo, ex.: 0.15 para +-15% */
  desvioTolerado: ValorMonetario;
  /** janela minima entre dois abastecimentos do mesmo veiculo, em horas */
  janelaMinimaHoras: number;
}

export interface ResultadoAbastecimento {
  valorTotal: Decimal;
  kmPercorridos: Decimal | null;
  consumoKml: Decimal | null;
  custoPorKm: Decimal | null;
  /** desvio do consumo em relacao a media historica; negativo = pior que a media */
  desvioPercentual: Decimal | null;
  anomalia: boolean;
  tipos: TipoAnomalia[];
  /** anomalia que impede o registro sem justificativa */
  exigeJustificativa: boolean;
  mensagens: string[];
}

/**
 * Apura consumo e anomalias.
 *
 * O consumo do intervalo so existe a partir do segundo abastecimento: o primeiro
 * registro de um veiculo nao tem quilometragem de referencia, e inventar um numero
 * ali contaminaria a media historica.
 */
export function apurarAbastecimento(
  novo: NovoAbastecimento,
  contexto: ContextoVeiculo,
  parametros: ParametrosAnomalia,
): ResultadoAbastecimento {
  const litros = dinheiro(novo.litros);
  const hodometro = dinheiro(novo.hodometro);

  if (litros.lessThanOrEqualTo(0)) throw new RangeError('Litragem precisa ser maior que zero.');
  if (hodometro.isNegative()) throw new RangeError('Hodometro nao pode ser negativo.');

  const valorTotal = centavos(litros.times(dinheiro(novo.valorUnitario)));

  const tipos: TipoAnomalia[] = [];
  const mensagens: string[] = [];

  // ---- litragem acima da capacidade do tanque
  if (contexto.capacidadeTanque != null) {
    const capacidade = dinheiro(contexto.capacidadeTanque);
    if (capacidade.greaterThan(0) && litros.greaterThan(capacidade)) {
      tipos.push('LITRAGEM_ACIMA_DO_TANQUE');
      mensagens.push(
        `Litragem de ${litros.toFixed(3)} L acima da capacidade do tanque (${capacidade.toFixed(2)} L).`,
      );
    }
  }

  // ---- hodometro menor que o do ultimo registro
  let kmPercorridos: Decimal | null = null;
  let hodometroRetrocedeu = false;

  if (contexto.anterior) {
    const anterior = dinheiro(contexto.anterior.hodometro);
    if (hodometro.lessThan(anterior)) {
      hodometroRetrocedeu = true;
      tipos.push('HODOMETRO_RETROCEDEU');
      mensagens.push(
        `Hodometro ${hodometro.toFixed(1)} menor que o do ultimo abastecimento (${anterior.toFixed(1)}).`,
      );
    } else {
      kmPercorridos = hodometro.minus(anterior);
    }

    // ---- dois abastecimentos do mesmo veiculo em janela curta
    const horas = (novo.dataHora.getTime() - contexto.anterior.dataHora.getTime()) / 3_600_000;
    if (horas >= 0 && horas < parametros.janelaMinimaHoras) {
      tipos.push('ABASTECIMENTOS_MUITO_PROXIMOS');
      mensagens.push(
        `Segundo abastecimento em ${horas.toFixed(1)}h, abaixo da janela de ${parametros.janelaMinimaHoras}h.`,
      );
    }
  }

  // ---- consumo do intervalo
  let consumoKml: Decimal | null = null;
  let custoPorKm: Decimal | null = null;
  let desvioPercentual: Decimal | null = null;

  if (kmPercorridos !== null && kmPercorridos.greaterThan(0)) {
    consumoKml = kmPercorridos.dividedBy(litros).toDecimalPlaces(3);
    custoPorKm = valorTotal.dividedBy(kmPercorridos).toDecimalPlaces(4);

    if (contexto.consumoMedioHistorico != null) {
      const media = dinheiro(contexto.consumoMedioHistorico);
      if (media.greaterThan(0)) {
        desvioPercentual = consumoKml.minus(media).dividedBy(media).toDecimalPlaces(4);

        if (desvioPercentual.abs().greaterThan(dinheiro(parametros.desvioTolerado))) {
          tipos.push('CONSUMO_FORA_DA_MEDIA');
          const sinal = desvioPercentual.isNegative() ? 'abaixo' : 'acima';
          mensagens.push(
            `Consumo de ${consumoKml.toFixed(3)} km/L esta ${desvioPercentual.abs().times(100).toFixed(1)}% ` +
              `${sinal} da media do veiculo (${media.toFixed(3)} km/L).`,
          );
        }
      }
    }
  }

  return {
    valorTotal,
    kmPercorridos,
    consumoKml,
    custoPorKm,
    desvioPercentual,
    anomalia: tipos.length > 0,
    tipos,
    // hodometro retrocedido bloqueia sem justificativa (secao 7.2)
    exigeJustificativa: hodometroRetrocedeu,
    mensagens,
  };
}

/**
 * Media historica de km/L do veiculo, a partir dos consumos ja apurados.
 * Registros sem consumo (primeiro do veiculo, ou com hodometro retrocedido) ficam de fora.
 */
export function consumoMedioHistorico(consumos: Array<ValorMonetario | null>): Decimal | null {
  const validos = consumos
    .filter((c): c is ValorMonetario => c !== null)
    .map((c) => dinheiro(c))
    .filter((c) => c.greaterThan(0));

  if (validos.length === 0) return null;

  return validos
    .reduce<Decimal>((a, c) => a.plus(c), new Decimal(0))
    .dividedBy(validos.length)
    .toDecimalPlaces(3);
}

/** Custo por km do periodo: total gasto dividido pela distancia percorrida. */
export function custoPorKmDoPeriodo(
  registros: Array<{ valorTotal: ValorMonetario; kmPercorridos: ValorMonetario | null }>,
): { totalGasto: Decimal; kmTotal: Decimal; custoPorKm: Decimal | null } {
  const totalGasto = registros.reduce<Decimal>((a, r) => a.plus(dinheiro(r.valorTotal)), new Decimal(0));
  const kmTotal = registros.reduce<Decimal>(
    (a, r) => a.plus(r.kmPercorridos != null ? dinheiro(r.kmPercorridos) : new Decimal(0)),
    new Decimal(0),
  );

  return {
    totalGasto: centavos(totalGasto),
    kmTotal,
    custoPorKm: kmTotal.greaterThan(0) ? totalGasto.dividedBy(kmTotal).toDecimalPlaces(4) : null,
  };
}
