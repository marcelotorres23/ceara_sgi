import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { novoId, prisma } from '../../core/db.js';
import { atorDe } from '../../core/rbac/ator.js';
import { NotFoundError } from '../../core/errors/index.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import * as servico from './service.js';
import * as alertas from './alertas.service.js';
import * as inventario from './inventario.service.js';
import { sugerirPontoPedido } from './estoque.js';

const decimalString = (campo: string) =>
  z.string().regex(/^\d+(\.\d{1,4})?$/, `${campo} deve ser um numero decimal positivo.`);

const listagem = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  almoxarifadoId: z.string().optional(),
  itemId: z.string().optional(),
  busca: z.string().trim().optional(),
});

const movimentacaoSchema = z.object({
  almoxarifadoId: z.string().min(1),
  itemId: z.string().min(1),
  tipo: z.enum([
    'ENTRADA_DEVOLUCAO', 'ENTRADA_AJUSTE', 'SAIDA_REQUISICAO', 'SAIDA_AJUSTE', 'SAIDA_DESCARTE',
  ]),
  quantidade: decimalString('Quantidade'),
  custoUnitario: decimalString('Custo unitario').nullish(),
  veiculoId: z.string().nullish(),
  osId: z.string().nullish(),
  motivo: z.string().nullish(),
});

