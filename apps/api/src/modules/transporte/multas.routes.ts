import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db, novoId, prisma } from '../../core/db.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { atorDe } from '../../core/rbac/ator.js';
import { filtroUnidade, unidadeDeEscrita, unidadesConsultadas } from '../../core/rbac/escopo.js';
import { ConflictError, NotFoundError } from '../../core/errors/index.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { notificarPorPermissao } from '../../core/notifications/index.js';
import { lancarOcorrencia } from '../pessoas/service.js';
import { competenciaDe, pontosDaMulta } from '../pessoas/pontuacao.js';

/**
 * Multas (secao 7.6). Indicar o condutor **sugere** a ocorrencia de pontuacao no M4:
 * ela nasce SUGERIDA e so vale apos validacao humana (secao 9.2).
 */

const listagem = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['REGISTRADA', 'CONDUTOR_INDICADO', 'EM_RECURSO', 'PAGA', 'CANCELADA']).optional(),
  motoristaId: z.string().optional(),
  veiculoId: z.string().optional(),
  unidadeId: z.string().optional(),
});

export const multasRoutes: FastifyPluginAsync = async (app) => {
  app.post('/', { preHandler: [app.autenticar, app.exigirPermissao('multa:gerenciar')] }, async (req, reply) => {
    const dados = z.object({
      veiculoId: z.string().min(1),
      motoristaId: z.string().nullish(),
      ait: z.string().min(3, 'Informe o numero do AIT.'),
      dataInfracao: z.coerce.date(),
      local: z.string().min(3),
      descricao: z.string().min(5),
      gravidade: z.enum(['LEVE', 'MEDIA', 'GRAVE', 'GRAVISSIMA']),
      valor: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Valor invalido.'),
      pontos: z.coerce.number().int().min(0).max(7).default(0),
      prazoIndicacao: z.coerce.date().nullish(),
      prazoRecurso: z.coerce.date().nullish(),
      anexoId: z.string().nullish(),
    }).parse(req.body);

    const veiculo = await prisma.veiculo.findFirst({
      where: { id: dados.veiculoId, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      select: { id: true, unidadeId: true, placa: true },
    });
    if (!veiculo) throw new NotFoundError('Veiculo');

    const ator = atorDe(req);
    const multa = await prisma.multa.create({
      data: {
        id: novoId(),
        ...dados,
        // a multa e da unidade que opera o veiculo, nao da unidade de quem digitou
        unidadeId: unidadeDeEscrita(usuarioDe(req), veiculo.unidadeId),
        motoristaId: dados.motoristaId ?? null,
        prazoIndicacao: dados.prazoIndicacao ?? null,
        prazoRecurso: dados.prazoRecurso ?? null,
        anexoId: dados.anexoId ?? null,
        status: dados.motoristaId ? 'CONDUTOR_INDICADO' : 'REGISTRADA',
        createdBy: ator.usuarioId,
      },
    });

    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'multas', entidadeId: multa.id, acao: 'REGISTRAR',
      valorNovo: { ait: multa.ait, placa: veiculo.placa, gravidade: multa.gravidade, valor: multa.valor.toString() },
      severidade: 'ALERTA',
    });

    if (multa.prazoIndicacao && !multa.motoristaId) {
      await notificarPorPermissao('multa:gerenciar', {
        titulo: `Indicar condutor do AIT ${multa.ait}`,
        corpo:
          `Veiculo ${veiculo.placa}. Prazo de indicacao: ${multa.prazoIndicacao.toLocaleDateString('pt-BR')}.\n` +
          'Sem indicacao no prazo, a pontuacao recai sobre a empresa.',
        entidade: 'multas',
        entidadeId: multa.id,
      });
    }

    if (dados.motoristaId) {
      await sugerirOcorrencia(ator, multa.id, dados.motoristaId, multa.gravidade, multa.ait);
    }

    return reply.status(201).send(multa);
  });

  app.get('/', { preHandler: [app.autenticar, app.exigirPermissao('multa:gerenciar')] }, async (req) => {
    const { cursor, limite, status, motoristaId, veiculoId, unidadeId } = listagem.parse(req.query);

    const itens = await prisma.multa.findMany({
      where: {
        deletedAt: null,
        ...filtroUnidade(usuarioDe(req), unidadeId),
        ...(status ? { status } : {}),
        ...(motoristaId ? { motoristaId } : {}),
        ...(veiculoId ? { veiculoId } : {}),
      },
      include: {
        veiculo: { select: { placa: true, frotaNumero: true } },
        motorista: { select: { nome: true } },
      },
      orderBy: { id: 'desc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return { itens: pagina, proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null };
  });

  /** Indicacao do condutor: fecha o prazo e sugere a ocorrencia de pontuacao. */
  app.post('/:id/indicar-condutor', { preHandler: [app.autenticar, app.exigirPermissao('multa:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { motoristaId } = z.object({ motoristaId: z.string().min(1) }).parse(req.body);

    const multa = await prisma.multa.findFirst({
      where: { id, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
    });
    if (!multa) throw new NotFoundError('Multa');
    if (multa.motoristaId) throw new ConflictError('O condutor desta multa ja foi indicado.');

    const ator = atorDe(req);
    const atualizada = await db.multa.update({
      where: { id },
      data: { motoristaId, status: 'CONDUTOR_INDICADO', updatedBy: ator.usuarioId },
    });

    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'multas', entidadeId: id, acao: 'INDICAR_CONDUTOR',
      valorAnterior: { motoristaId: null }, valorNovo: { motoristaId },
      severidade: 'ALERTA',
    });

    const ocorrencia = await sugerirOcorrencia(ator, id, motoristaId, multa.gravidade, multa.ait);
    return { multa: atualizada, ocorrenciaSugerida: ocorrencia };
  });

  /** Ranking de infracoes por motorista (secao 7.6), insumo do M4. */
  app.get('/ranking', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:operacional')] }, async (req) => {
    const { de, ate, unidadeId } = z.object({
      de: z.coerce.date().optional(),
      ate: z.coerce.date().optional(),
      unidadeId: z.string().optional(),
    }).parse(req.query);

    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    const fim = ate ?? new Date();
    const inicio = de ?? new Date(fim.getFullYear(), 0, 1);

    const multas = await prisma.multa.findMany({
      where: {
        deletedAt: null,
        status: { not: 'CANCELADA' },
        dataInfracao: { gte: inicio, lte: fim },
        ...(consultadas === 'TODAS' ? {} : { unidadeId: { in: consultadas } }),
        motoristaId: { not: null },
      },
      include: { motorista: { select: { nome: true } } },
    });

    const grupos = new Map<string, { motoristaId: string; nome: string; multas: number; pontos: number; valor: number; graves: number }>();
    for (const m of multas) {
      const atual = grupos.get(m.motoristaId!) ?? {
        motoristaId: m.motoristaId!,
        nome: m.motorista?.nome ?? 'Sem nome',
        multas: 0,
        pontos: 0,
        valor: 0,
        graves: 0,
      };
      atual.multas += 1;
      atual.pontos += m.pontos;
      atual.valor += Number(m.valor);
      if (m.gravidade === 'GRAVE' || m.gravidade === 'GRAVISSIMA') atual.graves += 1;
      grupos.set(m.motoristaId!, atual);
    }

    return {
      unidades: consultadas,
      periodo: { de: inicio, ate: fim },
      itens: [...grupos.values()]
        .map((g) => ({ ...g, valor: g.valor.toFixed(2) }))
        .sort((a, b) => b.pontos - a.pontos || b.multas - a.multas),
      memoriaDeCalculo: {
        criterio: 'multas nao canceladas, com condutor indicado, por data da infracao',
        ordenacao: 'pontos na CNH primeiro; empate desempata por quantidade de multas',
      },
    };
  });
};

/**
 * Cria a ocorrencia de pontuacao como SUGERIDA. Se o motorista nao tiver ficha de
 * colaborador, nao ha o que pontuar - a multa continua registrada do mesmo jeito.
 */
async function sugerirOcorrencia(
  ator: ReturnType<typeof atorDe>,
  multaId: string,
  motoristaId: string,
  gravidade: 'LEVE' | 'MEDIA' | 'GRAVE' | 'GRAVISSIMA',
  ait: string,
) {
  const motorista = await prisma.motorista.findFirst({
    where: { id: motoristaId },
    select: { nome: true, usuarioId: true },
  });
  if (!motorista?.usuarioId) return null;

  const colaborador = await prisma.colaborador.findFirst({
    where: { usuarioId: motorista.usuarioId, deletedAt: null },
    select: { id: true },
  });
  if (!colaborador) return null;

  const criterio = await prisma.criterioPontuacao.findFirst({
    where: { codigo: 'MULTA_INFRACAO', ativo: true },
  });
  if (!criterio) return null;

  const ocorrencia = await lancarOcorrencia(ator, {
    colaboradorId: colaborador.id,
    criterioId: criterio.id,
    descricao: `Multa ${ait} (${gravidade.toLowerCase()}) com condutor indicado.`,
    competencia: competenciaDe(new Date()),
    evidenciaTipo: 'multas',
    evidenciaId: multaId,
    automatica: true,
  });

  // a gravidade muda o peso (secao 9.1) - o criterio guarda o peso base
  const pontos = pontosDaMulta(gravidade, criterio.peso);
  if (pontos !== ocorrencia.pontos) {
    return prisma.ocorrencia.update({ where: { id: ocorrencia.id }, data: { pontos } });
  }

  return ocorrencia;
}
