import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { COOKIE_ACCESS, verificarAccessToken, type AccessClaims } from '../auth/tokens.js';
import { ForbiddenError, UnauthorizedError } from '../errors/index.js';
import { registrarAuditoria } from '../audit/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: AccessClaims;
  }
  interface FastifyInstance {
    autenticar: preHandlerHookHandler;
    exigirPermissao: (...permissoes: string[]) => preHandlerHookHandler;
    exigirQualquerPermissao: (...permissoes: string[]) => preHandlerHookHandler;
    /** false quando o Redis nao respondeu na subida: jobs de SLA e D-2 desligados */
    jobsAtivos: boolean;
    /** false quando o S3/MinIO nao respondeu: fotos de checklist vao falhar */
    storageAtivo: boolean;
  }
}

export const usuarioDe = (req: FastifyRequest): AccessClaims => {
  if (!req.usuario) throw new UnauthorizedError();
  return req.usuario;
};

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('usuario', undefined);

  app.decorate('autenticar', async (req) => {
    const cookie = req.cookies[COOKIE_ACCESS];
    const header = req.headers.authorization?.replace(/^Bearer /i, '');
    const token = cookie ?? header;
    if (!token) throw new UnauthorizedError();
    req.usuario = await verificarAccessToken(token);
  });

  /**
   * Exige TODAS as permissoes informadas. A checagem e sempre no servidor.
   * Negativa e auditada - tentativa de acesso indevido e evidencia.
   */
  app.decorate('exigirPermissao', (...permissoes: string[]) => {
    const hook: preHandlerHookHandler = async (req) => {
      const usuario = usuarioDe(req);
      const faltando = permissoes.filter((p) => !usuario.permissoes.includes(p));
      if (faltando.length > 0) {
        await registrarAuditoria({
          usuarioId: usuario.sub,
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
          entidade: 'autorizacao',
          entidadeId: null,
          acao: `NEGADO:${req.method} ${req.url}`,
          valorNovo: { exigidas: permissoes, faltando },
          severidade: 'ALERTA',
        });
        throw new ForbiddenError('Seu perfil nao permite esta acao.');
      }
    };
    return hook;
  });

  /**
   * Exige QUALQUER uma das permissoes informadas.
   *
   * Existe para a leitura compartilhada por papeis diferentes: quem administra a lista
   * restritiva precisa achar a pessoa para bloquear, sem por isso ganhar a permissao de
   * operar a guarita. A negativa e auditada igual.
   */
  app.decorate('exigirQualquerPermissao', (...permissoes: string[]) => {
    const hook: preHandlerHookHandler = async (req) => {
      const usuario = usuarioDe(req);
      if (permissoes.some((p) => usuario.permissoes.includes(p))) return;

      await registrarAuditoria({
        usuarioId: usuario.sub,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        entidade: 'autorizacao',
        entidadeId: null,
        acao: `NEGADO:${req.method} ${req.url}`,
        valorNovo: { qualquerUmaDe: permissoes },
        severidade: 'ALERTA',
      });
      throw new ForbiddenError('Seu perfil nao permite esta acao.');
    };
    return hook;
  });
};

export const rbacPlugin = fp(plugin, { name: 'rbac' });
