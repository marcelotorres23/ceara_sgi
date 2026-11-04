import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../core/db.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { atorDe } from '../../core/rbac/ator.js';
import { filtroUnidade, unidadeDeEscrita, unidadesConsultadas } from '../../core/rbac/escopo.js';
import { NotFoundError } from '../../core/errors/index.js';
import * as pneus from './pneus.service.js';
import * as manutencao from './manutencao.service.js';

const decimal = (campo: string, casas = 2) =>
  z.string().regex(new RegExp(`^\\d+(\\.\\d{1,${casas}})?$`), `${campo} deve ser um numero decimal positivo.`);

const listagem = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['EM_ESTOQUE', 'EM_USO', 'EM_RECAPAGEM', 'EM_REPARO', 'SUCATA']).optional(),
  veiculoId: z.string().optional(),
  marca: z.string().optional(),
  busca: z.string().trim().optional(),
  unidadeId: z.string().optional(),
});

const listagemOs = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['ABERTA', 'EM_EXECUCAO', 'AGUARDANDO_PECA', 'CONCLUIDA', 'CANCELADA']).optional(),
  veiculoId: z.string().optional(),
  unidadeId: z.string().optional(),
});

const periodo = z.object({
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
  unidadeId: z.string().optional(),
});

/** Unidades a consultar num relatorio: `TODAS` vira lista vazia para o servico. */
const recorte = (consultadas: string[] | 'TODAS'): string[] => (consultadas === 'TODAS' ? [] : consultadas);

