import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db, prisma, novoId } from '../../core/db.js';
import { verificarSenha } from '../../core/auth/password.js';
import { autenticarWinthor, ehLoginWinthor, normalizarLoginWinthor, winthorConfigurado } from '../../core/auth/winthor.js';
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  assinarAccessToken,
  assinarRefreshToken,
  hashRefresh,
  opcoesCookie,
  verificarRefreshToken,
  type AccessClaims,
} from '../../core/auth/tokens.js';
import { UnauthorizedError } from '../../core/errors/index.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { chavePermissao } from '../../core/rbac/permissions.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { PERMISSAO_TODAS_UNIDADES } from '../../core/rbac/escopo.js';
import { ValidationError } from '../../core/errors/index.js';
import { atorDe } from '../../core/rbac/ator.js';
import { provisionarUsuarioWinthor, trocarPropriaSenha } from './service.js';
import { trocarSenhaSchema } from './schemas.js';

const QUINZE_MIN = 15 * 60;
const SETE_DIAS = 7 * 24 * 60 * 60;

/** Guarda a unidade em operacao entre um access token e outro (secao 5.6). */
const COOKIE_UNIDADE = 'sgi_un';

/**
 * `login` aceita o e-mail (senha do SGI) ou o nome de guerra do WinThor (senha do ERP).
 * `email` continua aceito para os clientes antigos.
 */
const loginSchema = z
  .object({
    login: z.string().trim().min(1).optional(),
    email: z.string().trim().min(1).optional(),
    senha: z.string().min(1, 'Informe a senha.'),
    /** unidade que o usuario vai operacionalizar nesta sessao */
    unidadeId: z.string().min(1).optional(),
  })
  .transform(({ login, email, ...resto }) => ({ ...resto, login: login ?? email ?? '' }))
  .refine((d) => d.login.length > 0, { message: 'Informe o usuario do WinThor ou o e-mail.', path: ['login'] });

export interface UnidadeDisponivel {
  id: string;
  codigo: string;
  nome: string;
}

/**
 * Unidades que o usuario alcanca: `unidade:todas` abre a rede inteira; os demais
 * ficam com a lotacao do cadastro mais o escopo declarado nos perfis (secao 5.1).
 */
async function unidadesDisponiveis(
  usuario: { unidadeId: string | null; perfis: Array<{ escopo: unknown }> },
  permissoes: Set<string>,
): Promise<UnidadeDisponivel[]> {
  const selecao = { id: true, codigo: true, nome: true } as const;

  if (permissoes.has(PERMISSAO_TODAS_UNIDADES)) {
    return prisma.unidade.findMany({
      where: { ativo: true, deletedAt: null },
      select: selecao,
      orderBy: { codigo: 'asc' },
    });
  }

  const ids = new Set<string>();
  if (usuario.unidadeId) ids.add(usuario.unidadeId);
  for (const vinculo of usuario.perfis) {
    const escopo = vinculo.escopo as { unidades?: unknown } | null;
    if (Array.isArray(escopo?.unidades)) {
      for (const u of escopo.unidades) if (typeof u === 'string') ids.add(u);
    }
  }
  if (ids.size === 0) return [];

  return prisma.unidade.findMany({
    where: { id: { in: [...ids] }, ativo: true, deletedAt: null },
    select: selecao,
    orderBy: { codigo: 'asc' },
  });
}

/**
 * Monta as claims a partir dos perfis vigentes - permissoes nunca vem do cliente.
 * A unidade ativa tambem e revalidada aqui: cookie adulterado nao vira acesso.
 */
