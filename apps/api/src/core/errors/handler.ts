import type { FastifyError, FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from './index.js';

/**
 * Erros conhecidos do Prisma que sao falha do PEDIDO, nao do servidor.
 * Sem esta traducao, chave duplicada virava 500 "Falha interna" e o usuario
 * nao ficava sabendo que so precisava trocar a placa.
 */
function traduzirErroDoPrisma(
  erro: Prisma.PrismaClientKnownRequestError,
): { status: number; codigo: string; mensagem: string } | null {
  const alvo = (erro.meta?.target as string[] | string | undefined) ?? [];
  const campos = Array.isArray(alvo) ? alvo.join(', ') : String(alvo);

  switch (erro.code) {
    case 'P2002':
      return {
        status: 409,
        codigo: 'DUPLICADO',
        mensagem: campos
          ? `Ja existe um registro com este valor em: ${campos}.`
          : 'Ja existe um registro com estes dados.',
      };
    case 'P2003':
      return {
        status: 409,
        codigo: 'REFERENCIA_INVALIDA',
        mensagem: 'O registro referenciado nao existe ou esta em uso por outro registro.',
      };
    case 'P2025':
      return { status: 404, codigo: 'NOT_FOUND', mensagem: 'Registro nao encontrado.' };
    default:
      return null;
  }
}

/** Resposta de erro unica em toda a API. Mensagem em pt-BR, codigo em ingles. */
export function registrarTratadorDeErros(app: FastifyInstance): void {
  app.setErrorHandler((erro: FastifyError | Error, req, reply) => {
    if (erro instanceof AppError) {
      if (erro.statusCode >= 500) req.log.error({ erro }, erro.message);
      return reply.status(erro.statusCode).send({
        erro: { codigo: erro.code, mensagem: erro.message, detalhe: erro.detalhe },
      });
    }

    if (erro instanceof ZodError) {
      return reply.status(400).send({
        erro: {
          codigo: 'VALIDATION_ERROR',
          mensagem: 'Revise os campos destacados e envie novamente.',
          detalhe: erro.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
        },
      });
    }

    /**
     * Os modulos de regra pura (estoque, checklist, abastecimento, valor presente)
     * sinalizam entrada de negocio invalida com `RangeError` - eles nao conhecem HTTP.
     * Sem esta traducao, "resposta fora do dominio OK/NAO_OK/NA" virava 500 e o
     * motorista no patio via "Falha interna" em vez do que precisava corrigir.
     */
    if (erro instanceof RangeError) {
      return reply.status(400).send({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: erro.message },
      });
    }

    if (erro instanceof Prisma.PrismaClientKnownRequestError) {
      const traduzido = traduzirErroDoPrisma(erro);
      if (traduzido) {
        return reply.status(traduzido.status).send({
          erro: { codigo: traduzido.codigo, mensagem: traduzido.mensagem },
        });
      }
      req.log.error({ erro, code: erro.code }, 'Erro do Prisma sem traducao');
    }

    const status = (erro as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error({ erro }, 'Erro nao tratado');

    return reply.status(status).send({
      erro: {
        codigo: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        mensagem: status >= 500 ? 'Falha interna. Tente novamente em instantes.' : erro.message,
      },
    });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ erro: { codigo: 'NOT_FOUND', mensagem: 'Rota inexistente.' } }),
  );
}
