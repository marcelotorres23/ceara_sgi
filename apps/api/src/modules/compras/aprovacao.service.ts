import { prisma } from '../../core/db.js';
import type { AccessClaims } from '../../core/auth/tokens.js';
import { filtroUnidade } from '../../core/rbac/escopo.js';
import { NotFoundError } from '../../core/errors/index.js';
import { Decimal, dinheiro } from '../../core/money.js';
import { avaliarSod } from '../../core/rbac/sod.js';
import { aprovadorHabilitado } from './alcada.js';
import * as parametros from './parametros.js';
import { horasUteisEntre, somarHorasUteis } from './horas-uteis.js';
import { agruparPorMes, consumoDoOrcamento, ratearLote, type PesoDeSolicitacao } from './rateio-centro-custo.js';

/**
 * Mesa do aprovador (secoes 6.1.7 e 6.4).
 *
 * O aprovador nao decide sobre um numero solto: ele decide sobre um gasto de uma placa.
 * Por isso a fila entrega, junto do lote, o centro de custo e a placa que ele custeia -
 * e a tela abre o historico daquele centro sem sair da decisao.
 *
 * A decisao em si continua em `service.decidirAprovacao`: aqui so se le.
 */

const MESES_DE_HISTORICO_PADRAO = 12;

/** Competencia AAAA-MM em UTC, mesma chave usada em `agruparPorMes`. */
const competencia = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export interface FiltrosDaFila {
  unidadeId?: string | null;
  centroCustoId?: string | null;
  cursor?: string | null;
  limite: number;
}

/**
 * Lotes parados em AGUARDANDO_APROVACAO, com o que o aprovador precisa para decidir:
 * valor, faixa, escolha divergente, centros de custo com placa e SLA em horas uteis.
 */
export async function filaDeAprovacao(claims: AccessClaims, filtros: FiltrosDaFila) {
  const lotes = await prisma.lote.findMany({
    where: {
      deletedAt: null,
      status: 'AGUARDANDO_APROVACAO',
      ...filtroUnidade(claims, filtros.unidadeId),
      ...(filtros.centroCustoId
        ? { solicitacoes: { some: { centroCustoId: filtros.centroCustoId } } }
        : {}),
    },
    include: {
      comprador: { select: { id: true, nome: true } },
      solicitacoes: {
        select: {
          id: true,
          numero: true,
          solicitanteId: true,
          centroCustoId: true,
          centroCusto: {
            select: {
              id: true,
              codigo: true,
              nome: true,
              orcamentoMensal: true,
              veiculos: {
                where: { deletedAt: null },
                select: { id: true, placa: true, frotaNumero: true },
                orderBy: { placa: 'asc' },
              },
            },
          },
          _count: { select: { itens: true } },
        },
      },
      mapas: { orderBy: { geradoEm: 'desc' }, take: 1 },
      transicoes: { where: { para: 'AGUARDANDO_APROVACAO' }, orderBy: { createdAt: 'desc' }, take: 1 },
      _count: { select: { cotacoes: true } },
    },
    orderBy: { id: 'asc' },
    take: filtros.limite + 1,
    ...(filtros.cursor ? { cursor: { id: filtros.cursor }, skip: 1 } : {}),
  });

  const temProxima = lotes.length > filtros.limite;
  const pagina = temProxima ? lotes.slice(0, filtros.limite) : lotes;

  const [cal, alcadas] = await Promise.all([
    parametros.calendario(),
    prisma.alcada.findMany({ where: { ativo: true }, select: { nivel: true, slaHoras: true } }),
  ]);
  const slaPorNivel = new Map(alcadas.map((a) => [a.nivel, a.slaHoras]));
  const agora = new Date();

  const itens = pagina.map((lote) => {
    const submetidoEm = lote.transicoes[0]?.createdAt ?? null;
    const slaHoras = lote.nivelAlcada !== null ? slaPorNivel.get(lote.nivelAlcada) ?? null : null;
    const prazoLimite =
      submetidoEm && slaHoras !== null ? somarHorasUteis(submetidoEm, slaHoras, cal) : null;

    // horas uteis, nao corridas: um lote submetido na sexta a tarde nao "atrasa" no domingo
    const horasRestantes = prazoLimite
      ? prazoLimite > agora
        ? horasUteisEntre(agora, prazoLimite, cal)
        : -horasUteisEntre(prazoLimite, agora, cal)
      : null;

    const parcelas = ratearLote(lote.valorEstimado?.toString() ?? '0', pesosDe(lote.solicitacoes));
    const porCentro = new Map(parcelas.map((p) => [p.centroCustoId, p]));

    const centros = [...new Map(lote.solicitacoes.map((s) => [s.centroCustoId, s.centroCusto])).values()].map((c) => ({
      id: c.id,
      codigo: c.codigo,
      nome: c.nome,
      // uma placa por centro e o desenho normal; a lista cobre o centro administrativo
      placas: c.veiculos.map((v) => v.placa),
      valorAtribuido: (porCentro.get(c.id)?.valor ?? new Decimal(0)).toFixed(2),
      rateado: porCentro.get(c.id)?.rateado ?? false,
    }));

    const mapa = lote.mapas[0];

    return {
      id: lote.id,
      numero: lote.numero,
      criticidade: lote.criticidade,
      valorEstimado: lote.valorEstimado?.toFixed(2) ?? null,
      nivelAlcada: lote.nivelAlcada,
      comprador: lote.comprador,
      solicitantesIds: lote.solicitacoes.map((s) => s.solicitanteId),
      solicitacoes: lote.solicitacoes.map((s) => ({ id: s.id, numero: s.numero, itens: s._count.itens })),
      cotacoes: lote._count.cotacoes,
      centros,
      divergenteMenorPreco: mapa?.divergenteMenorPreco ?? false,
      justificativa: mapa?.justificativa ?? null,
      submetidoEm,
      slaHoras,
      prazoLimite,
      horasRestantes,
      atrasado: horasRestantes !== null && horasRestantes < 0,
    };
  });

  return { itens, proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null };
}

