import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { novoId, prisma } from '../../core/db.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { atorDe } from '../../core/rbac/ator.js';
import { filtroUnidade, unidadeDeEscrita, unidadesConsultadas } from '../../core/rbac/escopo.js';
import { NotFoundError, ValidationError } from '../../core/errors/index.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import * as tanques from './tanque.service.js';
import { consolidarConsumo } from './tanque.js';
import { lerNotaDeCombustivel } from './nfe-combustivel.js';

/**
 * Abastecimento interno (secao 7.9): tanque proprio, bicos, comboio e afericao.
 * Permissao `abastecimento:registrar` para operar; `veiculo:gerenciar` para
 * cadastrar tanque e aferir - medir o tanque e ato de gestao, nao de operacao.
 */

const litros = (campo: string) =>
  z.string().regex(/^\d+(\.\d{1,3})?$/, `${campo} deve ser um numero com ate 3 casas decimais.`);

const dinheiroSchema = (campo: string) =>
  z.string().regex(/^\d+(\.\d{1,4})?$/, `${campo} deve ser um numero positivo.`);

const consultaUnidade = z.object({ unidadeId: z.string().optional() });

const recorte = (consultadas: string[] | 'TODAS'): string[] => (consultadas === 'TODAS' ? [] : consultadas);

export const tanquesRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------- produtos
  app.get('/produtos', { preHandler: [app.autenticar, app.exigirPermissao('abastecimento:registrar')] }, async () => ({
    itens: await prisma.produtoCombustivel.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' } }),
  }));

  app.post('/produtos', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req, reply) => {
    const dados = z.object({
      codigo: z.string().min(2),
      nome: z.string().min(2),
      tipo: z.enum(['DIESEL_S10', 'DIESEL_S500', 'GASOLINA', 'ETANOL', 'ARLA32', 'LUBRIFICANTE', 'OUTRO']),
      unidadeMedida: z.string().default('L'),
      densidade: dinheiroSchema('Densidade').nullish(),
    }).parse(req.body);

    const produto = await prisma.produtoCombustivel.create({
      data: { id: novoId(), ...dados, densidade: dados.densidade ?? null },
    });
    return reply.status(201).send(produto);
  });

  // ---------------------------------------------------------------- tanques
  app.post('/', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req, reply) => {
    const dados = z.object({
      unidadeId: z.string().nullish(),
      codigo: z.string().min(2),
      nome: z.string().min(2),
      tipo: z.enum(['FIXO', 'MOVEL']).default('FIXO'),
      produtoId: z.string().min(1),
      capacidadeLitros: litros('Capacidade'),
      veiculoId: z.string().nullish(),
    }).parse(req.body);

    const ator = atorDe(req);
    const tanque = await prisma.tanque.create({
      data: {
        id: novoId(),
        ...dados,
        unidadeId: unidadeDeEscrita(usuarioDe(req), dados.unidadeId),
        veiculoId: dados.veiculoId ?? null,
        createdBy: ator.usuarioId,
      },
    });

    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'tanques', entidadeId: tanque.id, acao: 'CRIAR',
      valorNovo: { codigo: tanque.codigo, tipo: tanque.tipo, capacidade: tanque.capacidadeLitros.toString() },
    });

    return reply.status(201).send(tanque);
  });

  app.get('/', { preHandler: [app.autenticar, app.exigirPermissao('abastecimento:registrar')] }, async (req) => {
    const { unidadeId } = consultaUnidade.parse(req.query);
    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    return { unidades: consultadas, ...(await tanques.painelDeTanques(recorte(consultadas))) };
  });

  app.get('/:id/extrato', { preHandler: [app.autenticar, app.exigirPermissao('abastecimento:registrar')] }, async (req) => {
    const { id } = req.params as { id: string };
    return tanques.extratoDoTanque(atorDe(req), id);
  });

  app.post('/:id/inativar', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { motivo } = z.object({ motivo: z.string().min(5, 'Informe o motivo da inativacao.') }).parse(req.body);
    return tanques.inativarTanque(atorDe(req), id, motivo);
  });

  // ---------------------------------------------------------------- bicos
  app.post('/:id/bicos', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dados = z.object({
      codigo: z.string().min(1),
      descricao: z.string().nullish(),
      encerranteAtual: litros('Encerrante').default('0'),
    }).parse(req.body);

    const tanque = await prisma.tanque.findFirst({
      where: { id, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      select: { id: true },
    });
    if (!tanque) throw new NotFoundError('Tanque');

    const bico = await prisma.bico.create({
      data: { id: novoId(), tanqueId: id, ...dados, descricao: dados.descricao ?? null },
    });
    return reply.status(201).send(bico);
  });

  /*
   * ---------------------------------------------------------------- movimentacao
   *
   * Daqui para baixo tudo exige `tanque:operar`, e nao `abastecimento:registrar`.
   *
   * Sao coisas diferentes: abastecer e tirar 200 litros do tanque para um caminhao, com
   * hodometro e placa respondendo pelo volume; movimentar o tanque e dizer quanto entrou,
   * quanto saiu sem abastecimento e quanto a regua mediu — numeros que ninguem confere
   * contra nada. O motorista precisa do primeiro e nao pode ter o segundo, senao a mesma
   * credencial que registra o proprio abastecimento tambem lanca a entrada que o cobre.
   */
  /** Entrada por compra: a nota fiscal do diesel que chegou no caminhao-tanque. */