export const almoxarifadoRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------- cadastros
  app.post('/almoxarifados', { preHandler: [app.autenticar, app.exigirPermissao('inventario:gerenciar')] }, async (req, reply) => {
    const dados = z.object({
      codigo: z.string().min(1),
      nome: z.string().min(3),
      unidadeId: z.string().min(1),
      responsavelId: z.string().nullish(),
    }).parse(req.body);

    const criado = await prisma.almoxarifado.create({
      data: { id: novoId(), ...dados, responsavelId: dados.responsavelId ?? null },
    });
    await registrarAuditoria({
      usuarioId: atorDe(req).usuarioId, ip: req.ip, userAgent: req.headers['user-agent'] ?? null,
      entidade: 'almoxarifados', entidadeId: criado.id, acao: 'CRIAR', valorNovo: { codigo: criado.codigo },
    });
    return reply.status(201).send(criado);
  });

  app.get('/almoxarifados', { preHandler: [app.autenticar, app.exigirPermissao('estoque:consultar')] }, async (req) => {
    const { busca } = z.object({ busca: z.string().trim().optional() }).parse(req.query);
    const itens = await prisma.almoxarifado.findMany({
      where: {
        deletedAt: null,
        ...(busca ? { OR: [{ nome: { contains: busca, mode: 'insensitive' } }, { codigo: { contains: busca, mode: 'insensitive' } }] } : {}),
      },
      include: { _count: { select: { saldos: true } } },
      orderBy: { codigo: 'asc' },
    });
    return { itens };
  });

  // ---------------------------------------------------------------- saldos
  app.get('/saldos', { preHandler: [app.autenticar, app.exigirPermissao('estoque:consultar')] }, async (req) => {
    const { cursor, limite, almoxarifadoId, busca } = listagem.parse(req.query);
    const itens = await prisma.saldo.findMany({
      where: {
        ...(almoxarifadoId ? { almoxarifadoId } : {}),
        item: {
          deletedAt: null,
          ...(busca ? { OR: [{ descricao: { contains: busca, mode: 'insensitive' } }, { codigo: { contains: busca, mode: 'insensitive' } }] } : {}),
        },
      },
      include: {
        item: { select: { codigo: true, descricao: true, unidadeMedida: true, critico: true, curvaAbc: true } },
        almoxarifado: { select: { codigo: true, nome: true } },
      },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return {
      itens: pagina.map((s) => ({
        ...s,
        valorImobilizado: s.quantidade.times(s.custoMedio).toFixed(2),
      })),
      proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null,
    };
  });

  app.patch('/saldos/:id/parametros', { preHandler: [app.autenticar, app.exigirPermissao('inventario:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const dados = z.object({
      estoqueMinimo: decimalString('Estoque minimo').optional(),
      estoqueMaximo: decimalString('Estoque maximo').nullish(),
      pontoPedido: decimalString('Ponto de pedido').optional(),
      loteEconomico: decimalString('Lote economico').nullish(),
      leadTimeDias: z.coerce.number().int().min(0).optional(),
    }).parse(req.body);
    return servico.definirParametros(atorDe(req), id, dados);
  });

  /** O sistema sugere, o gestor confirma (secao 8.3). */
  app.get('/saldos/:id/sugestao', { preHandler: [app.autenticar, app.exigirPermissao('estoque:consultar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const saldo = await prisma.saldo.findUnique({ where: { id } });
    if (!saldo) throw new NotFoundError('Saldo');
    const s = sugerirPontoPedido({
      consumoMedioMensal: saldo.consumoMedioMensal.toString(),
      leadTimeDias: saldo.leadTimeDias,
    });
    return {
      consumoMedioDiario: s.consumoMedioDiario.toFixed(4),
      estoqueSeguranca: s.estoqueSeguranca.toFixed(4),
      pontoPedidoSugerido: s.pontoPedido.toFixed(4),
      pontoPedidoAtual: saldo.pontoPedido.toFixed(4),
      fixadoManualmente: saldo.pontoPedidoManual,
    };
  });

  // ---------------------------------------------------------------- painel de alertas
  app.get('/alertas', { preHandler: [app.autenticar, app.exigirPermissao('estoque:consultar')] }, async (req) => {
    const { almoxarifadoId } = listagem.parse(req.query);
    return alertas.painelDeAlertas(almoxarifadoId);
  });

  app.post('/alertas/recalcular-consumo', { preHandler: [app.autenticar, app.exigirPermissao('inventario:gerenciar')] }, async (req) => {
    const { meses } = z.object({ meses: z.union([z.literal(3), z.literal(6), z.literal(12)]).default(6) }).parse(req.body ?? {});
    return alertas.recalcularConsumo(meses);
  });

  // ---------------------------------------------------------------- movimentacoes
  app.post('/movimentacoes', { preHandler: [app.autenticar, app.exigirPermissao('movimentacao:registrar')] }, async (req, reply) => {
    const dados = movimentacaoSchema.parse(req.body);
    const criada = await servico.movimentar(atorDe(req), {
      ...dados,
      custoUnitario: dados.custoUnitario ?? null,
      veiculoId: dados.veiculoId ?? null,
      osId: dados.osId ?? null,
      motivo: dados.motivo ?? null,
    });
    return reply.status(201).send(criada);
  });

  app.get('/movimentacoes', { preHandler: [app.autenticar, app.exigirPermissao('estoque:consultar')] }, async (req) => {
    const { cursor, limite, almoxarifadoId, itemId } = listagem.parse(req.query);
    const itens = await prisma.movimentacao.findMany({
      where: { ...(almoxarifadoId ? { almoxarifadoId } : {}), ...(itemId ? { itemId } : {}) },
      include: {
        item: { select: { codigo: true, descricao: true } },
        usuario: { select: { nome: true } },
      },
      orderBy: { id: 'desc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return { itens: pagina, proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null };
  });

  app.post('/movimentacoes/:id/estorno', { preHandler: [app.autenticar, app.exigirPermissao('movimentacao:registrar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { motivo } = z.object({ motivo: z.string().min(5, 'Informe o motivo do estorno.') }).parse(req.body);
    const estorno = await servico.estornarMovimentacao(atorDe(req), id, motivo);
    return reply.status(201).send(estorno);
  });

  app.post('/transferencias', { preHandler: [app.autenticar, app.exigirPermissao('movimentacao:registrar')] }, async (req, reply) => {
    const dados = z.object({
      origemId: z.string().min(1),
      destinoId: z.string().min(1),
      itemId: z.string().min(1),
      quantidade: decimalString('Quantidade'),
      motivo: z.string().min(5, 'Informe o motivo da transferencia.'),
    }).parse(req.body);
    const r = await servico.transferir(atorDe(req), dados);
    return reply.status(201).send(r);
  });

  // ---------------------------------------------------------------- integracao com compras
  app.post('/entradas/recebimento/:id', { preHandler: [app.autenticar, app.exigirPermissao('movimentacao:registrar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { almoxarifadoId } = z.object({ almoxarifadoId: z.string().min(1) }).parse(req.body);
    const movimentacoes = await servico.entradaPorRecebimento(atorDe(req), id, almoxarifadoId);
    return reply.status(201).send({ itens: movimentacoes });
  });

  // ---------------------------------------------------------------- inventario ciclico
  app.post('/inventarios', { preHandler: [app.autenticar, app.exigirPermissao('inventario:gerenciar')] }, async (req, reply) => {
    const dados = z.object({
      almoxarifadoId: z.string().min(1),
      tipo: z.string().min(1),
      curva: z.enum(['A', 'B', 'C']).nullish(),
    }).parse(req.body);
    const aberto = await inventario.abrirInventario(atorDe(req), { ...dados, curva: dados.curva ?? null });
    return reply.status(201).send(aberto);
  });

  app.post('/inventarios/:id/contagem', { preHandler: [app.autenticar, app.exigirPermissao('inventario:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { contagens } = z.object({
      contagens: z.array(z.object({
        itemId: z.string().min(1),
        saldoContado: decimalString('Saldo contado'),
        motivo: z.string().nullish(),
        anexoId: z.string().nullish(),
      })).min(1),
    }).parse(req.body);
    return inventario.registrarContagem(atorDe(req), id, contagens.map((c) => ({
      ...c, motivo: c.motivo ?? null, anexoId: c.anexoId ?? null,
    })));
  });

  app.post('/inventarios/:id/fechar', { preHandler: [app.autenticar, app.exigirPermissao('inventario:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { aplicarAjustes } = z.object({ aplicarAjustes: z.boolean().default(false) }).parse(req.body ?? {});
    const r = await inventario.fecharInventario(atorDe(req), id, aplicarAjustes);
    return {
      itensContados: r.itensContados,
      itensCorretos: r.itensCorretos,
      acuracidade: r.acuracidade.toFixed(4),
      atingiuMeta: r.atingiuMeta,
      impactoFinanceiro: r.impactoFinanceiro.toFixed(2),
      divergencias: r.divergencias.map((d) => ({
        itemId: d.itemId,
        divergencia: d.divergencia.toFixed(4),
        valorDivergencia: d.valorDivergencia.toFixed(2),
      })),
    };
  });

  app.get('/inventarios', { preHandler: [app.autenticar, app.exigirPermissao('estoque:consultar')] }, async (req) => {
    const { almoxarifadoId } = listagem.parse(req.query);
    const itens = await prisma.inventario.findMany({
      where: { ...(almoxarifadoId ? { almoxarifadoId } : {}) },
      include: { _count: { select: { itens: true } } },
      orderBy: { iniciadoEm: 'desc' },
      take: 50,
    });
    return { itens };
  });
};
