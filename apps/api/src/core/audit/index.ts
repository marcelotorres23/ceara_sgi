import type { SeveridadeAuditoria } from '@prisma/client';
import { prisma, novoId } from '../db.js';
import { calcularHash } from './hash.js';

export { calcularHash };

export interface AuditEntrada {
  usuarioId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  entidade: string;
  entidadeId?: string | null;
  acao: string;
  valorAnterior?: unknown;
  valorNovo?: unknown;
  severidade?: SeveridadeAuditoria;
}

/**
 * Registra um evento na trilha append-only encadeada por hash (secao 5.4).
 * Serializado por advisory lock: o encadeamento exige leitura do ultimo hash
 * e escrita do proximo sem intercalacao.
 */
export async function registrarAuditoria(entrada: AuditEntrada): Promise<{ id: string; hash: string }> {
  const LOCK_AUDITORIA = 8_140_001;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_AUDITORIA}::bigint)`;

    const ultimo = await tx.auditoria.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { hash: true },
    });

    const id = novoId();
    const timestamp = new Date();
    const conteudo = {
      id,
      timestamp: timestamp.toISOString(),
      usuarioId: entrada.usuarioId ?? null,
      entidade: entrada.entidade,
      entidadeId: entrada.entidadeId ?? null,
      acao: entrada.acao,
      valorAnterior: entrada.valorAnterior ?? null,
      valorNovo: entrada.valorNovo ?? null,
      severidade: entrada.severidade ?? 'INFO',
    };
    const hash = calcularHash(conteudo, ultimo?.hash ?? null);

    await tx.auditoria.create({
      data: {
        id,
        timestamp,
        usuarioId: entrada.usuarioId ?? null,
        ip: entrada.ip ?? null,
        userAgent: entrada.userAgent ?? null,
        entidade: entrada.entidade,
        entidadeId: entrada.entidadeId ?? null,
        acao: entrada.acao,
        valorAnterior: (entrada.valorAnterior ?? undefined) as never,
        valorNovo: (entrada.valorNovo ?? undefined) as never,
        severidade: entrada.severidade ?? 'INFO',
        hashAnterior: ultimo?.hash ?? null,
        hash,
      },
    });

    return { id, hash };
  });
}

/** Reprocessa a cadeia e aponta o primeiro registro adulterado, se houver. */
export async function verificarIntegridade(): Promise<{ integro: boolean; quebraNoId?: string }> {
  const registros = await prisma.auditoria.findMany({ orderBy: { timestamp: 'asc' } });
  let anterior: string | null = null;

  for (const r of registros) {
    const esperado = calcularHash(
      {
        id: r.id,
        timestamp: r.timestamp.toISOString(),
        usuarioId: r.usuarioId,
        entidade: r.entidade,
        entidadeId: r.entidadeId,
        acao: r.acao,
        valorAnterior: r.valorAnterior ?? null,
        valorNovo: r.valorNovo ?? null,
        severidade: r.severidade,
      },
      anterior,
    );
    if (esperado !== r.hash || r.hashAnterior !== anterior) {
      return { integro: false, quebraNoId: r.id };
    }
    anterior = r.hash;
  }

  return { integro: true };
}