/**
   * Le a NF-e de compra e **propoe** a entrada, sem gravar nada (secao 7.9).
   *
   * O XML preenche o formulario; quem confirma e quem conferiu a nota contra o que desceu
   * do caminhao-tanque. Volume faturado e volume recebido divergem por temperatura e por
   * sobra de mangueira — gravar direto do arquivo colocaria no estoque um numero que
   * ninguem mediu.
   *
   * Devolve tambem o fornecedor ja casado pelo CNPJ, quando ele existe no cadastro.
   */
  app.post('/entradas/ler-xml', { preHandler: [app.autenticar, app.exigirPermissao('tanque:operar')] }, async (req) => {
    const { conteudoBase64 } = z
      .object({ conteudoBase64: z.string().min(32, 'Envie o arquivo XML da nota.') })
      .parse(req.body);

    const xml = Buffer.from(conteudoBase64, 'base64').toString('utf8');

    let nota;
    try {
      nota = lerNotaDeCombustivel(xml);
    } catch (e) {
      throw new ValidationError(e instanceof Error ? e.message : 'Nao foi possivel ler o XML da nota.');
    }

    // fornecedor pelo CNPJ da nota: evita cadastrar de novo quem ja atende a casa
    const fornecedor = nota.fornecedor.cnpj
      ? await prisma.fornecedor.findFirst({
          where: { cnpj: nota.fornecedor.cnpj, deletedAt: null },
          select: { id: true, razaoSocial: true, nomeFantasia: true, status: true },
        })
      : null;

    // a mesma nota lancada duas vezes duplicaria o estoque; avisa antes de deixar repetir
    const jaLancada = nota.numero
      ? await prisma.movimentacaoTanque.findFirst({
          where: { tipo: 'ENTRADA_COMPRA', notaFiscal: nota.numero },
          select: { id: true, data: true, tanqueId: true },
        })
      : null;

    return {
      nota,
      fornecedor,
      fornecedorNaoCadastrado: nota.fornecedor.cnpj !== null && fornecedor === null,
      jaLancada: jaLancada
        ? {
            em: jaLancada.data,
            tanque:
              (await prisma.tanque.findUnique({ where: { id: jaLancada.tanqueId }, select: { codigo: true } }))?.codigo ??
              null,
          }
        : null,
    };
  });

  app.post('/:id/entradas', { preHandler: [app.autenticar, app.exigirPermissao('tanque:operar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dados = z.object({
      litros: litros('Volume'),
      custoUnitario: dinheiroSchema('Custo do litro'),
      notaFiscal: z.string().min(1, 'Informe o numero da nota fiscal.'),
      fornecedorId: z.string().nullish(),
      data: z.coerce.date().optional(),
      motivo: z.string().nullish(),
    }).parse(req.body);

    const movimentacao = await tanques.movimentarTanque(atorDe(req), id, {
      tipo: 'ENTRADA_COMPRA',
      ...dados,
      fornecedorId: dados.fornecedorId ?? null,
      motivo: dados.motivo ?? null,
    });

    return reply.status(201).send(movimentacao);
  });

  /** Transferencia do tanque fixo para o comboio, ou entre unidades. */
  app.post('/:id/transferencias', { preHandler: [app.autenticar, app.exigirPermissao('tanque:operar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { destinoId, litros: volume, motivo } = z.object({
      destinoId: z.string().min(1, 'Informe o tanque de destino.'),
      litros: litros('Volume'),
      motivo: z.string().nullish(),
    }).parse(req.body);

    const r = await tanques.transferirEntreTanques(atorDe(req), id, destinoId, volume, motivo ?? null);
    return reply.status(201).send(r);
  });

  /** Saida sem abastecimento: descarte, devolucao ao fornecedor, uso em gerador. */
  app.post('/:id/saidas', { preHandler: [app.autenticar, app.exigirPermissao('tanque:operar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dados = z.object({
      litros: litros('Volume'),
      motivo: z.string().min(5, 'Informe o motivo da saida.'),
      data: z.coerce.date().optional(),
    }).parse(req.body);

    const movimentacao = await tanques.movimentarTanque(atorDe(req), id, { tipo: 'SAIDA_ACERTO', ...dados });
    return reply.status(201).send(movimentacao);
  });

  // ---------------------------------------------------------------- afericao
  app.post('/:id/afericoes', { preHandler: [app.autenticar, app.exigirPermissao('tanque:operar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dados = z.object({
      saldoMedido: litros('Saldo medido'),
      data: z.coerce.date().optional(),
      motivo: z.string().nullish(),
      anexoId: z.string().nullish(),
      acertarSaldo: z.boolean().default(false),
    }).parse(req.body);

    const r = await tanques.aferirTanque(atorDe(req), id, {
      ...dados,
      motivo: dados.motivo ?? null,
      anexoId: dados.anexoId ?? null,
    });

    return reply.status(201).send(r);
  });

  // ---------------------------------------------------------------- consumo por recorte
  /**
   * Media de consumo por recorte (secao 7.9): veiculo, motorista, modelo,
   * turno, obra ou rota. E o mesmo numero, agrupado pela pergunta que se faz.
   */
  app.get('/consumo/:recorte', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:operacional')] }, async (req) => {
    const { recorte: agrupador } = req.params as { recorte: string };
    const { de, ate, unidadeId } = z.object({
      de: z.coerce.date().optional(),
      ate: z.coerce.date().optional(),
      unidadeId: z.string().optional(),
    }).parse(req.query);

    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    const unidades = recorte(consultadas);

    const fim = ate ?? new Date();
    const inicio = de ?? new Date(fim.getFullYear(), fim.getMonth(), 1);

    const abastecimentos = await prisma.abastecimento.findMany({
      where: {
        deletedAt: null,
        dataHora: { gte: inicio, lte: fim },
        ...(unidades.length > 0 ? { veiculo: { unidadeId: { in: unidades } } } : {}),
      },
      include: {
        veiculo: { select: { placa: true, frotaNumero: true, modelo: true, tipo: true } },
        motorista: { select: { nome: true } },
      },
    });

    const chaveDe = (a: (typeof abastecimentos)[number]): { chave: string; rotulo: string } => {
      switch (agrupador) {
        case 'motorista':
          return { chave: a.motoristaId, rotulo: a.motorista.nome };
        case 'modelo':
          return { chave: a.veiculo.modelo ?? 'sem-modelo', rotulo: a.veiculo.modelo ?? 'Sem modelo' };
        case 'categoria':
          return { chave: a.veiculo.tipo, rotulo: a.veiculo.tipo };
        case 'turno':
          return { chave: a.turno ?? 'sem-turno', rotulo: a.turno ?? 'Sem turno' };
        case 'obra':
          return { chave: a.obraLocal ?? 'sem-obra', rotulo: a.obraLocal ?? 'Sem obra informada' };
        case 'rota':
          return { chave: a.rota ?? 'sem-rota', rotulo: a.rota ?? 'Sem rota informada' };
        default:
          return { chave: a.veiculoId, rotulo: `${a.veiculo.frotaNumero} · ${a.veiculo.placa}` };
      }
    };

    return {
      recorte: agrupador,
      unidades: consultadas,
      periodo: { de: inicio, ate: fim },
      itens: consolidarConsumo(
        abastecimentos.map((a) => ({
          ...chaveDe(a),
          litros: a.litros.toString(),
          kmPercorridos: a.kmPercorridos?.toString() ?? null,
          valorTotal: a.valorTotal.toString(),
        })),
      ),
      memoriaDeCalculo: {
        consumo: 'km percorridos / litros, somados antes de dividir',
        ordenacao: 'pior consumo primeiro - e o que exige olhar',
        semKm: 'abastecimento sem quilometragem apurada entra no custo, mas nao na media de consumo',
      },
    };
  });
};
