import Decimal from 'decimal.js';

/**
 * Dinheiro no backend e sempre `Decimal` - nunca float (secao 13).
 * A formatacao pt-BR acontece so na apresentacao, no frontend.
 */
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type ValorMonetario = Decimal | string | number;

export const dinheiro = (v: ValorMonetario): Decimal => new Decimal(v as never);

/** Arredonda para 2 casas (centavos), meio para cima. */
export const centavos = (v: ValorMonetario): Decimal => dinheiro(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** String pronta para persistir em NUMERIC(14,2). */
export const paraBanco = (v: ValorMonetario): string => centavos(v).toFixed(2);

export const somar = (valores: ValorMonetario[]): Decimal =>
  valores.reduce<Decimal>((acc, v) => acc.plus(dinheiro(v)), new Decimal(0));

/**
 * Numero em pt-BR para MENSAGEM destinada ao usuario.
 *
 * A regra da secao 13 e "formatacao pt-BR so na apresentacao" - e a mensagem de erro
 * ou de alerta E apresentacao, ainda que montada no servidor. Sem isto, "saldo 30.00"
 * e lido como trinta mil por quem usa virgula decimal.
 *
 * Nao usar para persistir nem para transportar valor: para isso existe `paraBanco`.
 */
export const emPtBr = (v: ValorMonetario, casas = 2): string =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
    .format(Number(dinheiro(v).toString()));