async function montarClaims(
  usuarioId: string,
  unidadeAtivaPedida?: string | null,
): Promise<{ claims: AccessClaims; unidades: UnidadeDisponivel[] }> {
  const usuario = await prisma.usuario.findFirst({
    where: { id: usuarioId, ativo: true, deletedAt: null },
    include: {
      perfis: { include: { perfil: { include: { permissoes: { include: { permissao: true } } } } } },
    },
  });
  if (!usuario) throw new UnauthorizedError('Usuario inativo ou inexistente.');

  const permissoes = new Set<string>();
  for (const up of usuario.perfis) {
    for (const pp of up.perfil.permissoes) {
      permissoes.add(chavePermissao(pp.permissao.recurso, pp.permissao.acao));
    }
  }

  const unidades = await unidadesDisponiveis(usuario, permissoes);
  const permitida = (id: string | null | undefined) => Boolean(id && unidades.some((u) => u.id === id));

  // ordem de preferencia: o que o usuario declarou, a lotacao do cadastro, a unica que ele alcanca
  const ativa =
    (permitida(unidadeAtivaPedida) ? unidadeAtivaPedida! : null) ??
    (permitida(usuario.unidadeId) ? usuario.unidadeId : null) ??
    (unidades.length === 1 ? unidades[0]!.id : null);

  return {
    claims: {
      sub: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfis: usuario.perfis.map((p) => p.perfil.nome),
      permissoes: [...permissoes],
      unidadeId: usuario.unidadeId,
      centroCustoId: usuario.centroCustoId,
      unidades: unidades.map((u) => u.id),
      unidadeAtivaId: ativa,
    },
    unidades,
  };
}

