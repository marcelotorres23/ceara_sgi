import { criarApp } from './app.js';
import { env } from './core/env.js';
import { prisma } from './core/db.js';

const app = await criarApp();

const encerrar = async (sinal: string): Promise<void> => {
  app.log.info({ sinal }, 'Encerrando API');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => void encerrar('SIGINT'));
process.on('SIGTERM', () => void encerrar('SIGTERM'));

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (erro) {
  app.log.error(erro);
  process.exit(1);
}
