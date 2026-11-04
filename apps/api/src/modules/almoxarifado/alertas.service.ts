import { prisma } from '../../core/db.js';
import { notificarPorPermissao } from '../../core/notifications/index.js';
import { montarPainelDeAlertas, sugerirPontoPedido, type LinhaEstoque } from './estoque.js';

async function diasSemGiro(): Promise<number> {
  const p = await prisma.parametro.findUnique({ where: { chave: 'almoxarifado.dias_sem_giro' } });
  return Number(p?.valor ?? 180);
}

async function carregarLinhas(almoxarifadoId?: string): Promise<LinhaEstoque[]> {
  const saldos = await prisma.saldo.findMany({
    where: { ...(almoxarifadoId ? { almoxarifadoId } : {}), item: { deletedAt: null } },
    include: {
      item: { select: { codigo: true, descricao: true, critico: true } },
      almoxarifado: { select: { codigo: true, nome: true } },
    },
    take: 1000,
  });

  return saldos.map((s) => ({
    itemId: s.itemId,
    codigo: s.item.codigo,
    descricao: s.item.descricao,
    almoxarifado: `${s.almoxarifado.codigo} — ${s.almoxarifado.nome}`,
    critico: s.item.critico,
    saldo: s.quantidade.toString(),
    custoMedio: s.custoMedio.toString(),
    estoqueMinimo: s.estoqueMinimo.toString(),
    estoqueMaximo: s.estoqueMaximo?.toString() ?? null,
    pontoPedido: s.pontoPedido.toString(),
    loteEconomico: s.loteEconomico?.toString() ?? null,
    leadTimeDias: s.leadTimeDias,
    consumoMedioMensal: s.consumoMedioMensal.toString(),
    ultimaMovimentacaoEm: s.ultimaMovimentacaoEm,
  }));
}

/** Painel de alertas com semaforo (secao 8.3). */
export async function painelDeAlertas(almoxarifadoId?: string, agora = new Date()) {
  const [linhas, dias] = await Promise.all([carregarLinhas(almoxarifadoId), diasSemGiro()]);
  return montarPainelDeAlertas(linhas, dias, agora);
}

/**
 * Recalcula o consumo medio mensal a partir das saidas dos ultimos N meses
 * e sugere o ponto de pedido. O sugerido NAO sobrescreve valor fixado pelo gestor.
 */
export async function recalcularConsumo(meses: 3 | 6 | 12 = 6, agora = new Date()) {
  const desde = new Date(agora.getTime() - meses * 30 * 86_400_000);

  const consumo = await prisma.movimentacao.groupBy({
    by: ['almoxarifadoId', 'itemId'],
    where: { tipo: 'SAIDA_REQUISICAO', createdAt: { gte: desde } },
    _sum: { quantidade: true },
  });

  let atualizados = 0;

  for (const c of consumo) {
    const saldo = await prisma.saldo.findUnique({
      where: { almoxarifadoId_itemId: { almoxarifadoId: c.almoxarifadoId, itemId: c.itemId } },
    });
    if (!saldo) continue;

    const medio = (c._sum.quantidade ?? 0).toString();
    const consumoMedioMensal = (Number(medio) / meses).toFixed(4);
    const sugestao = sugerirPontoPedido({ consumoMedioMensal, leadTimeDias: saldo.leadTimeDias });

    await prisma.saldo.update({
      where: { id: saldo.id },
      data: {
        consumoMedioMensal,
        // o gestor manda: parametro fixado manualmente nao e sobrescrito
        ...(saldo.pontoPedidoManual ? {} : { pontoPedido: sugestao.pontoPedido.toFixed(4) }),
      },
    });
    atualizados += 1;
  }

  return { atualizados, meses };
}

/**
 * Job diario das 06:00 (secao 8.3): notificacao consolidada ao comprador e ao almoxarife.
 * Uma notificacao por varredura, nao uma por item - caixa de entrada inundada nao e alerta.
 */
export async function alertarEstoqueMinimo(agora = new Date()) {
  const { alertas, resumo } = await painelDeAlertas(undefined, agora);
  const criticos = alertas.filter((a) => a.semaforo === 'vermelho' || a.semaforo === 'amarelo');

  if (criticos.length === 0) return { notificados: 0, criticos: 0 };

  const corpo = criticos
    .slice(0, 10)
    .map((a) => `[${a.almoxarifado}] ${a.codigo} ${a.descricao}: ${a.mensagem}`)
    .join('\n');

  const linhaFinal = criticos.length > 10 ? `\n... e mais ${criticos.length - 10} itens.` : '';

  const destinatarios = await notificarPorPermissao('estoque:consultar', {
    titulo: `${criticos.length} itens exigem reposicao`,
    corpo:
      `Ruptura: ${resumo.RUPTURA} · Abaixo do minimo: ${resumo.ABAIXO_DO_MINIMO} · ` +
      `No ponto de pedido: ${resumo.NO_PONTO_DE_PEDIDO} · Cobertura baixa: ${resumo.COBERTURA_BAIXA}\n\n` +
      corpo + linhaFinal,
    entidade: 'estoque',
    entidadeId: null,
  });

  return { notificados: destinatarios, criticos: criticos.length };
}