/** A senha de quem entra pelo WinThor e trocada no WinThor; a marca local nao se aplica. */
const deveTrocar = (u: { deveTrocarSenha: boolean; loginWinthor: string | null }): boolean =>
  u.deveTrocarSenha && !u.loginWinthor;

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { login, senha, unidadeId } = loginSchema.parse(req.body);
    const peloWinthor = ehLoginWinthor(login);

    let usuario = await prisma.usuario.findFirst({
      where: peloWinthor
        ? { loginWinthor: normalizarLoginWinthor(login), deletedAt: null }
        : { email: login.toLowerCase(), deletedAt: null },
    });

    // Mensagem unica para login inexistente e senha errada - nao revela cadastro.
    const credenciaisInvalidas = new UnauthorizedError('Usuario ou senha incorretos.');

    if (peloWinthor) {
      if (!winthorConfigurado()) throw new UnauthorizedError('Login pelo WinThor indisponivel. Entre com o e-mail.');
      // a senha e conferida no Oracle mesmo sem vinculo: o tempo de resposta nao revela quem tem acesso
      const empregado = await autenticarWinthor(login, senha, (erro) =>
        req.log.error({ erro: (erro as { code?: string })?.code ?? (erro as Error)?.name }, 'Falha ao consultar o WinThor no login'),
      );
      // primeiro acesso: o WinThor ja provou quem e, a conta nasce com o perfil de menor alcance
      if (empregado) {
        usuario ??= await provisionarUsuarioWinthor(empregado);
        if (!usuario.ativo) throw new UnauthorizedError('Seu acesso ao SGI foi desativado. Procure o administrador.');
      }
      if (!usuario || !usuario.ativo) throw credenciaisInvalidas;
      if (!empregado) {
        await registrarAuditoria({
          usuarioId: usuario.id,
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
          entidade: 'usuarios',
          entidadeId: usuario.id,
          acao: 'LOGIN_FALHA',
          severidade: 'ALERTA',
          valorNovo: { origem: 'WINTHOR' },
        });
        throw credenciaisInvalidas;
      }
    } else if (!usuario || !usuario.ativo) {
      throw credenciaisInvalidas;
    } else if (usuario.loginWinthor) {
      // uma credencial por pessoa: quem e do WinThor entra com a senha do WinThor
      throw new UnauthorizedError('Entre com o seu usuario do WinThor.');
    } else if (!(await verificarSenha(usuario.senhaHash, senha))) {
      await registrarAuditoria({
        usuarioId: usuario.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        entidade: 'usuarios',
        entidadeId: usuario.id,
        acao: 'LOGIN_FALHA',
        severidade: 'ALERTA',
      });
      throw credenciaisInvalidas;
    }

    // Antes de abrir sessao: em qual unidade este usuario vai operar? Sem essa resposta
    // nao ha gravacao possivel, entao a pergunta vem aqui e nao depois (secao 5.6).
    const previa = await montarClaims(usuario.id, unidadeId);
    if (previa.unidades.length === 0) {
      throw new UnauthorizedError('Seu usuario nao esta vinculado a nenhuma unidade. Procure o administrador.');
    }
    // Quem alcanca mais de uma unidade escolhe explicitamente, mesmo tendo lotacao no cadastro:
    // a lotacao diz onde a pessoa esta lotada, nao onde ela esta operando hoje.
    if (!previa.claims.unidadeAtivaId || (!unidadeId && previa.unidades.length > 1)) {
      return reply.send({ selecionarUnidade: true, unidades: previa.unidades });
    }

    const sessaoId = novoId();
    const refresh = await assinarRefreshToken(usuario.id, sessaoId);

    await db.sessao.create({
      data: {
        id: sessaoId,
        usuarioId: usuario.id,
        refreshHash: hashRefresh(refresh),
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        expiraEm: new Date(Date.now() + SETE_DIAS * 1000),
      },
    });

    await db.usuario.update({ where: { id: usuario.id }, data: { ultimoLoginEm: new Date() } });

    const { claims, unidades } = previa;
    const access = await assinarAccessToken(claims);

    await registrarAuditoria({
      usuarioId: usuario.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
      entidade: 'usuarios',
      entidadeId: usuario.id,
      acao: 'LOGIN',
      valorNovo: { unidadeAtiva: claims.unidadeAtivaId, origem: peloWinthor ? 'WINTHOR' : 'LOCAL' },
    });

    return reply
      .setCookie(COOKIE_ACCESS, access, opcoesCookie(QUINZE_MIN))
      .setCookie(COOKIE_REFRESH, refresh, opcoesCookie(SETE_DIAS))
      .setCookie(COOKIE_UNIDADE, claims.unidadeAtivaId!, opcoesCookie(SETE_DIAS))
      // o aviso de troca vai junto do login: sem ele, a pessoa entra normal e so e barrada
      // no proximo carregamento, o que parece o sistema quebrando sozinho
      .send({ usuario: { ...claims, deveTrocarSenha: deveTrocar(usuario) }, unidades });
  });

  app.post('/refresh', async (req, reply) => {
    const token = req.cookies[COOKIE_REFRESH];
    if (!token) throw new UnauthorizedError();

    const { sub, sid } = await verificarRefreshToken(token);
    const sessao = await prisma.sessao.findFirst({
      where: { id: sid, usuarioId: sub, revogadaEm: null, expiraEm: { gt: new Date() } },
    });
    if (!sessao || sessao.refreshHash !== hashRefresh(token)) throw new UnauthorizedError();

    // Rotacao: o refresh usado e revogado e uma nova sessao e emitida.
    const novaSessaoId = novoId();
    const novoRefresh = await assinarRefreshToken(sub, novaSessaoId);

    await prisma.$transaction([
      prisma.sessao.update({ where: { id: sid }, data: { revogadaEm: new Date() } }),
      prisma.sessao.create({
        data: {
          id: novaSessaoId,
          usuarioId: sub,
          refreshHash: hashRefresh(novoRefresh),
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
          expiraEm: new Date(Date.now() + SETE_DIAS * 1000),
        },
      }),
    ]);

    // a unidade em operacao sobrevive a renovacao, mas e revalidada contra os perfis vigentes
    const { claims, unidades } = await montarClaims(sub, req.cookies[COOKIE_UNIDADE]);
    const access = await assinarAccessToken(claims);

    const resposta = reply
      .setCookie(COOKIE_ACCESS, access, opcoesCookie(QUINZE_MIN))
      .setCookie(COOKIE_REFRESH, novoRefresh, opcoesCookie(SETE_DIAS));

    if (claims.unidadeAtivaId) resposta.setCookie(COOKIE_UNIDADE, claims.unidadeAtivaId, opcoesCookie(SETE_DIAS));

    return resposta.send({ usuario: claims, unidades });
  });

  /**
   * Troca a unidade em operacao sem novo login. Auditado: saber em que unidade
   * cada acao foi feita e parte da trilha (secao 5.4).
   */
  app.post('/unidade-ativa', { preHandler: [app.autenticar] }, async (req, reply) => {
    const { unidadeId } = z.object({ unidadeId: z.string().min(1, 'Informe a unidade.') }).parse(req.body);
    const atual = usuarioDe(req);

    const { claims, unidades } = await montarClaims(atual.sub, unidadeId);
    if (claims.unidadeAtivaId !== unidadeId) {
      throw new ValidationError('Voce nao opera esta unidade. Escolha uma das unidades disponiveis.');
    }

    await registrarAuditoria({
      usuarioId: atual.sub,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
      entidade: 'usuarios',
      entidadeId: atual.sub,
      acao: 'TROCAR_UNIDADE',
      valorAnterior: { unidadeAtiva: atual.unidadeAtivaId },
      valorNovo: { unidadeAtiva: unidadeId },
    });

    return reply
      .setCookie(COOKIE_ACCESS, await assinarAccessToken(claims), opcoesCookie(QUINZE_MIN))
      .setCookie(COOKIE_UNIDADE, unidadeId, opcoesCookie(SETE_DIAS))
      .send({ usuario: claims, unidades });
  });

  /** Unidades que o usuario alcanca - alimenta o seletor da topbar. */
  app.get('/unidades-disponiveis', { preHandler: [app.autenticar] }, async (req) => {
    const { unidades } = await montarClaims(usuarioDe(req).sub, usuarioDe(req).unidadeAtivaId);
    return { itens: unidades };
  });

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[COOKIE_REFRESH];
    if (token) {
      const hash = hashRefresh(token);
      const sessao = await prisma.sessao.findUnique({ where: { refreshHash: hash } });
      if (sessao) {
        await db.sessao.update({ where: { id: sessao.id }, data: { revogadaEm: new Date() } });
        await registrarAuditoria({
          usuarioId: sessao.usuarioId,
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
          entidade: 'sessoes',
          entidadeId: sessao.id,
          acao: 'LOGOUT',
        });
      }
    }
    return reply
      .clearCookie(COOKIE_ACCESS, { path: '/' })
      .clearCookie(COOKIE_REFRESH, { path: '/' })
      .clearCookie(COOKIE_UNIDADE, { path: '/' })
      .send({ ok: true });
  });

  app.get('/me', { preHandler: [app.autenticar] }, async (req) => {
    const atual = usuarioDe(req);
    const [{ unidades }, registro] = await Promise.all([
      montarClaims(atual.sub, atual.unidadeAtivaId),
      prisma.usuario.findUnique({ where: { id: atual.sub }, select: { deveTrocarSenha: true, loginWinthor: true } }),
    ]);
    // a marca vem do banco, nao do token: reset feito agora vale no proximo /me
    return { usuario: { ...atual, deveTrocarSenha: registro ? deveTrocar(registro) : false }, unidades };
  });

  /**
   * Troca da propria senha (secao 5.1). Encerra `deveTrocarSenha` e derruba todas as
   * sessoes — inclusive esta, porque a troca costuma vir de suspeita de acesso indevido.
   */
  app.post('/senha', { preHandler: [app.autenticar] }, async (req, reply) => {
    const dados = trocarSenhaSchema.parse(req.body);
    const r = await trocarPropriaSenha(atorDe(req), dados);
    return reply
      .clearCookie(COOKIE_ACCESS, { path: '/' })
      .clearCookie(COOKIE_REFRESH, { path: '/' })
      .send(r);
  });
};
