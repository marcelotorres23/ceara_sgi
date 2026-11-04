import type { FastifyRequest } from 'fastify';
import { usuarioDe } from './plugin.js';
import { escopoDe } from './escopo.js';
import type { Ator } from '../../modules/compras/service.js';

/**
 * Quem esta agindo, de onde e por qual unidade (secoes 5.4 e 5.6).
 * Toda rota monta o ator por aqui: a unidade em operacao nao pode depender
 * de o modulo ter lembrado de propaga-la.
 */
export const atorDe = (req: FastifyRequest): Ator => {
  const usuario = usuarioDe(req);
  return {
    usuarioId: usuario.sub,
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
    unidadeId: usuario.unidadeAtivaId ?? null,
    todasUnidades: escopoDe(usuario).todas,
    perfis: usuario.perfis,
  };
};