export const pneusRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------- cadastro e listagem
  app.post('/', { preHandler: [app.autenticar, app.exigirPermissao('pneu:gerenciar')] }, async (req, reply) => {
    const dados = z.object({
      unidadeId: z.string().nullish(),
      numeroFogo: z.string().min(2, 'Informe o numero de fogo gravado no pneu.'),
      serie: z.string().nullish(),
      marca: z.string().min(2),
      modelo: z.string().min(1),
      medida: z.string().min(3),
      dot: z.string().nullish(),
      tipo: z.enum(['NOVO', 'RECAPADO']).default('NOVO'),
      custoAquisicao: decimal('Custo de aquisicao'),
      sulcoInicialMm: decimal('Sulco inicial').nullish(),
      vidaUtilKm: decimal('Vida util', 1).nullish(),
    }).parse(req.body);

    const pneu = await pneus.cadastrarPneu(atorDe(req), {
      ...dados,
      unidadeId: unidadeDeEscrita(usuarioDe(req), dados.unidadeId),
    });

    return reply.status(201).send(pneu);
  });

  app.get('/', { preHandler: [app.autenticar, app.exigirPermissao('pneu:gerenciar')] }, async (req) => {
    const { cursor, limite, status, veiculoId, marca, busca, unidadeId } = listagem.parse(req.query);

    const itens = await prisma.pneu.findMany({
      where: {
        deletedAt: null,
        inativadoEm: null,
        ...filtroUnidade(usuarioDe(req), unidadeId),
        ...(status ? { status } : {}),
        ...(veiculoId ? { veiculoId } : {}),
        ...(marca ? { marca: { contains: marca, mode: 'insensitive' } } : {}),
        ...(busca ? { numeroFogo: { contains: busca.toUpperCase() } } : {}),
      },
      include: {
        veiculo: { select: { placa: true, frotaNumero: true } },
        posicao: { select: { codigo: true } },
        unidade: { select: { codigo: true, nome: true } },
      },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return { itens: pagina, proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null };
  });

  app.get('/:id', { preHandler: [app.autenticar, app.exigirPermissao('pneu:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const alcance = await prisma.pneu.findFirst({
      where: { id, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      select: { id: true },
    });
    if (!alcance) throw new NotFoundError('Pneu');
    return pneus.historicoDoPneu(id);
  });

  // ---------------------------------------------------------------- ciclo de vida
  app.post('/:id/movimentacoes', { preHandler: [app.autenticar, app.exigirPermissao('pneu:gerenciar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dados = z.object({
      tipo: z.enum([
        'INSTALACAO', 'RODIZIO', 'REMOCAO', 'ENVIO_RECAPAGEM', 'RETORNO_RECAPAGEM',
        'ENVIO_REPARO', 'RETORNO_REPARO', 'SUCATEAMENTO',
      ]),
      veiculoId: z.string().nullish(),
      posicaoId: z.string().nullish(),
      data: z.coerce.date().optional(),
      hodometro: decimal('Hodometro', 1).nullish(),
      sulcoMm: decimal('Sulco').nullish(),
      custo: decimal('Custo').nullish(),
      motivo: z.string().nullish(),
    }).parse(req.body);

    const resultado = await pneus.movimentarPneu(atorDe(req), id, dados);
    return reply.status(201).send(resultado);
  });

  app.post('/:id/inspecoes', { preHandler: [app.autenticar, app.exigirPermissao('pneu:gerenciar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dados = z.object({
      data: z.coerce.date().optional(),
      sulcoMm: decimal('Sulco'),
      pressaoPsi: decimal('Pressao').nullish(),
      avaria: z.string().nullish(),
      anexoId: z.string().nullish(),
    }).parse(req.body);

    const resultado = await pneus.registrarInspecao(atorDe(req), id, dados);
    return reply.status(201).send(resultado);
  });

  app.post('/:id/inativar', { preHandler: [app.autenticar, app.exigirPermissao('pneu:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { motivo } = z.object({ motivo: z.string().min(5, 'Informe o motivo da inativacao.') }).parse(req.body);
    return pneus.inativarPneu(atorDe(req), id, motivo);
  });

  // ---------------------------------------------------------------- mapa e indicadores
  app.get('/mapa/:veiculoId', { preHandler: [app.autenticar, app.exigirPermissao('veiculo:gerenciar')] }, async (req) => {
    const { veiculoId } = req.params as { veiculoId: string };
    const alcance = await prisma.veiculo.findFirst({
      where: { id: veiculoId, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      select: { id: true },
    });
    if (!alcance) throw new NotFoundError('Veiculo');
    return pneus.mapaDeRodagem(veiculoId);
  });

  app.get('/indicadores/cpk', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:operacional')] }, async (req) => {
    const { unidadeId } = periodo.parse(req.query);
    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    return {
      unidades: consultadas,
      porMarcaModelo: await pneus.cpkPorMarca(recorte(consultadas), 'marcaModelo'),
      porMarca: await pneus.cpkPorMarca(recorte(consultadas), 'marca'),
      memoriaDeCalculo: {
        formula: 'CPK = (custo de aquisicao + recapagens + reparos) / km rodados',
        agregacao: 'custos e km somados antes da divisao; media de razoes distorceria o resultado',
      },
    };
  });
};

export const manutencaoRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------- planos preventivos
  app.post('/planos', { preHandler: [app.autenticar, app.exigirPermissao('os:gerenciar')] }, async (req, reply) => {
    const dados = z.object({
      veiculoId: z.string().min(1),
      descricao: z.string().min(3),
      gatilhoTipo: z.enum(['KM', 'HORAS', 'DIAS']),
      gatilhoValor: decimal('Intervalo', 1),
      antecedencia: decimal('Antecedencia', 1),
      ultimoValor: decimal('Ultima execucao', 1).nullish(),
      ultimoEm: z.coerce.date().nullish(),
    }).parse(req.body);

    const veiculo = await prisma.veiculo.findFirst({
      where: { id: dados.veiculoId, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      select: { id: true },
    });
    if (!veiculo) throw new NotFoundError('Veiculo');

    return reply.status(201).send(await manutencao.criarPlano(atorDe(req), dados));
  });

  app.get('/planos', { preHandler: [app.autenticar, app.exigirPermissao('os:gerenciar')] }, async (req) => {
    const { unidadeId } = periodo.parse(req.query);
    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    return { unidades: consultadas, ...(await manutencao.painelDePlanos(recorte(consultadas))) };
  });

  // ---------------------------------------------------------------- ordens de servico
  app.post('/ordens', { preHandler: [app.autenticar, app.exigirPermissao('os:gerenciar')] }, async (req, reply) => {
    const dados = z.object({
      veiculoId: z.string().min(1),
      tipo: z.enum(['PREVENTIVA', 'CORRETIVA']),
      origem: z.enum(['PLANO', 'CHECKLIST', 'MOTORISTA', 'ANOMALIA_ABASTECIMENTO', 'INSPECAO_PNEU', 'MANUAL']).optional(),
      origemId: z.string().nullish(),
      planoId: z.string().nullish(),
      descricao: z.string().min(5, 'Descreva o servico a ser feito.'),
      oficina: z.string().nullish(),
      terceiro: z.boolean().optional(),
      hodometro: decimal('Hodometro', 1).nullish(),
      horimetro: decimal('Horimetro', 1).nullish(),
    }).parse(req.body);

    const veiculo = await prisma.veiculo.findFirst({
      where: { id: dados.veiculoId, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      select: { id: true },
    });
    if (!veiculo) throw new NotFoundError('Veiculo');

    return reply.status(201).send(await manutencao.abrirOrdemServico(atorDe(req), dados));
  });

  app.get('/ordens', { preHandler: [app.autenticar, app.exigirPermissao('os:gerenciar')] }, async (req) => {
    const { cursor, limite, veiculoId, unidadeId, status } = listagemOs.parse(req.query);

    const itens = await prisma.ordemServico.findMany({
      where: {
        deletedAt: null,
        ...filtroUnidade(usuarioDe(req), unidadeId),
        ...(status ? { status } : {}),
        ...(veiculoId ? { veiculoId } : {}),
      },
      include: {
        veiculo: { select: { placa: true, frotaNumero: true } },
        itens: true,
      },
      orderBy: { id: 'desc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return { itens: pagina, proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null };
  });

  /**
   * Apoio ao formulario de OS: veiculos, catalogo de pecas e almoxarifados.
   *
   * Vem daqui, e nao das rotas de compras e almoxarifado, para o Gestor de Frota nao
   * precisar de `solicitacao:consultar` so para achar uma peca. Devolve o minimo.
   */
  app.get('/apoio', { preHandler: [app.autenticar, app.exigirPermissao('os:gerenciar')] }, async (req) => {
    const usuario = usuarioDe(req);
    const [veiculos, itens, almoxarifados] = await Promise.all([
      prisma.veiculo.findMany({
        where: { deletedAt: null, status: { in: ['ATIVO', 'MANUTENCAO'] }, ...filtroUnidade(usuario) },
        select: { id: true, placa: true, frotaNumero: true, hodometroAtual: true, horimetroAtual: true },
        orderBy: { placa: 'asc' },
      }),
      prisma.item.findMany({
        where: { deletedAt: null, statusHomologacao: 'HOMOLOGADO' },
        select: { id: true, codigo: true, descricao: true, unidadeMedida: true },
        orderBy: { descricao: 'asc' },
        take: 300,
      }),
      prisma.almoxarifado.findMany({
        where: { deletedAt: null, ...filtroUnidade(usuario) },
        select: { id: true, codigo: true, nome: true },
        orderBy: { codigo: 'asc' },
      }),
    ]);
    return { veiculos, itens, almoxarifados };
  });

  /**
   * OS completa, com o que a folha impressa precisa: veiculo, itens, plano de origem e,
   * quando ja concluida, o relato do mecanico e a OS de retorno da pendencia.
   */
  app.get('/ordens/:id', { preHandler: [app.autenticar, app.exigirPermissao('os:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const os = await prisma.ordemServico.findFirst({
      where: { id, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      include: {
        veiculo: { select: { placa: true, frotaNumero: true, marca: true, modelo: true, ano: true, hodometroAtual: true } },
        unidade: { select: { codigo: true, nome: true, cidade: true, uf: true } },
        plano: { select: { descricao: true, gatilhoTipo: true, gatilhoValor: true } },
        itens: { orderBy: { createdAt: 'asc' } },
        osRetorno: { select: { id: true, numero: true, status: true } },
        osOrigem: { select: { id: true, numero: true } },
      },
    });
    if (!os) throw new NotFoundError('Ordem de servico');
    return os;
  });

  app.post('/ordens/:id/itens', { preHandler: [app.autenticar, app.exigirPermissao('os:gerenciar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dados = z.object({
      descricao: z.string().min(2),
      itemId: z.string().nullish(),
      quantidade: decimal('Quantidade', 4),
      custoUnitario: decimal('Custo unitario', 4).nullish(),
      maoDeObra: z.boolean().optional(),
      almoxarifadoId: z.string().nullish(),
    }).parse(req.body);

    return reply.status(201).send(await manutencao.adicionarItem(atorDe(req), id, dados));
  });

  app.post('/ordens/:id/iniciar', { preHandler: [app.autenticar, app.exigirPermissao('os:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    return manutencao.iniciarExecucao(atorDe(req), id);
  });

  app.post('/ordens/:id/concluir', { preHandler: [app.autenticar, app.exigirPermissao('os:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const dados = z.object({
      fechadaEm: z.coerce.date().optional(),
      hodometro: decimal('Hodometro', 1).nullish(),
      horimetro: decimal('Horimetro', 1).nullish(),
      /** o relato de quem executou, transcrito da folha impressa */
      tipo: z.enum(['TOTAL', 'PARCIAL']).default('TOTAL'),
      anotacoes: z.string().nullish(),
      mecanico: z.string().min(3, 'Informe quem executou o servico.'),
      pendencia: z.string().nullish(),
      abrirOsDeRetorno: z.boolean().default(true),
    }).parse(req.body ?? {});

    return manutencao.concluirOrdemServico(atorDe(req), id, {
      ...dados,
      anotacoes: dados.anotacoes ?? null,
      pendencia: dados.pendencia ?? null,
    });
  });

  app.post('/ordens/:id/cancelar', { preHandler: [app.autenticar, app.exigirPermissao('os:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { motivo } = z.object({ motivo: z.string().min(5, 'Informe o motivo do cancelamento.') }).parse(req.body);
    return manutencao.cancelarOrdemServico(atorDe(req), id, motivo);
  });

  app.get('/indicadores', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:operacional')] }, async (req) => {
    const { de, ate, unidadeId } = periodo.parse(req.query);
    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    const fim = ate ?? new Date();
    const inicio = de ?? new Date(fim.getFullYear(), fim.getMonth(), 1);

    return {
      unidades: consultadas,
      ...(await manutencao.indicadoresDeManutencao(recorte(consultadas), { de: inicio, ate: fim })),
    };
  });
};
