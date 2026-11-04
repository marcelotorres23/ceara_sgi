import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db.js';
import { Decimal, centavos, dinheiro } from '../../core/money.js';
import {
  apurarKpisCompras,
  competenciaAnterior,
  competenciasDoAno,
  concentracaoDeFornecedores,
  curvaAbc,
  resumirEstoque,
  scorecardDeFornecedores,
  variacao,
  type LinhaKpiCompras,
} from './indicadores.js';

/**
 * Leitura das views materializadas (secao 10.3). Nenhum calculo pesado roda aqui:
 * a agregacao ja veio pronta do banco, e o que sobra e razao e ordenacao.
 *
 * `unidades` vazio significa rede inteira - so chega assim para quem tem `unidade:todas`.
 */

export const VIEWS = [
  'mv_spend_mensal',
  'mv_kpis_compras',
  'mv_estoque_posicao',
  'mv_otif_fornecedor',
] as const;

export type ViewMaterializada = (typeof VIEWS)[number];

/**
 * Atualiza as views. `CONCURRENTLY` nao bloqueia leitura, mas exige indice unico
 * e nao roda na primeira carga - por isso o fallback para o refresh comum.
 */
export async function atualizarViews(): Promise<Array<{ view: string; ms: number; concorrente: boolean }>> {
  const resultados: Array<{ view: string; ms: number; concorrente: boolean }> = [];

  for (const view of VIEWS) {
    const inicio = Date.now();
    let concorrente = true;
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
    } catch {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${view}`);
      concorrente = false;
    }
    resultados.push({ view, ms: Date.now() - inicio, concorrente });
  }

  return resultados;
}

/** Momento da ultima atualizacao de cada view - o painel precisa dizer de quando e o numero. */
export async function atualizadasEm(): Promise<Record<string, string | null>> {
  const linhas = await prisma.$queryRaw<Array<{ view: string; atualizada_em: Date | null }>>`
    SELECT c.relname AS view, s.last_refresh AS atualizada_em
    FROM pg_class c
    LEFT JOIN (
      SELECT relid, greatest(last_vacuum, last_autovacuum, last_analyze, last_autoanalyze) AS last_refresh
      FROM pg_stat_all_tables
    ) s ON s.relid = c.oid
    WHERE c.relkind = 'm'
  `;

  return Object.fromEntries(linhas.map((l) => [l.view, l.atualizada_em?.toISOString() ?? null]));
}

/** Fragmento de unidade para SQL puro: sem unidade informada, nao filtra. */
const filtroSql = (unidades: string[]): Prisma.Sql =>
  unidades.length > 0 ? Prisma.sql`AND unidade_id IN (${Prisma.join(unidades)})` : Prisma.empty;

// ---------------------------------------------------------------- spend analysis

interface LinhaSpend {
  categoria: string;
  fornecedor_id: string;
  fornecedor: string;
  pedidos: number;
  valor: Prisma.Decimal;
}

/** Spend analysis por categoria e fornecedor, com comparativo mes a mes e YTD (secao 10.2). */
export async function spendAnalysis(unidades: string[], competencia: string) {
  const anterior = competenciaAnterior(competencia);
  const doAno = competenciasDoAno(competencia);

  const [linhas, linhasAnteriores, ytd] = await Promise.all([
    prisma.$queryRaw<LinhaSpend[]>`
      SELECT categoria, fornecedor_id, fornecedor, SUM(pedidos)::int AS pedidos, SUM(valor) AS valor
      FROM mv_spend_mensal
      WHERE competencia = ${competencia} ${filtroSql(unidades)}
      GROUP BY categoria, fornecedor_id, fornecedor
    `,
    prisma.$queryRaw<Array<{ valor: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(valor), 0) AS valor
      FROM mv_spend_mensal
      WHERE competencia = ${anterior} ${filtroSql(unidades)}
    `,
    prisma.$queryRaw<Array<{ valor: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(valor), 0) AS valor
      FROM mv_spend_mensal
      WHERE competencia IN (${Prisma.join(doAno)}) ${filtroSql(unidades)}
    `,
  ]);

  const total = linhas.reduce<Decimal>((s, l) => s.plus(dinheiro(l.valor.toString())), new Decimal(0));

  // categoria agrega fornecedores; fornecedor agrega categorias
  const porCategoria = new Map<string, Decimal>();
  for (const l of linhas) {
    porCategoria.set(l.categoria, (porCategoria.get(l.categoria) ?? new Decimal(0)).plus(dinheiro(l.valor.toString())));
  }

  const porFornecedor = new Map<string, { fornecedor: string; valor: Decimal }>();
  for (const l of linhas) {
    const atual = porFornecedor.get(l.fornecedor_id) ?? { fornecedor: l.fornecedor, valor: new Decimal(0) };
    atual.valor = atual.valor.plus(dinheiro(l.valor.toString()));
    porFornecedor.set(l.fornecedor_id, atual);
  }

  return {
    competencia,
    total: centavos(total).toFixed(2),
    comparativoMesAnterior: variacao(total, linhasAnteriores[0]?.valor.toString() ?? '0'),
    acumuladoNoAno: centavos(dinheiro(ytd[0]?.valor.toString() ?? '0')).toFixed(2),
    porCategoria: [...porCategoria.entries()]
      .map(([categoria, valor]) => ({
        categoria,
        valor: centavos(valor).toFixed(2),
        participacao: total.greaterThan(0) ? Number(valor.dividedBy(total).toDecimalPlaces(4)) : null,
      }))
      .sort((a, b) => Number(b.valor) - Number(a.valor)),
    concentracao: concentracaoDeFornecedores(
      [...porFornecedor.entries()].map(([fornecedorId, f]) => ({
        fornecedorId,
        fornecedor: f.fornecedor,
        valor: f.valor,
      })),
    ),
    memoriaDeCalculo: {
      base: 'pedidos emitidos e nao cancelados, somados por item (quantidade x preco unitario)',
      recorte: 'competencia pela data de emissao do pedido, no fuso America/Fortaleza',
      concentracao: 'HHI = soma dos quadrados das participacoes; 1 = fonte unica',
      variacao: 'base zero no mes anterior devolve percentual nulo, nao 100%',
    },
  };
}

// ---------------------------------------------------------------- KPIs de compras

interface LinhaKpiSql {
  competencia: string;
  lotes: number;
  lotes_encerrados: number;
  lotes_cancelados: number;
  lotes_emergenciais: number;
  lotes_com_tres_propostas: number;
  lotes_acima_de_mil: number;
  lotes_no_sla: number;
  lotes_com_sla: number;
  lead_time_ate_aprovacao_dias: number | null;
  savings: Prisma.Decimal;
  valor_negociado: Prisma.Decimal;
}

const paraLinhaKpi = (l: LinhaKpiSql): LinhaKpiCompras => ({
  competencia: l.competencia,
  lotes: Number(l.lotes),
  lotesEncerrados: Number(l.lotes_encerrados),
  lotesCancelados: Number(l.lotes_cancelados),
  lotesEmergenciais: Number(l.lotes_emergenciais),
  lotesComTresPropostas: Number(l.lotes_com_tres_propostas),
  lotesAcimaDeMil: Number(l.lotes_acima_de_mil),
  lotesNoSla: Number(l.lotes_no_sla),
  lotesComSla: Number(l.lotes_com_sla),
  leadTimeAteAprovacaoDias: l.lead_time_ate_aprovacao_dias === null ? null : Number(Number(l.lead_time_ate_aprovacao_dias).toFixed(2)),
  savings: l.savings?.toString() ?? '0',
  valorNegociado: l.valor_negociado?.toString() ?? '0',
});

export async function kpisDeCompras(unidades: string[], competencia: string) {
  const linhas = await prisma.$queryRaw<LinhaKpiSql[]>`
    SELECT
      ${competencia}::text AS competencia,
      COALESCE(SUM(lotes), 0)::int                    AS lotes,
      COALESCE(SUM(lotes_encerrados), 0)::int         AS lotes_encerrados,
      COALESCE(SUM(lotes_cancelados), 0)::int         AS lotes_cancelados,
      COALESCE(SUM(lotes_emergenciais), 0)::int       AS lotes_emergenciais,
      COALESCE(SUM(lotes_com_tres_propostas), 0)::int AS lotes_com_tres_propostas,
      COALESCE(SUM(lotes_acima_de_mil), 0)::int       AS lotes_acima_de_mil,
      COALESCE(SUM(lotes_no_sla), 0)::int             AS lotes_no_sla,
      COALESCE(SUM(lotes_com_sla), 0)::int            AS lotes_com_sla,
      AVG(lead_time_ate_aprovacao_dias)               AS lead_time_ate_aprovacao_dias,
      COALESCE(SUM(savings), 0)                       AS savings,
      COALESCE(SUM(valor_negociado), 0)               AS valor_negociado
    FROM mv_kpis_compras
    WHERE competencia = ${competencia} ${filtroSql(unidades)}
  `;

  const linha = linhas[0];
  return apurarKpisCompras(
    linha
      ? paraLinhaKpi(linha)
      : {
          competencia,
          lotes: 0, lotesEncerrados: 0, lotesCancelados: 0, lotesEmergenciais: 0,
          lotesComTresPropostas: 0, lotesAcimaDeMil: 0, lotesNoSla: 0, lotesComSla: 0,
          leadTimeAteAprovacaoDias: null, savings: '0', valorNegociado: '0',
        },
  );
}

/** Serie de 12 competencias para o grafico de evolucao. */
export async function evolucaoDeCompras(unidades: string[], competencia: string) {
  const linhas = await prisma.$queryRaw<LinhaKpiSql[]>`
    SELECT competencia,
      SUM(lotes)::int AS lotes,
      SUM(lotes_encerrados)::int AS lotes_encerrados,
      SUM(lotes_cancelados)::int AS lotes_cancelados,
      SUM(lotes_emergenciais)::int AS lotes_emergenciais,
      SUM(lotes_com_tres_propostas)::int AS lotes_com_tres_propostas,
      SUM(lotes_acima_de_mil)::int AS lotes_acima_de_mil,
      SUM(lotes_no_sla)::int AS lotes_no_sla,
      SUM(lotes_com_sla)::int AS lotes_com_sla,
      AVG(lead_time_ate_aprovacao_dias) AS lead_time_ate_aprovacao_dias,
      SUM(savings) AS savings,
      SUM(valor_negociado) AS valor_negociado
    FROM mv_kpis_compras
    WHERE competencia <= ${competencia} ${filtroSql(unidades)}
    GROUP BY competencia
    ORDER BY competencia DESC
    LIMIT 12
  `;

  return linhas.map((l) => apurarKpisCompras(paraLinhaKpi(l))).reverse();
}

// ---------------------------------------------------------------- fornecedores

export async function scorecardFornecedores(unidades: string[], competencia: string) {
  const linhas = await prisma.$queryRaw<Array<{
    fornecedor_id: string;
    fornecedor: string;
    pedidos: number;
    entregues: number;
    otif: number;
    com_divergencia: number;
  }>>`
    SELECT fornecedor_id, fornecedor,
      SUM(pedidos)::int AS pedidos,
      SUM(entregues)::int AS entregues,
      SUM(otif)::int AS otif,
      SUM(com_divergencia)::int AS com_divergencia
    FROM mv_otif_fornecedor
    WHERE competencia <= ${competencia} ${filtroSql(unidades)}
    GROUP BY fornecedor_id, fornecedor
  `;

  return {
    competenciaAte: competencia,
    ...scorecardDeFornecedores(
      linhas.map((l) => ({
        fornecedorId: l.fornecedor_id,
        fornecedor: l.fornecedor,
        pedidos: Number(l.pedidos),
        entregues: Number(l.entregues),
        otif: Number(l.otif),
        comDivergencia: Number(l.com_divergencia),
      })),
    ),
    memoriaDeCalculo: {
      otif: 'recebido ate a data prometida original E com aceite total / pedidos emitidos',
      prazo: 'reprogramacao de entrega nao apaga o atraso: a base e a data prometida original',
      divergencia: 'recebimentos com aceite parcial ou recusa / pedidos emitidos',
      acumulado: 'todas as competencias ate a informada, para o score nao oscilar com um mes fraco',
    },
  };
}

// ---------------------------------------------------------------- estoque

export async function posicaoDeEstoque(unidades: string[]) {
  const [linhas, parametro] = await Promise.all([
    prisma.$queryRaw<Array<{
      item_id: string;
      item_codigo: string;
      item_descricao: string;
      almoxarifado: string;
      quantidade: Prisma.Decimal;
      custo_medio: Prisma.Decimal;
      valor: Prisma.Decimal;
      dias_sem_giro: number | null;
      critico: boolean;
    }>>`
      SELECT item_id, item_codigo, item_descricao, almoxarifado,
             quantidade, custo_medio, valor, dias_sem_giro, critico
      FROM mv_estoque_posicao
      WHERE quantidade > 0 ${filtroSql(unidades)}
    `,
    prisma.parametro.findUnique({ where: { chave: 'almoxarifado.dias_sem_giro' } }),
  ]);

  const diasSemGiro = Number(parametro?.valor ?? 180);

  // o mesmo item pode ter saldo em varios almoxarifados: a curva ABC olha o item
  const porItem = new Map<string, { codigo: string; descricao: string; valor: Decimal }>();
  for (const l of linhas) {
    const atual = porItem.get(l.item_id) ?? { codigo: l.item_codigo, descricao: l.item_descricao, valor: new Decimal(0) };
    atual.valor = atual.valor.plus(dinheiro(l.valor.toString()));
    porItem.set(l.item_id, atual);
  }

  return {
    curva: curvaAbc(
      [...porItem.entries()].map(([itemId, i]) => ({
        itemId,
        codigo: i.codigo,
        descricao: i.descricao,
        valor: i.valor,
      })),
    ),
    resumo: resumirEstoque(
      linhas.map((l) => ({
        itemId: l.item_id,
        codigo: l.item_codigo,
        descricao: l.item_descricao,
        valor: l.valor.toString(),
        diasSemGiro: l.dias_sem_giro,
      })),
      diasSemGiro,
    ),
    posicao: linhas.map((l) => ({
      itemId: l.item_id,
      codigo: l.item_codigo,
      descricao: l.item_descricao,
      almoxarifado: l.almoxarifado,
      critico: l.critico,
      quantidade: l.quantidade.toString(),
      custoMedio: l.custo_medio.toString(),
      valor: l.valor.toString(),
      diasSemGiro: l.dias_sem_giro,
    })),
    memoriaDeCalculo: {
      valor: 'saldo x custo medio ponderado movel, por item e almoxarifado',
      curvaAbc: 'itens ordenados por valor: A ate 80% do acumulado, B ate 95%, C o restante',
      semGiro: `sem movimentacao ha mais de ${diasSemGiro} dias (parametro almoxarifado.dias_sem_giro)`,
      escopo: 'apenas itens com saldo maior que zero',
    },
  };
}

// ---------------------------------------------------------------- painel executivo

/** Painel da Diretoria (secao 10.1): o consolidado que cabe numa tela. */
export async function painelExecutivo(unidades: string[], competencia: string) {
  const [spend, kpis, estoque, fornecedores, frota, alertas, atualizacao] = await Promise.all([
    spendAnalysis(unidades, competencia),
    kpisDeCompras(unidades, competencia),
    posicaoDeEstoque(unidades),
    scorecardFornecedores(unidades, competencia),
    custoDeFrotaNaCompetencia(unidades, competencia),
    alertasCriticos(unidades),
    atualizadasEm(),
  ]);

  return {
    competencia,
    unidades: unidades.length > 0 ? unidades : 'TODAS',
    gasto: {
      total: spend.total,
      acumuladoNoAno: spend.acumuladoNoAno,
      comparativo: spend.comparativoMesAnterior,
    },
    compras: {
      lotes: kpis.lotes,
      savings: kpis.savingsValor,
      savingsPercentual: kpis.savings.valor,
      aderenciaSla: kpis.aderenciaSla.valor,
      taxaEmergencial: kpis.taxaEmergencial.valor,
    },
    frota,
    estoque: {
      valorImobilizado: estoque.resumo.valorTotal,
      percentualSemGiro: estoque.resumo.percentualSemGiro,
      itensSemGiro: estoque.resumo.itensSemGiro,
    },
    fornecedores: {
      otif: fornecedores.consolidado.otifPercentual,
      indiceDivergencia: fornecedores.consolidado.indiceDivergencia,
      concentracao: spend.concentracao.risco,
      hhi: spend.concentracao.hhi,
      top10: spend.concentracao.ranking.slice(0, 10),
    },
    alertas,
    // o painel precisa dizer de quando e o numero que esta mostrando
    dadosAtualizadosEm: atualizacao,
    memoriaDeCalculo: {
      ...spend.memoriaDeCalculo,
      origem: 'views materializadas atualizadas por job; nenhum calculo pesado em request',
    },
  };
}

/** Custo de frota da competencia: combustivel + manutencao, com custo por km. */
async function custoDeFrotaNaCompetencia(unidades: string[], competencia: string) {
  const inicio = new Date(`${competencia}-01T00:00:00Z`);
  const fim = new Date(inicio);
  fim.setUTCMonth(fim.getUTCMonth() + 1);

  const recorte = unidades.length > 0 ? { unidadeId: { in: unidades } } : {};

  const [abastecimento, manutencao] = await Promise.all([
    prisma.abastecimento.aggregate({
      where: { deletedAt: null, dataHora: { gte: inicio, lt: fim }, veiculo: recorte },
      _sum: { valorTotal: true, kmPercorridos: true },
    }),
    prisma.ordemServico.aggregate({
      where: { deletedAt: null, status: { not: 'CANCELADA' }, abertaEm: { gte: inicio, lt: fim }, ...recorte },
      _sum: { custoTotal: true },
    }),
  ]);

  const combustivel = dinheiro(abastecimento._sum.valorTotal?.toString() ?? '0');
  const oficina = dinheiro(manutencao._sum.custoTotal?.toString() ?? '0');
  const km = dinheiro(abastecimento._sum.kmPercorridos?.toString() ?? '0');
  const total = combustivel.plus(oficina);

  return {
    custoTotal: centavos(total).toFixed(2),
    combustivel: centavos(combustivel).toFixed(2),
    manutencao: centavos(oficina).toFixed(2),
    kmRodados: km.toFixed(1),
    custoPorKm: km.greaterThan(0) ? total.dividedBy(km).toDecimalPlaces(4).toFixed(4) : null,
  };
}

/** Alertas críticos abertos que a Diretoria precisa ver (secao 10.1). */
async function alertasCriticos(unidades: string[]) {
  const recorte = unidades.length > 0 ? { unidadeId: { in: unidades } } : {};
  const recorteVeiculo = unidades.length > 0 ? { veiculo: { unidadeId: { in: unidades } } } : {};

  const [bloqueados, semNota, contestacoes] = await Promise.all([
    prisma.lote.count({ where: { deletedAt: null, status: 'BLOQUEADO_DIVERGENCIA', ...recorte } }),
    prisma.pedido.count({
      where: {
        deletedAt: null,
        status: 'RECEBIDO',
        recebimentos: { some: { deletedAt: null, recebidoEm: { lt: new Date(Date.now() - 5 * 86_400_000) } } },
        lote: recorte,
      },
    }),
    prisma.ocorrencia.count({
      where: { status: 'CONTESTADA', colaborador: { deletedAt: null, ...recorte } },
    }),
  ]);

  return {
    lotesBloqueadosPorDivergencia: bloqueados,
    pedidosSemNotaHaMaisDe5Dias: semNota,
    contestacoesAguardandoDecisao: contestacoes,
  };
}