const pesosDe = (
  solicitacoes: Array<{ id: string; centroCustoId: string; _count: { itens: number } }>,
): PesoDeSolicitacao[] =>
  solicitacoes.map((s) => ({ solicitacaoId: s.id, centroCustoId: s.centroCustoId, peso: s._count.itens }));

export interface SituacaoDaAprovacao {
  /** o lote esta na etapa em que a decisao cabe */
  aplicavel: boolean;
  /** valor que enquadrou a faixa — o fechado do mapa, ou o estimado enquanto nao ha mapa */
  valor: string | null;
  nivel: number | null;
  /** perfil que a matriz designa para esta faixa */
  perfilExigido: string | null;
  /** maior faixa que os perfis de quem esta olhando alcancam */
  nivelMaximo: number | null;
  /** true quando o botao deve ficar ativo */
  pode: boolean;
  /** por que nao pode, pronto para a tela */
  motivo: string | null;
}

/**
 * O que a tela do lote precisa para decidir se o botao de aprovar fica ativo (secao 6.4).
 *
 * Reune, num lugar so, as tres coisas que separam "ver o lote" de "poder aprova-lo": a
 * permissao, a faixa em que o valor caiu, e a segregacao de funcoes. Botao que fica ativo e
 * so falha no clique ensina a pessoa a nao confiar na tela.
 *
 * O calculo e o mesmo que `decidirAprovacao` refaz no servidor na hora de gravar — aqui e
 * so leitura, para a tela nao ter que adivinhar.
 */
export async function situacaoDaAprovacao(
  lote: {
    status: string;
    nivelAlcada: number | null;
    valorFechado: { toString(): string } | null;
    valorEstimado: { toString(): string } | null;
    compradorId: string | null;
    solicitacoes: Array<{ solicitanteId: string }>;
  },
  usuario: { sub: string; perfis: string[]; permissoes: string[] },
): Promise<SituacaoDaAprovacao> {
  const valor = (lote.valorFechado ?? lote.valorEstimado)?.toString() ?? null;
  const base = { valor, nivel: lote.nivelAlcada, nivelMaximo: null, perfilExigido: null };

  if (lote.status !== 'AGUARDANDO_APROVACAO') {
    return { ...base, aplicavel: false, pode: false, motivo: 'Este lote nao esta aguardando aprovacao.' };
  }

  if (!usuario.permissoes.includes('lote:aprovar')) {
    return { ...base, aplicavel: true, pode: false, motivo: 'Seu perfil nao aprova compras.' };
  }

  const alcadas = await prisma.alcada.findMany({
    where: { ativo: true },
    include: { perfilAprovador: true },
    orderBy: { nivel: 'asc' },
  });
  const faixas = alcadas.map((a) => ({
    nivel: a.nivel,
    valorMin: a.valorMin.toString(),
    valorMax: a.valorMax?.toString() ?? null,
    perfilAprovador: a.perfilAprovador.nome,
    propostasMinimas: a.propostasMinimas,
    slaHoras: a.slaHoras,
  }));

  const habilitacao = aprovadorHabilitado(faixas, lote.nivelAlcada ?? 0, usuario.perfis);
  const comum = {
    ...base,
    aplicavel: true,
    nivel: habilitacao.nivelExigido,
    perfilExigido: habilitacao.perfilExigido,
    nivelMaximo: habilitacao.nivelMaximo,
  };

  if (!habilitacao.pode) return { ...comum, pode: false, motivo: habilitacao.motivo ?? null };

  // a mesma avaliacao que `decidirAprovacao` fara ao gravar — aqui so para nao oferecer o clique
  const sod = avaliarSod({
    usuarioId: usuario.sub,
    acao: 'APROVAR',
    solicitantesIds: lote.solicitacoes.map((s) => s.solicitanteId),
    compradorId: lote.compradorId,
    nivelAlcada: lote.nivelAlcada,
    entidade: 'lotes',
    entidadeId: '',
  });
  if (!sod.permitido) return { ...comum, pode: false, motivo: sod.mensagem ?? 'Segregacao de funcoes.' };

  return { ...comum, pode: true, motivo: null };
}

