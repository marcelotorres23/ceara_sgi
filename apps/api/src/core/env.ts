import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * .env unico na raiz do monorepo. A busca e ascendente, e nao por numero fixo de niveis:
 * o codigo roda de `src/core/` em dev (tsx) e de `dist/` depois do build, e as profundidades
 * sao diferentes. Em producao as variaveis vem do ambiente (docker/CI) e o arquivo nao existe -
 * por isso a ausencia e silenciosa.
 */
function localizarEnv(): string | undefined {
  const partida = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const inicio of partida) {
    let dir = inicio;
    for (;;) {
      const candidato = path.join(dir, '.env');
      if (existsSync(candidato)) return candidato;
      const pai = path.dirname(dir);
      if (pai === dir) break;
      dir = pai;
    }
  }
  return undefined;
}

const arquivoEnv = localizarEnv();
if (arquivoEnv) dotenv.config({ path: arquivoEnv });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3333),
  API_HOST: z.string().default('0.0.0.0'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  COOKIE_SECRET: z.string().min(16),
  COOKIE_SECURE: z.coerce.boolean().default(false),

  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('sgi-ceara'),
  S3_ACCESS_KEY: z.string().default('sgi'),
  S3_SECRET_KEY: z.string().default('change-me'),

  SEED_ADMIN_EMAIL: z.string().email().default('admin@cearaalimentos.com.br'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Trocar@123'),

  // ---- integracoes de saida (F10). Ausentes, o canal fica declarado como
  // nao configurado e a fila espera - nunca marca como enviado o que nao saiu.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USUARIO: z.string().optional(),
  SMTP_SENHA: z.string().optional(),
  SMTP_REMETENTE: z.string().default('SGI Ceara <nao-responda@cearaalimentos.com.br>'),
  SMTP_SEGURO: z.coerce.boolean().default(false),

  /** endpoint do provedor de WhatsApp; canal de SAIDA apenas (secao 5.5) */
  WHATSAPP_URL: z.string().url().optional(),
  WHATSAPP_TOKEN: z.string().optional(),

  /** consulta de NF-e por chave na SEFAZ; exige certificado A1 */
  SEFAZ_URL: z.string().url().optional(),
  SEFAZ_CERTIFICADO: z.string().optional(),

  /** Oracle do WinThor, so leitura da PCEMPR para o login. Ausente, so o login por e-mail funciona. */
  ORACLE_USER: z.string().optional(),
  ORACLE_PASSWORD: z.string().optional(),
  ORACLE_DSN: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detalhe = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Configuracao invalida. Revise o .env:\n${detalhe}`);
}

export const env = parsed.data;
export type Env = typeof env;
