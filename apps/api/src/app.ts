import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from './core/env.js';
import { registrarTratadorDeErros } from './core/errors/handler.js';
import { rbacPlugin } from './core/rbac/plugin.js';
import { governancaRoutes } from './modules/governanca/index.js';
import { comprasRoutes } from './modules/compras/routes.js';
import { almoxarifadoRoutes } from './modules/almoxarifado/routes.js';
import { transporteRoutes } from './modules/transporte/routes.js';
import { manutencaoRoutes, pneusRoutes } from './modules/transporte/pneus.routes.js';
import { servicoPeriodicoRoutes } from './modules/transporte/servico-periodico.routes.js';
import { bateriasRoutes } from './modules/transporte/bateria.routes.js';
import { multasRoutes } from './modules/transporte/multas.routes.js';
import { tanquesRoutes } from './modules/transporte/tanque.routes.js';
import { pessoasRoutes } from './modules/pessoas/routes.js';
import { relatoriosRoutes } from './modules/relatorios/routes.js';
import { integracoesRoutes } from './modules/integracoes/routes.js';
import { cadastrosRoutes } from './modules/cadastros/routes.js';
import { portariaRoutes } from './modules/portaria/routes.js';
import { garantirBucket, storageDisponivel } from './core/storage/index.js';
import { registrarJobsDeCompras } from './modules/compras/jobs.js';
import { fecharFilas } from './core/jobs/queues.js';
import { prisma } from './core/db.js';

export async function criarApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.senha'],
    },
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(rbacPlugin);

  registrarTratadorDeErros(app);

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      versao: '0.1.0',
      ambiente: env.NODE_ENV,
      jobs: app.jobsAtivos ? 'ativos' : 'desligados',
      storage: app.storageAtivo ? 'ativo' : 'indisponivel',
    };
  });

  await app.register(governancaRoutes, { prefix: '/api/v1' });
  await app.register(comprasRoutes, { prefix: '/api/v1/compras' });
  await app.register(almoxarifadoRoutes, { prefix: '/api/v1/almoxarifado' });
  await app.register(transporteRoutes, { prefix: '/api/v1/transporte' });
  await app.register(pneusRoutes, { prefix: '/api/v1/transporte/pneus' });
  await app.register(manutencaoRoutes, { prefix: '/api/v1/transporte/manutencao' });
  await app.register(servicoPeriodicoRoutes, { prefix: '/api/v1/transporte/periodicos' });
  await app.register(bateriasRoutes, { prefix: '/api/v1/transporte/baterias' });
  await app.register(multasRoutes, { prefix: '/api/v1/transporte/multas' });
  await app.register(tanquesRoutes, { prefix: '/api/v1/transporte/tanques' });
  await app.register(pessoasRoutes, { prefix: '/api/v1/pessoas' });
  await app.register(relatoriosRoutes, { prefix: '/api/v1/relatorios' });
  await app.register(integracoesRoutes, { prefix: '/api/v1/integracoes' });
  await app.register(cadastrosRoutes, { prefix: '/api/v1' });
  await app.register(portariaRoutes, { prefix: '/api/v1/portaria' });

  // Jobs de SLA e D-2. Sem Redis a API continua no ar e os jobs ficam desligados,
  // com aviso no log - nunca em silencio.
  const jobsAtivos = await registrarJobsDeCompras(app.log);
  app.decorate('jobsAtivos', jobsAtivos);

  // Storage de anexos e evidencias. Sem ele a API sobe, mas anexar arquivo falha -
  // por isso o estado aparece no /health em vez de virar surpresa no patio.
  await garantirBucket();
  const storageOk = await storageDisponivel();
  app.decorate('storageAtivo', storageOk);
  if (!storageOk) {
    app.log.warn({ storage: 'indisponivel' }, 'Storage S3 nao respondeu. Anexos e fotos vao falhar.');
  }

  app.addHook('onClose', async () => {
    await fecharFilas();
  });

  return app;
}
