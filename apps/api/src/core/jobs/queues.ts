import { Queue, Worker, type ConnectionOptions, type Processor } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../env.js';

/**
 * BullMQ + Redis para trabalho assincrono (secao 2). Nenhum calculo pesado
 * roda em request sincrono.
 */

export const conexao: ConnectionOptions = { url: env.REDIS_URL, maxRetriesPerRequest: null } as ConnectionOptions;

/** Sem `:` no nome: o BullMQ usa dois-pontos nas proprias chaves do Redis e rejeita. */
export const NOMES = {
  slaVencendo: 'compras-sla-vencendo',
  entregaD2: 'compras-entrega-d2',
  estoqueMinimo: 'almoxarifado-estoque-minimo',
  documentosFrota: 'frota-documentos-vencendo',
  refreshBi: 'bi-refresh-views',
  entregaNotificacoes: 'notificacoes-entrega',
} as const;

export type NomeFila = (typeof NOMES)[keyof typeof NOMES];

const filas = new Map<string, Queue>();

export function fila(nome: NomeFila): Queue {
  const existente = filas.get(nome);
  if (existente) return existente;
  const nova = new Queue(nome, { connection: conexao });
  filas.set(nome, nova);
  return nova;
}

export const criarWorker = (nome: NomeFila, processador: Processor): Worker =>
  new Worker(nome, processador, { connection: conexao, concurrency: 1 });

/** Verifica se o Redis responde. A API sobe sem ele; os jobs e que nao rodam. */
export async function redisDisponivel(): Promise<boolean> {
  const cliente = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 2000 });
  try {
    await cliente.connect();
    await cliente.ping();
    return true;
  } catch {
    return false;
  } finally {
    cliente.disconnect();
  }
}

export async function fecharFilas(): Promise<void> {
  for (const q of filas.values()) await q.close();
  filas.clear();
}
