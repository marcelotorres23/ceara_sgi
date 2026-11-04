import { Decimal, dinheiro, type ValorMonetario } from '../../core/money.js';

/**
 * Consolidacao do relatorio de abastecimentos (secao 7.2).
 *
 * Modulo puro: recebe as linhas ja filtradas e devolve os totais e os agrupamentos. Fica
 * separado do servico porque a conta de consumo tem uma sutileza que se erra facil.
 *
 * **Consumo medio nao e media de consumos.** Somar o km/L de cada abastecimento e dividir
 * pela quantidade da o mesmo peso a um registro de 30 litros e a um de 300 — e o resultado
 * nao bate com o que o tanque gastou. O consumo do periodo e `km total / litros totais`,
 * ponderado pela propria natureza da conta.
 *
 * Registro sem km apurado (o primeiro do veiculo, ou o que veio depois de hodometro
 * retrocedido) entra no total de litros e de dinheiro, mas **fica fora do consumo** — ele
 * tem combustivel sem distancia conhecida, e misturar os dois inventaria rendimento.
 */

export interface LinhaDeAbastecimento {
  litros: ValorMonetario;
  valorTotal: ValorMonetario;
  kmPercorridos?: ValorMonetario | null;
  anomalia?: boolean;
  /** chaves de agrupamento */
  veiculo?: string | null;
  motorista?: string | null;
  posto?: string | null;
  combustivel?: string | null;
}

export interface TotaisDoRelatorio {
  abastecimentos: number;
  litros: string;
  valorTotal: string;
  kmPercorridos: string;
  /** km/L do periodo: km total sobre litros totais, e nao media de medias */
  consumoMedioKml: string | null;
  custoPorKm: string | null;
  precoMedioPorLitro: string | null;
  anomalias: number;
  /** registros sem km apurado, que ficam de fora do consumo */
  semKmApurado: number;
}

export function totaisDoRelatorio(linhas: readonly LinhaDeAbastecimento[]): TotaisDoRelatorio {
  let litros = new Decimal(0);
  let valor = new Decimal(0);
  let km = new Decimal(0);
  let litrosComKm = new Decimal(0);
  let valorComKm = new Decimal(0);
  let semKm = 0;
  let anomalias = 0;

  for (const l of linhas) {
    const litrosDaLinha = dinheiro(l.litros);
    litros = litros.plus(litrosDaLinha);
    valor = valor.plus(dinheiro(l.valorTotal));
    if (l.anomalia) anomalias++;

    if (l.kmPercorridos == null) {
      semKm++;
      continue;
    }

    // so entra no consumo o par completo de km e litros
    km = km.plus(dinheiro(l.kmPercorridos));
    litrosComKm = litrosComKm.plus(litrosDaLinha);
    valorComKm = valorComKm.plus(dinheiro(l.valorTotal));
  }

  return {
    abastecimentos: linhas.length,
    litros: litros.toFixed(3),
    valorTotal: valor.toFixed(2),
    kmPercorridos: km.toFixed(1),
    consumoMedioKml: litrosComKm.greaterThan(0) ? km.dividedBy(litrosComKm).toFixed(3) : null,
    custoPorKm: km.greaterThan(0) ? valorComKm.dividedBy(km).toFixed(4) : null,
    precoMedioPorLitro: litros.greaterThan(0) ? valor.dividedBy(litros).toFixed(4) : null,
    anomalias,
    semKmApurado: semKm,
  };
}

export type ChaveDeAgrupamento = 'veiculo' | 'motorista' | 'posto' | 'combustivel';

export interface GrupoDoRelatorio extends TotaisDoRelatorio {
  chave: string;
}

/**
 * Agrupa e ordena por valor gasto, do maior para o menor.
 *
 * A pergunta que o gestor faz para um relatorio de abastecimento e "onde esta indo o
 * dinheiro" — e a resposta e a ordem por gasto, nao alfabetica.
 */
export function agruparPor(
  linhas: readonly LinhaDeAbastecimento[],
  chave: ChaveDeAgrupamento,
): GrupoDoRelatorio[] {
  const grupos = new Map<string, LinhaDeAbastecimento[]>();

  for (const l of linhas) {
    const valor = (l[chave] ?? '').trim() || 'nao informado';
    const atual = grupos.get(valor) ?? [];
    atual.push(l);
    grupos.set(valor, atual);
  }

  return [...grupos.entries()]
    .map(([chaveDoGrupo, linhasDoGrupo]) => ({ chave: chaveDoGrupo, ...totaisDoRelatorio(linhasDoGrupo) }))
    .sort((a, b) => Number(b.valorTotal) - Number(a.valorTotal));
}
