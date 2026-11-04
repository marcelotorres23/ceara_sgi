import { createHash } from 'node:crypto';

/**
 * Elo da cadeia de auditoria: hash = sha256(conteudo canonico || hash_anterior).
 * Modulo puro, sem I/O e sem dependencia de configuracao - testavel isoladamente.
 */
export function calcularHash(conteudo: Record<string, unknown>, hashAnterior: string | null): string {
  const canonico = JSON.stringify(conteudo, Object.keys(conteudo).sort());
  return createHash('sha256').update(`${canonico}||${hashAnterior ?? ''}`).digest('hex');
}
