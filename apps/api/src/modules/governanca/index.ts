import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../core/db.js';
import { authRoutes } from './auth.routes.js';
import { CONFLITOS_DE_PERFIL, conflitosEntre } from '../../core/rbac/sod.js';
import { verificarIntegridade } from '../../core/audit/index.js';
import { marcarComoLida, marcarTodasComoLidas } from '../../core/notifications/index.js';
import { despacharPendentes, reenfileirarDescartadas, situacaoDaFila } from '../../core/notifications/despacho.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { atorDe } from '../../core/rbac/ator.js';
import * as servico from './service.js';
import * as s from './schemas.js';

const cursorSchema = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  busca: z.string().trim().optional(),
});

export const governancaRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authRoutes, { prefix: '/auth' });

  // ---- notificacoes do proprio usuario (o sino da topbar)
  app.get('/notificacoes', { preHandler: [app.autenticar] }, async (req) => {
    const usuario = usuarioDe(req);
    const { limite } = cursorSchema.parse(req.query);
    const [itens, naoLidas] = await Promise.all([
      prisma.notificacao.findMany({
        where: { usuarioId: usuario.sub, canal: 'IN_APP' },
        orderBy: { createdAt: 'desc' },
        take: limite,
      }),
      prisma.notificacao.count({ where: { usuarioId: usuario.sub, canal: 'IN_APP', lidaEm: null } }),
    ]);
    return { itens, naoLidas };
  });

  app.post('/notificacoes/:id/lida', { preHandler: [app.autenticar] }, async (req) => {
    const { id } = req.params as { id: string };
    await marcarComoLida(usuarioDe(req).sub, id);
    return { ok: true };
  });

  app.post('/notificacoes/lidas', { preHandler: [app.autenticar] }, async (req) => {
    const marcadas = await marcarTodasComoLidas(usuarioDe(req).sub);
    return { marcadas };
  });

  // ---- fila de saida (F10): o que nao chegou ao destinatario, e por que
  app.get('/notificacoes/fila', { preHandler: [app.autenticar, app.exigirPermissao('parametro:listar')] }, async () =>
    situacaoDaFila(),
  );

  app.get('/notificacoes/falhas', { preHandler: [app.autenticar, app.exigirPermissao('parametro:listar')] }, async (req) => {
    const { limite } = cursorSchema.parse(req.query);
    const itens = await prisma.notificacao.findMany({
      where: { OR: [{ descartadaEm: { not: null } }, { ultimoErro: { not: null } }] },
      include: { usuario: { select: { nome: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: limite,
    });
    return { itens };
  });

  /** Despacha agora, sem esperar o job - util depois de configurar o SMTP. */
  app.post('/notificacoes/despachar', { preHandler: [app.autenticar, app.exigirPermissao('parametro:editar')] }, async () =>
    despacharPendentes(),
  );

  app.post('/notificacoes/reenfileirar', { preHandler: [app.autenticar, app.exigirPermissao('parametro:editar')] }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()).optional() }).parse(req.body ?? {});
    const reenfileiradas = await reenfileirarDescartadas(usuarioDe(req).sub, ids);
    return { reenfileiradas };
  });

  // ---- usuarios: listagem paginada por cursor, filtro e ordenacao no servidor
  app.get(
    '/usuarios',
    { preHandler: [app.autenticar, app.exigirPermissao('usuario:listar')] },
    async (req) => {
      const { cursor, limite, busca } = cursorSchema.parse(req.query);

      const itens = await prisma.usuario.findMany({
        where: {
          deletedAt: null,
          ...(busca ? { OR: [{ nome: { contains: busca, mode: 'insensitive' } }, { email: { contains: busca, mode: 'insensitive' } }, { loginWinthor: { contains: busca, mode: 'insensitive' } }] } : {}),
        },
        select: {
          id: true, nome: true, email: true, loginWinthor: true, ativo: true, ultimoLoginEm: true,
          // a edicao prefixa o formulario com o que ja esta gravado; sem isto, reabrir para
          // trocar o perfil apagaria a unidade e o centro de custo de quem se editou
          telefone: true, unidadeId: true, centroCustoId: true,
          unidade: { select: { nome: true } },
          centroCusto: { select: { codigo: true, nome: true } },
          perfis: { select: { escopo: true, perfil: { select: { nome: true } } } },
        },
        orderBy: { id: 'asc' },
        take: limite + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const temProxima = itens.length > limite;
      const pagina = temProxima ? itens.slice(0, limite) : itens;

      return {
        itens: pagina.map((u) => ({
          ...u,
          unidadeNome: u.unidade?.nome ?? null,
          centroCustoRotulo: u.centroCusto ? `${u.centroCusto.codigo} — ${u.centroCusto.nome}` : null,
          // uniao do escopo dos vinculos: e assim que o login apura o alcance (secao 5.6)
          unidades: [...new Set(u.perfis.flatMap((v) => servico.unidadesDoEscopo(v.escopo)))],
          perfis: u.perfis.map((p) => p.perfil.nome),
          conflitos: conflitosEntre(u.perfis.map((p) => p.perfil.nome)),
        })),
        proximoCursor: temProxima ? pagina[pagina.length - 1]?.id ?? null : null,
      };
    },
  );

  // ---- usuarios: escrita
  app.post('/usuarios', { preHandler: [app.autenticar, app.exigirPermissao('usuario:criar')] }, async (req, reply) => {
    const dados = s.novoUsuarioSchema.parse(req.body);
    const usuario = await servico.criarUsuario(atorDe(req), {
      ...dados,
      telefone: dados.telefone ?? null,
      unidadeId: dados.unidadeId ?? null,
      centroCustoId: dados.centroCustoId ?? null,
    });
    return reply.status(201).send(usuario);
  });

  app.patch('/usuarios/:id', { preHandler: [app.autenticar, app.exigirPermissao('usuario:editar')] }, async (req) => {
    const { id } = req.params as { id: string };
    return servico.editarUsuario(atorDe(req), id, s.edicaoUsuarioSchema.parse(req.body));
  });

  app.post('/usuarios/:id/inativar', { preHandler: [app.autenticar, app.exigirPermissao('usuario:inativar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { motivo } = s.motivoSchema.parse(req.body);
    return servico.inativarUsuario(atorDe(req), id, motivo);
  });

  app.post('/usuarios/:id/reativar', { preHandler: [app.autenticar, app.exigirPermissao('usuario:inativar')] }, async (req) => {
    const { id } = req.params as { id: string };
    return servico.reativarUsuario(atorDe(req), id);
  });

  /**
   * Redefine a senha de qualquer usuario (secao 5.1).
   *
   * Sem corpo, o servidor gera uma temporaria; com `senha`, usa a informada pelo
   * administrador. A senha volta uma unica vez, para ser entregue a pessoa, e nasce
   * marcada para troca no primeiro acesso.
   */
  app.post('/usuarios/:id/redefinir-senha', { preHandler: [app.autenticar, app.exigirPermissao('usuario:editar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { senha, exigirTroca } = s.redefinirSenhaSchema.parse(req.body ?? {});
    return servico.redefinirSenha(atorDe(req), id, senha ?? null, exigirTroca);
  });

  // ---- unidades e centros de custo: listas de apoio para os formularios de cadastro
  app.get('/unidades', { preHandler: [app.autenticar] }, async () => {
    const itens = await prisma.unidade.findMany({
      where: { deletedAt: null, ativo: true },
      select: { id: true, codigo: true, nome: true, cidade: true, uf: true },
      orderBy: { nome: 'asc' },
    });
    return { itens };
  });

  app.get('/centros-custo', { preHandler: [app.autenticar] }, async () => {
    const itens = await prisma.centroCusto.findMany({
      where: { deletedAt: null, ativo: true },
      select: { id: true, codigo: true, nome: true, unidadeId: true },
      orderBy: { codigo: 'asc' },
    });
    return { itens: itens.map((c) => ({ ...c, rotulo: `${c.codigo} — ${c.nome}` })) };
  });

  // ---- perfis e permissoes (perfis sao editaveis em tela, nada hardcoded no front)
  app.get('/perfis', { preHandler: [app.autenticar, app.exigirPermissao('perfil:listar')] }, async () => {
    const perfis = await prisma.perfil.findMany({
      where: { deletedAt: null },
      include: { permissoes: { include: { permissao: true } } },
      orderBy: { nome: 'asc' },
    });
    return {
      itens: perfis.map((p) => ({
        id: p.id,
        nome: p.nome,
        descricao: p.descricao,
        sistema: p.sistema,
        permissoes: p.permissoes.map((pp) => `${pp.permissao.recurso}:${pp.permissao.acao}`),
      })),
    };
  });

  app.get('/permissoes', { preHandler: [app.autenticar, app.exigirPermissao('perfil:listar')] }, async () => {
    const itens = await prisma.permissao.findMany({ orderBy: [{ recurso: 'asc' }, { acao: 'asc' }] });
    return { itens };
  });

  /**
   * Edicao do perfil (secao 5.1): descricao e conjunto de permissoes.
   * O perfil de sistema continua existindo - o que se edita e o que ele pode, nao o nome.
   */
  app.patch('/perfis/:id', { preHandler: [app.autenticar, app.exigirPermissao('perfil:editar')] }, async (req) => {
    const { id } = req.params as { id: string };
    return servico.editarPerfil(atorDe(req), id, s.edicaoPerfilSchema.parse(req.body));
  });

  // ---- matriz de conflitos de SoD, exibida na administracao
  app.get('/sod/conflitos', { preHandler: [app.autenticar, app.exigirPermissao('perfil:listar')] }, async () => ({
    itens: CONFLITOS_DE_PERFIL,
  }));

  // ---- alcadas parametrizaveis
  app.get('/alcadas', { preHandler: [app.autenticar, app.exigirPermissao('alcada:listar')] }, async () => {
    const itens = await prisma.alcada.findMany({ orderBy: { nivel: 'asc' }, include: { perfilAprovador: true } });
    return {
      itens: itens.map((a) => ({
        nivel: a.nivel,
        valorMin: a.valorMin.toString(),
        valorMax: a.valorMax?.toString() ?? null,
        aprovador: a.perfilAprovador.nome,
        propostasMinimas: a.propostasMinimas,
        slaHoras: a.slaHoras,
        ativo: a.ativo,
      })),
    };
  });

  /** A matriz e salva inteira: faixa isolada abriria vao ou sobreposicao (secao 6.4). */
  app.put('/alcadas', { preHandler: [app.autenticar, app.exigirPermissao('alcada:editar')] }, async (req) => {
    const { faixas } = s.matrizAlcadasSchema.parse(req.body);
    return servico.salvarMatrizDeAlcadas(atorDe(req), faixas);
  });

  // ---- parametros do sistema
  app.get('/parametros', { preHandler: [app.autenticar, app.exigirPermissao('parametro:listar')] }, async () => {
    const itens = await prisma.parametro.findMany({ orderBy: { chave: 'asc' } });
    return { itens };
  });

  app.patch('/parametros/:chave', { preHandler: [app.autenticar, app.exigirPermissao('parametro:editar')] }, async (req) => {
    const { chave } = req.params as { chave: string };
    const { valor } = s.edicaoParametroSchema.parse(req.body);
    return servico.editarParametro(atorDe(req), chave, valor);
  });

  // ---- auditoria: consulta e verificacao da cadeia de hash
  app.get('/auditoria', { preHandler: [app.autenticar, app.exigirPermissao('auditoria:consultar')] }, async (req) => {
    const { cursor, limite } = cursorSchema.parse(req.query);
    const itens = await prisma.auditoria.findMany({
      orderBy: { timestamp: 'desc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { usuario: { select: { nome: true } } },
    });
    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return { itens: pagina, proximoCursor: temProxima ? pagina[pagina.length - 1]?.id ?? null : null };
  });

  app.get('/auditoria/integridade', { preHandler: [app.autenticar, app.exigirPermissao('auditoria:consultar')] }, async () =>
    verificarIntegridade(),
  );
};
