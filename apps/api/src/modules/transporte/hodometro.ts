import { Decimal, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Leitura de hodometro contra o cadastro do veiculo (secao 7.1).
 *
 * O cadastro do veiculo e o unico lugar onde mora a quilometragem corrente. Portaria e
 * checklist leem dali e escrevem de volta — sao as duas telas onde a leitura e feita no
 * patio, olhando o painel. Modulo puro: recebe as duas leituras, devolve a decisao.
 *
 * Duas regras, e so essas:
 *
 * 1. **Hodometro nunca retrocede.** Leitura menor que a registrada e erro de digitacao ou
 *    troca de painel — nos dois casos alguem precisa saber. O sistema alerta e mantem o
 *    valor do cadastro; nao e a guarita, nem o motorista, que decide baixar a quilometragem
 *    de um veiculo.
 * 2. **Salto grande e suspeito.** Um digito a mais transforma 120.500 em 1.205.000 e
 *    contamina consumo, CPK e plano de manutencao em silencio. Acima do limite, alerta.
 */

export type TipoAlertaHodometro = 'HODOMETRO_RETROCEDEU' | 'HODOMETRO_SALTOU';

export interface AlertaHodometro {
  tipo: TipoAlertaHodometro;
  mensagem: string;
  /** o que estava no cadastro do veiculo quando a leitura chegou */
  registrado: string;
  informado: string;
  diferenca: string;
}

export interface LeituraDeHodometro {
  /** hodometro atual do cadastro do veiculo */
  registrado?: ValorMonetario | null;
  /** leitura informada agora, na guarita ou no checklist */
  informado?: ValorMonetario | null;
  /** de onde veio a leitura, para a mensagem dizer o que a pessoa acabou de fazer */
  origem: 'saida na portaria' | 'retorno na portaria' | 'checklist';
  placa?: string | null;
  /** km acima do qual o salto vira alerta; padrao 5.000 km entre duas leituras */
  saltoMaximoKm?: number;
}

const SALTO_MAXIMO_KM_PADRAO = 5000;

/**
 * Confere a leitura contra o cadastro. Devolve null quando esta coerente.
 *
 * Sem valor registrado (veiculo recem-cadastrado) nao ha o que comparar: a primeira
 * leitura e a verdade, e alertar nela so ensinaria a ignorar o alerta.
 */
export function alertaDeHodometro(leitura: LeituraDeHodometro): AlertaHodometro | null {
  if (leitura.informado == null || leitura.registrado == null) return null;

  const informado = dinheiro(leitura.informado);
  const registrado = dinheiro(leitura.registrado);
  if (registrado.lessThanOrEqualTo(0)) return null;

  const veiculo = leitura.placa ? `do veiculo ${leitura.placa}` : 'do veiculo';

  if (informado.lessThan(registrado)) {
    const diferenca = registrado.minus(informado).toDecimalPlaces(1);
    return {
      tipo: 'HODOMETRO_RETROCEDEU',
      mensagem:
        `Hodometro informado na ${leitura.origem} (${informado.toFixed(1)} km) e menor que o registrado ` +
        `no cadastro ${veiculo} (${registrado.toFixed(1)} km) — ${diferenca.toFixed(1)} km a menos. ` +
        'Confira a leitura do painel. O cadastro segue com o valor maior.',
      registrado: registrado.toFixed(1),
      informado: informado.toFixed(1),
      diferenca: diferenca.toFixed(1),
    };
  }

  const avanco = informado.minus(registrado).toDecimalPlaces(1);
  const limite = new Decimal(leitura.saltoMaximoKm ?? SALTO_MAXIMO_KM_PADRAO);
  if (avanco.greaterThan(limite)) {
    return {
      tipo: 'HODOMETRO_SALTOU',
      mensagem:
        `Hodometro informado na ${leitura.origem} (${informado.toFixed(1)} km) esta ${avanco.toFixed(1)} km ` +
        `acima do registrado no cadastro ${veiculo} (${registrado.toFixed(1)} km), acima do limite de ` +
        `${limite.toFixed(0)} km entre leituras. Confira se nao ha digito a mais.`,
      registrado: registrado.toFixed(1),
      informado: informado.toFixed(1),
      diferenca: avanco.toFixed(1),
    };
  }

  return null;
}

/**
 * Quilometragem que fica no cadastro depois da leitura: a maior das duas.
 *
 * Leitura menor nao apaga o que ja foi rodado — vira alerta, nao correcao silenciosa.
 * Corrigir hodometro para menos e ato do cadastro do veiculo, com trilha propria.
 */
export function hodometroConsolidado(
  registrado: ValorMonetario | null | undefined,
  informado: ValorMonetario | null | undefined,
): Decimal | null {
  if (informado == null) return null;
  const novo = dinheiro(informado);
  if (registrado == null) return novo.toDecimalPlaces(1);
  const atual = dinheiro(registrado);
  return (novo.greaterThan(atual) ? novo : atual).toDecimalPlaces(1);
}

/** O cadastro so recebe escrita quando a leitura avanca de verdade. */
export function deveAvancarCadastro(
  registrado: ValorMonetario | null | undefined,
  informado: ValorMonetario | null | undefined,
): boolean {
  if (informado == null) return false;
  if (registrado == null) return true;
  return dinheiro(informado).greaterThan(dinheiro(registrado));
}