export interface FiltrosDoHistorico {
  meses?: number;
  unidadeId?: string | null;
}

/**
 * Historico de compras do centro de custo - a placa, na pratica.
 *
 * Cobre o que ja foi pedido (valor apurado do pedido) e o que esta em andamento
 * (valor ainda estimado do lote), porque negar um lote sem saber que ha outros tres
 * abertos para a mesma placa e decidir no escuro.
 */
export async function historicoDoCentroCusto(
  claims: AccessClaims,
  centroCustoId: string,
  filtros: FiltrosDoHistorico = {},
) {
  const meses = Math.min(Math.max(filtros.meses ?? MESES_DE_HISTORICO_PADRAO, 1), 36);

  const centro = await prisma.centroCusto.findFirst({
    where: { id: centroCustoId, deletedAt: null, ...filtroUnidade(claims, filtros.unidadeId) },
    include: {
      responsavel: { select: { id: true, nome: true } },
      veiculos: {
        where: { deletedAt: null },
        select: { id: true, placa: true, frotaNumero: true, marca: true, modelo: true, status: true },
        orderBy: { placa: 'asc' },
      },
    },
  });
  if (!centro) throw new NotFoundError('Centro de custo');

  const desde = new Date();
  desde.setUTCMonth(desde.getUTCMonth() - meses);

  const solicitacoes = await prisma.solicitacao.findMany({
    where: { centroCustoId, deletedAt: null, createdAt: { gte: desde } },
    select: {
      id: true,
      numero: true,
      status: true,
      createdAt: true,
      centroCustoId: true,
      solicitante: { select: { nome: true } },
      _count: { select: { itens: true } },
      lote: {
        select: {
          id: true,
          numero: true,
          status: true,
          valorEstimado: true,
          aprovadoEm: true,
          solicitacoes: { select: { id: true, centroCustoId: true, _count: { select: { itens: true } } } },
          pedidos: {
            where: { deletedAt: null },
            select: {
              id: true,
              numero: true,
              valorTotal: true,
              status: true,
              dataPrometida: true,
              createdAt: true,
              fornecedor: { select: { razaoSocial: true } },
              itens: { select: { descricao: true, quantidade: true, precoUnitario: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // um lote atende varias solicitacoes: sem deduplicar, o pedido entraria duas vezes
  const lotesVistos = new Set<string>();
  const compras: Array<{
    loteId: string;
    loteNumero: string;
    loteStatus: string;
    pedidoId: string | null;
    pedidoNumero: string | null;
    fornecedor: string | null;
    data: Date;
    valorCentro: string;
    valorTotalLote: string;
    rateado: boolean;
    /** null quando o lote ainda nao tem valor apurado - zero seria lido como "sem custo" */
    valorApurado: boolean;
    situacao: 'PEDIDO' | 'EM_ANDAMENTO';
    itens: Array<{ descricao: string; quantidade: string; precoUnitario: string }>;
  }> = [];

  for (const s of solicitacoes) {
    const lote = s.lote;
    if (!lote || lotesVistos.has(lote.id)) continue;
    lotesVistos.add(lote.id);

    const pesos = pesosDe(lote.solicitacoes);
    const parcelaDe = (valor: string) =>
      ratearLote(valor, pesos).find((p) => p.centroCustoId === centroCustoId) ?? null;

    if (lote.pedidos.length > 0) {
      for (const pedido of lote.pedidos) {
        const parcela = parcelaDe(pedido.valorTotal.toString());
        compras.push({
          loteId: lote.id,
          loteNumero: lote.numero,
          loteStatus: lote.status,
          pedidoId: pedido.id,
          pedidoNumero: pedido.numero,
          fornecedor: pedido.fornecedor.razaoSocial,
          data: pedido.createdAt,
          valorCentro: (parcela?.valor ?? new Decimal(0)).toFixed(2),
          valorTotalLote: pedido.valorTotal.toFixed(2),
          rateado: parcela?.rateado ?? false,
          valorApurado: true,
          situacao: 'PEDIDO',
          itens: pedido.itens.map((i) => ({
            descricao: i.descricao,
            quantidade: i.quantidade.toString(),
            precoUnitario: i.precoUnitario.toFixed(2),
          })),
        });
      }
      continue;
    }

    // lote ainda sem pedido: entra como compromisso em andamento, com valor estimado
    if (!['CANCELADO', 'REPROVADO'].includes(lote.status)) {
      const parcela = parcelaDe(lote.valorEstimado?.toString() ?? '0');
      compras.push({
        loteId: lote.id,
        loteNumero: lote.numero,
        loteStatus: lote.status,
        pedidoId: null,
        pedidoNumero: null,
        fornecedor: null,
        data: s.createdAt,
        valorCentro: (parcela?.valor ?? new Decimal(0)).toFixed(2),
        valorTotalLote: lote.valorEstimado?.toFixed(2) ?? '0.00',
        rateado: parcela?.rateado ?? false,
        // lote antes do mapa nao tem valor: a tela mostra traco, nao R$ 0,00
        valorApurado: lote.valorEstimado !== null,
        situacao: 'EM_ANDAMENTO',
        itens: [],
      });
    }
  }

  compras.sort((a, b) => b.data.getTime() - a.data.getTime());

  const pedidas = compras.filter((c) => c.situacao === 'PEDIDO');
  const totalPedido = pedidas.reduce<Decimal>((acc, c) => acc.plus(dinheiro(c.valorCentro)), new Decimal(0));
  const totalEmAndamento = compras
    .filter((c) => c.situacao === 'EM_ANDAMENTO')
    .reduce<Decimal>((acc, c) => acc.plus(dinheiro(c.valorCentro)), new Decimal(0));

  const serie = agruparPorMes(pedidas.map((c) => ({ data: c.data, valor: c.valorCentro })));
  const mesAtual = competencia(new Date());
  const gastoDoMes = serie.find((m) => m.mes === mesAtual)?.valor ?? new Decimal(0);
  const orcamento = consumoDoOrcamento(gastoDoMes, centro.orcamentoMensal?.toString() ?? null);

  // o que mais consome esta placa: base objetiva para o aprovador questionar recorrencia
  const porItem = new Map<string, { descricao: string; quantidade: Decimal; valor: Decimal; vezes: number }>();
  for (const c of pedidas) {
    for (const i of c.itens) {
      const chave = i.descricao.trim().toLowerCase();
      const atual = porItem.get(chave) ?? {
        descricao: i.descricao,
        quantidade: new Decimal(0),
        valor: new Decimal(0),
        vezes: 0,
      };
      porItem.set(chave, {
        descricao: atual.descricao,
        quantidade: atual.quantidade.plus(dinheiro(i.quantidade)),
        valor: atual.valor.plus(dinheiro(i.quantidade).times(dinheiro(i.precoUnitario))),
        vezes: atual.vezes + 1,
      });
    }
  }

  const itensRecorrentes = [...porItem.values()]
    .sort((a, b) => b.valor.comparedTo(a.valor))
    .slice(0, 10)
    .map((i) => ({
      descricao: i.descricao,
      quantidade: i.quantidade.toDecimalPlaces(4).toString(),
      valor: i.valor.toDecimalPlaces(2).toFixed(2),
      vezes: i.vezes,
    }));

  return {
    centro: {
      id: centro.id,
      codigo: centro.codigo,
      nome: centro.nome,
      unidadeId: centro.unidadeId,
      orcamentoMensal: centro.orcamentoMensal?.toFixed(2) ?? null,
      responsavel: centro.responsavel,
      veiculos: centro.veiculos,
    },
    janela: { meses, desde },
    resumo: {
      totalPedido: totalPedido.toFixed(2),
      totalEmAndamento: totalEmAndamento.toFixed(2),
      pedidos: pedidas.length,
      solicitacoes: solicitacoes.length,
      ticketMedio: pedidas.length > 0 ? totalPedido.dividedBy(pedidas.length).toDecimalPlaces(2).toFixed(2) : '0.00',
      gastoDoMes: gastoDoMes.toFixed(2),
      percentualDoOrcamento: orcamento.percentual,
      estourouOrcamento: orcamento.estourou,
    },
    porMes: serie.map((m) => ({ mes: m.mes, valor: m.valor.toFixed(2), pedidos: m.pedidos })),
    itensRecorrentes,
    compras: compras.slice(0, 100),
    memoriaDeCalculo: {
      atribuicao:
        'Lote de um unico centro entra pelo valor cheio. Lote que mistura centros e rateado pela quantidade de itens de cada solicitacao, e a linha sai marcada como rateada.',
      apurado: 'Total pedido soma pedidos emitidos. Em andamento soma lotes ainda sem pedido, pelo valor estimado.',
      janela: `Considera solicitacoes abertas nos ultimos ${meses} meses.`,
    },
  };
}
