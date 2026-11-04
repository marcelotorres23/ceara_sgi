import { Decimal, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Ritmo de uso do ativo: km/dia e previsao de vencimento em dias (ADR 0023, decisao 6).
 *
 * A regua diz **quanto falta**; este modulo responde **quando isso chega**. E a diferenca
 * entre uma informacao e uma decisao: "faltam 1.200 km" obriga o encarregado a fazer conta
 * de cabeca sobre quanto aquele caminhao roda; "vence em 6 dias" ja monta a semana.
 *
 * Tres cuidados que a media simples nao tem:
 *
 * - **Leitura manual pesa menos.** Lancamento digitado pelo frentista e o que costuma vir
 *   com digito trocado. Ele entra na conta, mas com peso menor — descartar seria perder o
 *   unico dado de quem abastece fora da automacao.
 * - **Intervalo sem rodagem nao vira zero.** Caminhao parado uma semana e depois rodando
 *   500 km/dia tem media diferente de um que roda 70 todo dia; a media e do periodo inteiro,
 *   e nao a media das medias diarias.
 * - **Ritmo so existe com base.** Menos de duas leituras, ou janela curta demais, devolve
 *   `null` — e a tela mostra "sem base para prever" em vez de um numero inventado.
 */

export interface LeituraDeUso {
  valor: ValorMonetario;
  medidoEm: Date;
  /** leitura digitada ou vinda de bypass do frentista pesa menos na media */
  manual?: boolean;
}

/** Peso da leitura automatica contra a manual na media ponderada. */
const PESO_AUTOMATICA = 1;
const PESO_MANUAL = 0.4;

/** Janela padrao da media movel, em dias. */
export const JANELA_PADRAO_DIAS = 30;

/**
 * Teto de ritmo por trecho.
 *
 * Caminhao de distribuicao regional nao faz 240.000 km/dia. Trecho acima disto nao e
 * rodagem: e leitura de duas procedencias diferentes sobre a mesma placa — o cadastro
 * dizendo 71.102 km e a planilha de trocas dizendo 155.442, por exemplo. Deixar passar
 * contaminaria a previsao de toda a frota, entao o trecho e descartado, como o negativo.
 *
 * O limite e generoso de proposito: 1.500 km/dia cobre viagem longa de dois motoristas,
 * e ainda assim barra o disparate por ordem de grandeza.
 */
export const RITMO_MAXIMO_PADRAO = 1_500;

/**
 * Piso do trecho, em dias.
 *
 * Dois abastecimentos na mesma manha nao provam ritmo de 400 km/dia: sem piso, um trecho
 * de duas horas dominaria a media inteira. Meio dia e o menor periodo que ainda diz algo.
 */
const MINIMO_DE_DIAS = 0.5;

const DIA_MS = 86_400_000;

/**
 * Km (ou horas) por dia, na janela informada.
 *
 * Conta o avanco real do medidor no periodo dividido pelos dias entre a primeira e a
 * ultima leitura da janela. Leitura que retrocede nao entra: medidor que voltou e assunto
 * da regua, e nao da previsao.
 */
export function ritmoPorDia(
  leituras: readonly LeituraDeUso[],
  janelaDias = JANELA_PADRAO_DIAS,
  agora = new Date(),
  ritmoMaximo = RITMO_MAXIMO_PADRAO,
): Decimal | null {
  const limite = new Date(agora.getTime() - janelaDias * DIA_MS);

  const naJanela = leituras
    .filter((l) => l.medidoEm >= limite && l.medidoEm <= agora)
    .sort((a, b) => a.medidoEm.getTime() - b.medidoEm.getTime());

  if (naJanela.length < 2) return null;

  /*
   * Media ponderada de taxa, e nao de distancia: soma(peso x avanco) / soma(peso x dias).
   *
   * Com pesos iguais a conta desaba na taxa simples do periodo (avanco total / dias
   * totais), que e o que se espera. Com leitura manual no meio, aquele trecho puxa menos
   * a media dos dois lados da fracao — que e o efeito pretendido: menos confianca, menos
   * influencia, sem sumir com o dado.
   */
  let numerador = new Decimal(0);
  let denominador = new Decimal(0);
  let anterior = naJanela[0]!;

  for (const atual of naJanela.slice(1)) {
    const delta = dinheiro(atual.valor).minus(dinheiro(anterior.valor));
    // medidor que voltou nao entra na conta de ritmo; quem trata disso e a regua
    if (delta.isNegative()) {
      anterior = atual;
      continue;
    }

    const dias = Math.max((atual.medidoEm.getTime() - anterior.medidoEm.getTime()) / DIA_MS, MINIMO_DE_DIAS);

    // trecho impossivel e leitura de outra procedencia, e nao rodagem: descarta como o negativo
    if (delta.dividedBy(dias).greaterThan(ritmoMaximo)) {
      anterior = atual;
      continue;
    }

    const peso = new Decimal(atual.manual || anterior.manual ? PESO_MANUAL : PESO_AUTOMATICA);

    numerador = numerador.plus(delta.times(peso));
    denominador = denominador.plus(peso.times(dias));
    anterior = atual;
  }

  if (denominador.lessThanOrEqualTo(0) || numerador.lessThanOrEqualTo(0)) return null;

  return numerador.dividedBy(denominador).toDecimalPlaces(1);
}

/**
 * Dias ate o vencimento, a partir do ritmo.
 *
 * Sem ritmo apurado nao ha previsao — devolver um numero seria fingir que se sabe. Item
 * ja vencido devolve zero: o atraso e da regua, e a previsao nao tem o que antecipar.
 */
export function diasAteVencer(aVencer: ValorMonetario, ritmo: ValorMonetario | null): number | null {
  if (ritmo == null) return null;

  const porDia = dinheiro(ritmo);
  if (porDia.lessThanOrEqualTo(0)) return null;

  const falta = dinheiro(aVencer);
  if (falta.lessThanOrEqualTo(0)) return 0;

  return Math.floor(Number(falta.dividedBy(porDia)));
}

/** Data prevista do vencimento, para programar peca e box com antecedencia. */
export function dataPrevista(dias: number | null, agora = new Date()): Date | null {
  if (dias === null) return null;
  return new Date(agora.getTime() + dias * DIA_MS);
}

/**
 * Ativo que parou de dar sinal.
 *
 * Sem leitura ha muito tempo, ou o caminhao esta parado, ou o cadastro se desvinculou da
 * automacao de abastecimento. Os dois casos precisam de aviso, e o painel nao pode seguir
 * mostrando uma previsao calculada sobre dado velho.
 */
export function diasSemLeitura(ultimaLeitura: Date | null, agora = new Date()): number | null {
  if (ultimaLeitura === null) return null;
  return Math.floor((agora.getTime() - ultimaLeitura.getTime()) / DIA_MS);
}
