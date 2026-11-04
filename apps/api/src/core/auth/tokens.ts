import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../env.js';
import { UnauthorizedError } from '../errors/index.js';

const enc = new TextEncoder();
const ACCESS_KEY = enc.encode(env.JWT_ACCESS_SECRET);
const REFRESH_KEY = enc.encode(env.JWT_REFRESH_SECRET);

export const COOKIE_ACCESS = 'sgi_at';
export const COOKIE_REFRESH = 'sgi_rt';

export interface AccessClaims {
  sub: string;
  nome: string;
  email: string;
  perfis: string[];
  permissoes: string[];
  /** unidade de lotacao do cadastro do usuario */
  unidadeId: string | null;
  centroCustoId: string | null;
  /** unidades que o usuario alcanca (secao 5.6); vazia quando ele opera a rede inteira */
  unidades: string[];
  /** unidade declarada como em operacao nesta sessao */
  unidadeAtivaId: string | null;
}

export async function assinarAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('sgi-ceara')
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(ACCESS_KEY);
}

export async function verificarAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, ACCESS_KEY, { issuer: 'sgi-ceara' });
    return payload as unknown as AccessClaims;
  } catch {
    throw new UnauthorizedError();
  }
}

export async function assinarRefreshToken(usuarioId: string, sessaoId: string): Promise<string> {
  return new SignJWT({ sid: sessaoId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(usuarioId)
    .setIssuedAt()
    .setIssuer('sgi-ceara')
    .setJti(randomBytes(16).toString('hex'))
    .setExpirationTime(env.JWT_REFRESH_TTL)
    .sign(REFRESH_KEY);
}

export async function verificarRefreshToken(token: string): Promise<{ sub: string; sid: string }> {
  try {
    const { payload } = await jwtVerify(token, REFRESH_KEY, { issuer: 'sgi-ceara' });
    return { sub: String(payload.sub), sid: String(payload.sid) };
  } catch {
    throw new UnauthorizedError();
  }
}

/** O refresh token cru nunca e persistido - guarda-se apenas o sha256. */
export const hashRefresh = (token: string): string => createHash('sha256').update(token).digest('hex');

export const opcoesCookie = (maxAgeSegundos: number) =>
  ({
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSegundos,
  });
