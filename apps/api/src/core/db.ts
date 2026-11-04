import { PrismaClient } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { env } from './env.js';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/** PK padrao do sistema: UUID v7 (ordenavel por tempo). */
export const novoId = (): string => uuidv7();

/**
 * DELETE fisico e proibido em todo o dominio (regra de ouro 2).
 * A extensao aborta qualquer delete/deleteMany que escape da revisao de codigo.
 * Remocao real, quando legitima (limpeza de sessao expirada), usa `prisma.$executeRaw`.
 */
export const db = prisma.$extends({
  query: {
    $allModels: {
      async delete() {
        throw new Error('DELETE fisico proibido. Use soft delete (deleted_at) ou cancelamento com motivo.');
      },
      async deleteMany() {
        throw new Error('DELETE fisico proibido. Use soft delete (deleted_at) ou cancelamento com motivo.');
      },
    },
  },
});

export type Db = typeof db;
