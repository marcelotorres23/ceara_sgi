import type { CurvaABC } from '@prisma/client';
import { novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { dinheiro } from '../../core/money.js';
import type { Ator } from '../compras/service.js';
import { apurarInventario, type ContagemItem } from './estoque.js';
import { movimentar } from './service.js';

const requisicaoDe = (ator: Ator) => ({ ip: ator.ip ?? null, userAgent: ator.userAgent ?? null });

/**
 * Abre a contagem ciclica (secao 8.4). O saldo do sistema e congelado na abertura e
 * NAO e exposto ao contador - contagem cega.
 */
export async function abrirInventario(
  ator: Ator,
  entrada: { almoxarifadoId: string; tipo: string; curva?: CurvaABC | null },
) {
  const saldos = await prisma.saldo.findMany({
    where: {
      almoxarifadoId: entrada.almoxarifadoId,
      ...(entrada.curva ? { item: { curvaAbc: entrada.curva } } : {}),
      item: { deletedAt: null, ...(entrada.curva ? { curvaAbc: entrada.curva } : {}) },
    },
    include: { item: { select: { codigo: true, descricao: true } } },
  });

  if (saldos.length === 0) throw new ValidationError('Nenhum item elegivel para esta contagem.');

  const inventario = await prisma.inventario.create({
    data: {
      id: novoId(),
      almoxarifadoId: entrada.almoxarifadoId,
      tipo: entrada.tipo,
      curva: entrada.curva ?? null,
      status: 'EM_CONTAGEM',
      createdBy: ator.usuarioId,
      itens: {
        create: saldos.map((s) => ({
          id: novoId(),
          itemId: s.itemId,
          saldoSistema: s.quantidade.toFixed(4),
        })),
      },
    },
    include: { itens: true },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'inventarios',
    entidadeId: inventario.id,
    acao: 'ABRIR',
    valorNovo: { almoxarifado: entrada.almoxarifadoId, curva: entrada.curva ?? null, itens: saldos.length },
  });

  // a lista devolvida ao contador NAO traz saldoSistema
  return {
    id: inventario.id,
    status: inventario.status,
    itens: inventario.itens.map((i) => {
      const s = saldos.find((x) => x.itemId === i.itemId)!;
      return { inventarioItemId: i.id, itemId: i.itemId, codigo: s.item.codigo, descricao: s.item.descricao };
    }),
  };
}

export async function registrarContagem(
  ator: Ator,
  inventarioId: string,
  contagens: Array<{ itemId: string; saldoContado: string; motivo?: string | null; anexoId?: string | null }>,
) {
  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    include: { itens: true },
  });
  if (!inventario) throw new NotFoundError('Inventario');
  if (inventario.status !== 'EM_CONTAGEM') throw new ConflictError('Este inventario nao esta em contagem.');

  for (const c of contagens) {
    const item = inventario.itens.find((i) => i.itemId === c.itemId);
    if (!item) throw new NotFoundError(`Item ${c.itemId} no inventario`);

    const contado = dinheiro(c.saldoContado);
    if (contado.isNegative()) throw new ValidationError('Saldo contado nao pode ser negativo.');

    const divergencia = contado.minus(dinheiro(item.saldoSistema.toString()));

    await prisma.inventarioItem.update({
      where: { id: item.id },
      data: {
        saldoContado: contado.toFixed(4),
        divergencia: divergencia.toFixed(4),
        motivo: c.motivo ?? null,
        anexoId: c.anexoId ?? null,
        contadorId: ator.usuarioId,
        contadoEm: new Date(),
      },
    });
  }

  return { registrados: contagens.length };
}

/**
 * Fecha a contagem, apura a acuracidade e ajusta o estoque pelas divergencias.
 * O ajuste exige aprovacao do gestor (secao 8.2) - por isso a rota pede `ajuste:aprovar`
 * via permissao `inventario:gerenciar` e o motivo fica registrado em cada movimentacao.
 */
export async function fecharInventario(ator: Ator, inventarioId: string, aplicarAjustes: boolean) {
  const inventario = await prisma.inventario.findUnique({
    where: { id: inventarioId },
    include: { itens: true },
  });
  if (!inventario) throw new NotFoundError('Inventario');
  if (inventario.status !== 'EM_CONTAGEM') throw new ConflictError('Este inventario ja foi fechado.');

  const saldos = await prisma.saldo.findMany({
    where: { almoxarifadoId: inventario.almoxarifadoId, itemId: { in: inventario.itens.map((i) => i.itemId) } },
  });
  const custoPorItem = new Map(saldos.map((s) => [s.itemId, s.custoMedio.toString()]));

  const contagens: ContagemItem[] = inventario.itens.map((i) => ({
    itemId: i.itemId,
    saldoSistema: i.saldoSistema.toString(),
    saldoContado: i.saldoContado?.toString() ?? null,
    custoMedio: custoPorItem.get(i.itemId) ?? '0',
  }));

  const meta = Number(
    (await prisma.parametro.findUnique({ where: { chave: 'almoxarifado.meta_acuracidade' } }))?.valor ?? 0.95,
  );
  const resultado = apurarInventario(contagens, meta);

  if (resultado.itensContados === 0) throw new ConflictError('Nenhum item foi contado neste inventario.');

  await prisma.$transaction(async (tx) => {
    for (const i of inventario.itens) {
      const d = resultado.divergencias.find((x) => x.itemId === i.itemId);
      if (d) {
        await tx.inventarioItem.update({
          where: { id: i.id },
          data: { valorDivergencia: d.valorDivergencia.toFixed(2), aprovadoPor: aplicarAjustes ? ator.usuarioId : null },
        });
      }
    }

    await tx.inventario.update({
      where: { id: inventarioId },
      data: {
        status: aplicarAjustes ? 'APROVADO' : 'AGUARDANDO_APROVACAO',
        acuracidade: resultado.acuracidade.toFixed(4),
        finalizadoEm: new Date(),
      },
    });

    if (aplicarAjustes) {
      for (const d of resultado.divergencias) {
        const positiva = d.divergencia.greaterThan(0);
        await movimentar(
          ator,
          {
            almoxarifadoId: inventario.almoxarifadoId,
            itemId: d.itemId,
            tipo: positiva ? 'ENTRADA_AJUSTE' : 'SAIDA_AJUSTE',
            quantidade: d.divergencia.abs().toFixed(4),
            custoUnitario: custoPorItem.get(d.itemId) ?? '0',
            documentoTipo: 'inventario',
            documentoId: inventarioId,
            motivo: `Ajuste por contagem ciclica ${inventario.tipo}`,
          },
          tx,
        );
      }
    }
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'inventarios',
    entidadeId: inventarioId,
    acao: aplicarAjustes ? 'FECHAR_COM_AJUSTE' : 'FECHAR',
    valorNovo: {
      acuracidade: resultado.acuracidade.toFixed(4),
      atingiuMeta: resultado.atingiuMeta,
      divergencias: resultado.divergencias.length,
      impactoFinanceiro: resultado.impactoFinanceiro.toFixed(2),
    },
    severidade: resultado.atingiuMeta ? 'INFO' : 'ALERTA',
  });

  return resultado;
}
