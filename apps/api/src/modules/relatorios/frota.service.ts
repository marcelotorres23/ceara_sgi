import { prisma } from '../../core/db.js';
import { Decimal, centavos, dinheiro } from '../../core/money.js';

/**
 * Relatorios de frota (secao 7.8), sempre recortados por unidade.
 *
 * `unidades` vazio significa rede inteira - so chega assim para quem tem `unidade:todas`.
 * Toda saida traz a memoria de calculo: o usuario precisa poder auditar o numero (secao 10.3).
 */

export interface Periodo {
  de: Date;
  ate: Date;
}

const recorteVeiculo = (unidades: string[]) => (unidades.length > 0 ? { unidadeId: { in: unidades } } : {});

export interface CustoDoVeiculo {
  veiculoId: string;
  placa: string;
  frotaNumero: string;
  unidade: string;
  combustivel: string;
  manutencao: string;
  pecas: string;
  pneus: string;
  custoTotal: string;
  kmRodados: string;
  /** custo total / km rodados no periodo; null quando o veiculo nao rodou */
  custoPorKm: string | null;
  consumoMedioKml: string | null;
}

/**
 * Custo total de propriedade por veiculo (secao 10.2): combustivel + manutencao + pneus.
 * Depreciacao fica de fora enquanto nao houver valor de aquisicao cadastrado - melhor
 * um numero incompleto e declarado do que um numero inventado.
 */
export async function custoPorVeiculo(unidades: string[], periodo: Periodo): Promise<{
  itens: CustoDoVeiculo[];
  totais: { combustivel: string; manutencao: string; pneus: string; custoTotal: string; kmRodados: string };
  memoriaDeCalculo: Record<string, string>;
}> {
  const janela = { gte: periodo.de, lte: periodo.ate };

  const veiculos = await prisma.veiculo.findMany({
    where: { deletedAt: null, status: { not: 'VENDIDO' }, ...recorteVeiculo(unidades) },
    select: { id: true, placa: true, frotaNumero: true, unidade: { select: { codigo: true } } },
    orderBy: { frotaNumero: 'asc' },
  });
  if (veiculos.length === 0) {
    return {
      itens: [],
      totais: { combustivel: '0.00', manutencao: '0.00', pneus: '0.00', custoTotal: '0.00', kmRodados: '0.0' },
      memoriaDeCalculo: MEMORIA_CUSTO,
    };
  }

  const ids = veiculos.map((v) => v.id);

  const [abastecimentos, ordens, movimentacoesPneu] = await Promise.all([
    prisma.abastecimento.groupBy({
      by: ['veiculoId'],
      where: { deletedAt: null, veiculoId: { in: ids }, dataHora: janela },
      _sum: { valorTotal: true, litros: true, kmPercorridos: true },
    }),
    prisma.ordemServico.groupBy({
      by: ['veiculoId'],
      where: { deletedAt: null, status: { not: 'CANCELADA' }, veiculoId: { in: ids }, abertaEm: janela },
      _sum: { custoTotal: true, custoPecas: true },
    }),
    prisma.pneuMovimentacao.groupBy({
      by: ['veiculoId'],
      where: { veiculoId: { in: ids }, data: janela },
      _sum: { custo: true },
    }),
  ]);

  const porVeiculo = <T extends { veiculoId: string | null }>(linhas: T[]) =>
    new Map(linhas.filter((l) => l.veiculoId).map((l) => [l.veiculoId!, l]));

  const mapaAbastecimento = porVeiculo(abastecimentos);
  const mapaOs = porVeiculo(ordens);
  const mapaPneu = porVeiculo(movimentacoesPneu);

  let totalCombustivel = new Decimal(0);
  let totalManutencao = new Decimal(0);
  let totalPneus = new Decimal(0);
  let totalKm = new Decimal(0);

  const itens = veiculos.map((v) => {
    const ab = mapaAbastecimento.get(v.id);
    const os = mapaOs.get(v.id);
    const pn = mapaPneu.get(v.id);

    const combustivel = dinheiro(ab?._sum.valorTotal?.toString() ?? '0');
    const manutencao = dinheiro(os?._sum.custoTotal?.toString() ?? '0');
    const pecas = dinheiro(os?._sum.custoPecas?.toString() ?? '0');
    const pneus = dinheiro(pn?._sum.custo?.toString() ?? '0');
    const km = dinheiro(ab?._sum.kmPercorridos?.toString() ?? '0');
    const litros = dinheiro(ab?._sum.litros?.toString() ?? '0');

    const custoTotal = combustivel.plus(manutencao).plus(pneus);

    totalCombustivel = totalCombustivel.plus(combustivel);
    totalManutencao = totalManutencao.plus(manutencao);
    totalPneus = totalPneus.plus(pneus);
    totalKm = totalKm.plus(km);

    return {
      veiculoId: v.id,
      placa: v.placa,
      frotaNumero: v.frotaNumero,
      unidade: v.unidade.codigo,
      combustivel: centavos(combustivel).toFixed(2),
      manutencao: centavos(manutencao).toFixed(2),
      pecas: centavos(pecas).toFixed(2),
      pneus: centavos(pneus).toFixed(2),
      custoTotal: centavos(custoTotal).toFixed(2),
      kmRodados: km.toFixed(1),
      custoPorKm: km.greaterThan(0) ? custoTotal.dividedBy(km).toDecimalPlaces(4).toFixed(4) : null,
      consumoMedioKml: litros.greaterThan(0) ? km.dividedBy(litros).toDecimalPlaces(3).toFixed(3) : null,
    };
  });

  return {
    itens: itens.sort((a, b) => Number(b.custoTotal) - Number(a.custoTotal)),
    totais: {
      combustivel: centavos(totalCombustivel).toFixed(2),
      manutencao: centavos(totalManutencao).toFixed(2),
      pneus: centavos(totalPneus).toFixed(2),
      custoTotal: centavos(totalCombustivel.plus(totalManutencao).plus(totalPneus)).toFixed(2),
      kmRodados: totalKm.toFixed(1),
    },
    memoriaDeCalculo: MEMORIA_CUSTO,
  };
}

