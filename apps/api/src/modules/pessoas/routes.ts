import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { novoId, prisma } from '../../core/db.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { atorDe } from '../../core/rbac/ator.js';
import { filtroUnidade, unidadeDeEscrita, unidadesConsultadas } from '../../core/rbac/escopo.js';
import { NotFoundError } from '../../core/errors/index.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { MIMES_IMAGEM, salvarArquivo, urlAssinada } from '../../core/storage/index.js';
import { competenciaDe } from './pontuacao.js';
import * as servico from './service.js';

const competencia = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Informe a competencia no formato AAAA-MM.');

const listagem = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  setor: z.string().optional(),
  status: z.enum(['ATIVO', 'AFASTADO', 'DESLIGADO']).optional(),
  busca: z.string().trim().optional(),
  unidadeId: z.string().optional(),
});

const recorte = (consultadas: string[] | 'TODAS'): string[] => (consultadas === 'TODAS' ? [] : consultadas);

/** A chave guardada vira URL assinada de leitura; sem foto, devolve null. */
async function fotoAssinada(url: string | null): Promise<string | null> {
  if (!url) return null;
  const semProtocolo = url.replace(/^https?:\/\/[^/]+\//, '');
  const barra = semProtocolo.indexOf('/');
  const chave = barra >= 0 ? semProtocolo.slice(barra + 1) : semProtocolo;
  try {
    return await urlAssinada(chave);
  } catch {
    // storage indisponivel nao pode derrubar a listagem: a tela mostra a inicial do nome
    return null;
  }
}

export const pessoasRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------- colaboradores
  app.post('/colaboradores', { preHandler: [app.autenticar, app.exigirPermissao('colaborador:gerenciar')] }, async (req, reply) => {
    const dados = z.object({
      unidadeId: z.string().nullish(),
      usuarioId: z.string().nullish(),
      matricula: z.string().min(1),
      nome: z.string().min(3),
      cargo: z.string().min(2),
      setor: z.string().min(2),
      admissao: z.coerce.date(),
      gestorId: z.string().nullish(),
      cpf: z.string().nullish(),
      telefone: z.string().nullish(),
      email: z.string().email('Informe um e-mail valido.').nullish(),
      dataNascimento: z.coerce.date().nullish(),
    }).parse(req.body);

    const ator = atorDe(req);
    const colaborador = await prisma.colaborador.create({
      data: {
        id: novoId(),
        ...dados,
        unidadeId: unidadeDeEscrita(usuarioDe(req), dados.unidadeId),
        usuarioId: dados.usuarioId ?? null,
        gestorId: dados.gestorId ?? null,
        cpf: dados.cpf?.replace(/D/g, '') || null,
        telefone: dados.telefone?.trim() || null,
        email: dados.email?.trim().toLowerCase() || null,
        dataNascimento: dados.dataNascimento ?? null,
        createdBy: ator.usuarioId,
      },
    });

    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'colaboradores', entidadeId: colaborador.id, acao: 'CRIAR',
      valorNovo: { matricula: colaborador.matricula, nome: colaborador.nome, setor: colaborador.setor },
    });

    return reply.status(201).send(colaborador);
  });

  app.get('/colaboradores', { preHandler: [app.autenticar, app.exigirPermissao('colaborador:consultar')] }, async (req) => {
    const { cursor, limite, setor, status, busca, unidadeId } = listagem.parse(req.query);

    const itens = await prisma.colaborador.findMany({
      where: {
        deletedAt: null,
        ...filtroUnidade(usuarioDe(req), unidadeId),
        ...(setor ? { setor } : {}),
        ...(status ? { status } : {}),
        ...(busca ? { OR: [{ nome: { contains: busca, mode: 'insensitive' } }, { matricula: { contains: busca } }] } : {}),
      },
      include: {
        unidade: { select: { codigo: true } },
        gestor: { select: { nome: true } },
      },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return {
      itens: await Promise.all(pagina.map(async (c) => ({ ...c, fotoUrl: await fotoAssinada(c.fotoUrl) }))),
      proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null,
    };
  });

  /**
   * Foto do colaborador, em base64 no corpo — o navegador ja redimensiona antes de enviar.
   *
   * O bucket nao e publico: guardamos a chave e a tela recebe URL assinada de leitura. Foto
   * trocada nao apaga a anterior no storage; o que muda e a chave a que o cadastro aponta.
   */
  app.post('/colaboradores/:id/foto', { preHandler: [app.autenticar, app.exigirPermissao('colaborador:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const dados = z
      .object({
        conteudoBase64: z.string().min(16),
        mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        nome: z.string().min(1).max(120),
      })
      .parse(req.body);

    const colaborador = await prisma.colaborador.findFirst({
      where: { id, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      select: { id: true, matricula: true, fotoUrl: true },
    });
    if (!colaborador) throw new NotFoundError('Colaborador');

    const arquivo = await salvarArquivo({
      conteudo: Buffer.from(dados.conteudoBase64, 'base64'),
      mime: dados.mime,
      nome: dados.nome,
      pasta: `colaboradores/${colaborador.matricula}`,
      mimesAceitos: MIMES_IMAGEM,
    });

    const ator = atorDe(req);
    const atualizado = await prisma.colaborador.update({
      where: { id },
      data: { fotoUrl: arquivo.url, updatedBy: ator.usuarioId },
    });

    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'colaboradores', entidadeId: id, acao: 'EDITAR',
      valorAnterior: { fotoUrl: colaborador.fotoUrl }, valorNovo: { fotoUrl: arquivo.chave },
    });

    return { ...atualizado, fotoUrl: await fotoAssinada(atualizado.fotoUrl) };
  });

  /** Ficha do colaborador: extrato da competencia + 12 meses de historico (secao 9.3). */
  app.get('/colaboradores/:id', { preHandler: [app.autenticar, app.exigirPermissao('colaborador:consultar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { competencia: comp } = z.object({ competencia: competencia.optional() }).parse(req.query);

    const alcance = await prisma.colaborador.findFirst({
      where: { id, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      select: { id: true },
    });
    if (!alcance) throw new NotFoundError('Colaborador');

    const alvo = comp ?? competenciaDe(new Date());
    const [extrato, historico] = await Promise.all([
      servico.extratoDoColaborador(id, alvo),
      prisma.pontuacaoMensal.findMany({
        where: { colaboradorId: id },
        orderBy: { competencia: 'desc' },
        take: 12,
      }),
    ]);

    const foto = await prisma.colaborador.findUnique({ where: { id }, select: { fotoUrl: true } });
    return {
      ...extrato,
      colaborador: { ...extrato.colaborador, fotoUrl: await fotoAssinada(foto?.fotoUrl ?? null) },
      historico: [...historico].reverse(),
    };
  });

  // ---------------------------------------------------------------- criterios
  app.get('/criterios', { preHandler: [app.autenticar, app.exigirPermissao('colaborador:consultar')] }, async () => ({
    itens: await prisma.criterioPontuacao.findMany({ where: { ativo: true }, orderBy: [{ tipo: 'asc' }, { codigo: 'asc' }] }),
  }));

  app.patch('/criterios/:id', { preHandler: [app.autenticar, app.exigirPermissao('parametro:editar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const dados = z.object({
      descricao: z.string().min(5).optional(),
      peso: z.coerce.number().int().min(0).max(100).optional(),
      ativo: z.boolean().optional(),
    }).parse(req.body);

    const atual = await prisma.criterioPontuacao.findUnique({ where: { id } });
    if (!atual) throw new NotFoundError('Criterio de pontuacao');

    const ator = atorDe(req);
    const atualizado = await prisma.criterioPontuacao.update({
      where: { id },
      data: { ...dados, updatedBy: ator.usuarioId },
    });

    // peso novo nao reescreve competencia passada: os pontos ficam congelados na ocorrencia
    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'criterios_pontuacao', entidadeId: id, acao: 'EDITAR',
      valorAnterior: { peso: atual.peso, descricao: atual.descricao, ativo: atual.ativo },
      valorNovo: dados,
      severidade: 'ALERTA',
    });

    return atualizado;
  });

  // ---------------------------------------------------------------- ocorrencias
  app.post('/ocorrencias', { preHandler: [app.autenticar, app.exigirPermissao('ocorrencia:lancar')] }, async (req, reply) => {
    const dados = z.object({
      colaboradorId: z.string().min(1),
      criterioId: z.string().min(1),
      descricao: z.string().min(10, 'Descreva o fato de forma objetiva.'),
      competencia: competencia.optional(),
      data: z.coerce.date().optional(),
      evidenciaTipo: z.string().nullish(),
      evidenciaId: z.string().nullish(),
      anexoId: z.string().nullish(),
    }).parse(req.body);

    const alcance = await prisma.colaborador.findFirst({
      where: { id: dados.colaboradorId, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      select: { id: true },
    });
    if (!alcance) throw new NotFoundError('Colaborador');

    return reply.status(201).send(await servico.lancarOcorrencia(atorDe(req), dados));
  });

  app.get('/ocorrencias', { preHandler: [app.autenticar, app.exigirPermissao('colaborador:consultar')] }, async (req) => {
    const { cursor, limite, unidadeId } = listagem.parse(req.query);
    const { status, colaboradorId, competencia: comp } = z.object({
      status: z.enum(['SUGERIDA', 'VALIDADA', 'CONTESTADA', 'MANTIDA', 'REVERTIDA', 'DESCARTADA']).optional(),
      colaboradorId: z.string().optional(),
      competencia: competencia.optional(),
    }).parse(req.query);

    const itens = await prisma.ocorrencia.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(colaboradorId ? { colaboradorId } : {}),
        ...(comp ? { competencia: comp } : {}),
        colaborador: { deletedAt: null, ...filtroUnidade(usuarioDe(req), unidadeId) },
      },
      include: {
        criterio: { select: { codigo: true, descricao: true, tipo: true } },
        colaborador: { select: { nome: true, setor: true, matricula: true } },
      },
      orderBy: { id: 'desc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return { itens: pagina, proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null };
  });

  /** Validacao humana da ocorrencia sugerida pelo sistema (secao 9.2). */
  app.post('/ocorrencias/:id/validar', { preHandler: [app.autenticar, app.exigirPermissao('ocorrencia:lancar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { aceitar, justificativa } = z.object({
      aceitar: z.boolean(),
      justificativa: z.string().min(5, 'Informe a justificativa da decisao.'),
    }).parse(req.body);

    return servico.decidirSugestao(atorDe(req), id, aceitar, justificativa);
  });

  /** Contestacao: so o proprio colaborador, e o servico confere o prazo. */
  app.post('/ocorrencias/:id/contestar', { preHandler: [app.autenticar] }, async (req) => {
    const { id } = req.params as { id: string };
    const dados = z.object({
      texto: z.string().min(10, 'Descreva a contestacao.'),
      anexoId: z.string().nullish(),
    }).parse(req.body);

    return servico.contestar(atorDe(req), id, dados);
  });

  app.post('/ocorrencias/:id/decidir', { preHandler: [app.autenticar, app.exigirPermissao('ocorrencia:decidir')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { manter, justificativa } = z.object({
      manter: z.boolean(),
      justificativa: z.string().min(10, 'A decisao exige justificativa.'),
    }).parse(req.body);

    return servico.decidirContestacao(atorDe(req), id, manter, justificativa);
  });

  // ---------------------------------------------------------------- painel e fechamento
  app.get('/painel', { preHandler: [app.autenticar, app.exigirPermissao('colaborador:consultar')] }, async (req) => {
    const { competencia: comp, setor, unidadeId } = z.object({
      competencia: competencia.optional(),
      setor: z.string().optional(),
      unidadeId: z.string().optional(),
    }).parse(req.query);

    const usuario = usuarioDe(req);
    const consultadas = unidadesConsultadas(usuario, unidadeId);

    const painel = await servico.painelDoSetor(atorDe(req), comp ?? competenciaDe(new Date()), {
      setor: setor ?? null,
      unidades: recorte(consultadas),
      // quem decide contestacao e gestor para efeito de visibilidade do ranking
      ehGestor: usuario.permissoes.includes('ocorrencia:decidir'),
    });

    // a foto vai assinada; ranking oculto ou anonimizado nao tem o que assinar
    return {
      ...painel,
      ranking:
        painel.ranking === null
          ? null
          : await Promise.all(
              painel.ranking.map(async (l) => ({ ...l, fotoUrl: await fotoAssinada(l.fotoUrl ?? null) })),
            ),
    };
  });

  app.post('/fechamento', { preHandler: [app.autenticar, app.exigirPermissao('ocorrencia:decidir')] }, async (req) => {
    const { competencia: comp, unidadeId } = z.object({
      competencia,
      unidadeId: z.string().optional(),
    }).parse(req.body);

    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    return servico.fecharCompetencia(atorDe(req), comp, recorte(consultadas));
  });
};
