import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../core/db.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { atorDe } from '../../core/rbac/ator.js';
import { filtroUnidade, unidadeDeEscrita, unidadesConsultadas } from '../../core/rbac/escopo.js';
import { NotFoundError } from '../../core/errors/index.js';
import * as servico from './bateria.service.js';
import { FAIXAS_TENSAO_PADRAO, VIDA_UTIL_MESES_PADRAO } from './bateria.js';

const decimal = (campo: string, casas = 2) =>
  z.string().regex(new RegExp(`^\\d+(\\.\\d{1,${casas}})?$`), `${campo} deve ser um numero positivo.`);

const recorte = (consultadas: string[] | 'TODAS'): string[] => (consultadas === 'TODAS' ? [] : consultadas);

/** Controle de baterias (secao 7.11). */
export const bateriasRoutes: FastifyPluginAsync = async (app) => {
  /** Parametros da regra, para a tela explicar o que classifica sem repetir numero em codigo. */
  app.get('/parametros', { preHandler: [app.autenticar, app.exigirPermissao('bateria:gerenciar')] }, async () => ({
    faixasTensao: FAIXAS_TENSAO_PADRAO,
    vidaUtilMesesPadrao: VIDA_UTIL_MESES_PADRAO,
  }));

  app.get('/', { preHandler: [app.autenticar, app.exigirPermissao('bateria:gerenciar')] }, async (req) => {
    const { unidadeId, incluirSucata } = z
      .object({ unidadeId: z.string().optional(), incluirSucata: z.coerce.boolean().optional() })
      .parse(req.query);

    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    return servico.painel(recorte(consultadas), incluirSucata ?? false);
  });

  app.post('/', { preHandler: [app.autenticar, app.exigirPermissao('bateria:gerenciar')] }, async (req, reply) => {
    const dados = z
      .object({
        unidadeId: z.string().nullish(),
        identificacao: z.string().min(2, 'Informe a identificacao da bateria.'),
        marca: z.string().nullish(),
        modelo: z.string().nullish(),
        numeroSerie: z.string().nullish(),
        amperagem: z.coerce.number().int().min(1).max(2000).nullish(),
        tensaoNominal: decimal('Tensao nominal').nullish(),
        dataCompra: z.coerce.date().nullish(),
        custo: decimal('Custo').nullish(),
        garantiaMeses: z.coerce.number().int().min(0).max(120).nullish(),
        vidaUtilMeses: z.coerce.number().int().min(1).max(120).nullish(),
        observacao: z.string().nullish(),
      })
      .parse(req.body);

    const unidadeId = unidadeDeEscrita(usuarioDe(req), dados.unidadeId ?? null);
    return reply.status(201).send(await servico.cadastrar(atorDe(req), { ...dados, unidadeId }));
  });

  app.post('/:id/instalar', { preHandler: [app.autenticar, app.exigirPermissao('bateria:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    await alcancavel(req, id);
    const dados = z
      .object({
        veiculoId: z.string().min(1, 'Informe o veiculo.'),
        posicao: z.coerce.number().int().min(1).max(4).nullish(),
        instaladaEm: z.coerce.date().nullish(),
        hodometro: decimal('Hodometro', 1).nullish(),
      })
      .parse(req.body);

    return servico.instalar(atorDe(req), id, dados);
  });

  app.post('/:id/retirar', { preHandler: [app.autenticar, app.exigirPermissao('bateria:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    await alcancavel(req, id);
    const dados = z
      .object({
        motivo: z.string().min(5, 'Descreva o motivo da retirada.'),
        destino: z.enum(['EM_ESTOQUE', 'EM_ANALISE_GARANTIA', 'SUCATA']),
        retiradaEm: z.coerce.date().nullish(),
      })
      .parse(req.body);

    return servico.retirar(atorDe(req), id, dados);
  });

  app.post('/:id/medicoes', { preHandler: [app.autenticar, app.exigirPermissao('bateria:gerenciar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await alcancavel(req, id);
    const dados = z
      .object({
        tensaoV: decimal('Tensao'),
        medidoEm: z.coerce.date().nullish(),
        densidade: decimal('Densidade', 3).nullish(),
        aposRodar: z.coerce.boolean().optional(),
        hodometro: decimal('Hodometro', 1).nullish(),
        observacao: z.string().nullish(),
      })
      .parse(req.body);

    return reply.status(201).send(await servico.medir(atorDe(req), id, dados));
  });

  app.get('/:id/medicoes', { preHandler: [app.autenticar, app.exigirPermissao('bateria:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    await alcancavel(req, id);
    return { itens: await servico.historico(id), posicao: await servico.avaliar(id) };
  });

  /** Bateria fora do alcance de quem consulta responde 404 (secao 5.6). */
  async function alcancavel(req: Parameters<typeof usuarioDe>[0], bateriaId: string): Promise<void> {
    const bateria = await prisma.bateria.findFirst({
      where: { id: bateriaId, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      select: { id: true },
    });
    if (!bateria) throw new NotFoundError('Bateria');
  }
};