const MEMORIA_CUSTO: Record<string, string> = {
  custoTotal: 'combustivel + manutencao (pecas e mao de obra da OS) + custos de pneu no periodo',
  custoPorKm: 'custo total / km percorridos apurados nos abastecimentos do periodo',
  consumo: 'km percorridos / litros abastecidos no periodo',
  depreciacao: 'fora do calculo: valor de aquisicao do veiculo ainda nao e cadastrado',
  pecas: 'saidas de estoque vinculadas a OS, valorizadas pelo custo medio ponderado movel',
};

export interface ConsumoPorMotorista {
  motoristaId: string;
  nome: string;
  unidade: string;
  abastecimentos: number;
  litros: string;
  kmRodados: string;
  consumoMedioKml: string | null;
  anomalias: number;
}

/** Ranking de consumo por motorista (secao 7.8), com contagem de anomalias do periodo. */
export async function consumoPorMotorista(unidades: string[], periodo: Periodo): Promise<ConsumoPorMotorista[]> {
  const abastecimentos = await prisma.abastecimento.findMany({
    where: {
      deletedAt: null,
      dataHora: { gte: periodo.de, lte: periodo.ate },
      veiculo: recorteVeiculo(unidades),
    },
    select: {
      motoristaId: true,
      litros: true,
      kmPercorridos: true,
      anomalia: true,
      motorista: { select: { nome: true, unidade: { select: { codigo: true } } } },
    },
  });

  const grupos = new Map<string, ConsumoPorMotorista & { _litros: Decimal; _km: Decimal }>();

  for (const a of abastecimentos) {
    const atual = grupos.get(a.motoristaId) ?? {
      motoristaId: a.motoristaId,
      nome: a.motorista.nome,
      unidade: a.motorista.unidade.codigo,
      abastecimentos: 0,
      litros: '0',
      kmRodados: '0',
      consumoMedioKml: null,
      anomalias: 0,
      _litros: new Decimal(0),
      _km: new Decimal(0),
    };

    atual.abastecimentos += 1;
    if (a.anomalia) atual.anomalias += 1;
    atual._litros = atual._litros.plus(dinheiro(a.litros.toString()));
    atual._km = atual._km.plus(dinheiro(a.kmPercorridos?.toString() ?? '0'));

    grupos.set(a.motoristaId, atual);
  }

  return [...grupos.values()]
    .map(({ _litros, _km, ...linha }) => ({
      ...linha,
      litros: _litros.toFixed(3),
      kmRodados: _km.toFixed(1),
      consumoMedioKml: _litros.greaterThan(0) ? _km.dividedBy(_litros).toDecimalPlaces(3).toFixed(3) : null,
    }))
    // pior consumo primeiro: e o que exige conversa
    .sort((a, b) => Number(a.consumoMedioKml ?? Infinity) - Number(b.consumoMedioKml ?? Infinity));
}

/** Vida util media de pneus por marca, base para decisao de compra (secao 7.8). */
export async function vidaUtilDePneus(unidades: string[]) {
  const pneus = await prisma.pneu.findMany({
    where: {
      deletedAt: null,
      status: { in: ['SUCATA', 'EM_RECAPAGEM'] },
      ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}),
    },
    select: { marca: true, modelo: true, kmAcumulado: true, recapagens: true },
  });

  const grupos = new Map<string, { km: Decimal; pneus: number; recapagens: number }>();
  for (const p of pneus) {
    const chave = `${p.marca} ${p.modelo}`;
    const atual = grupos.get(chave) ?? { km: new Decimal(0), pneus: 0, recapagens: 0 };
    grupos.set(chave, {
      km: atual.km.plus(dinheiro(p.kmAcumulado.toString())),
      pneus: atual.pneus + 1,
      recapagens: atual.recapagens + p.recapagens,
    });
  }

  return [...grupos.entries()]
    .map(([chave, g]) => ({
      chave,
      pneus: g.pneus,
      kmMedio: g.km.dividedBy(g.pneus).toDecimalPlaces(1).toFixed(1),
      recapagensMedia: Number((g.recapagens / g.pneus).toFixed(2)),
    }))
    .sort((a, b) => Number(b.kmMedio) - Number(a.kmMedio));
}
