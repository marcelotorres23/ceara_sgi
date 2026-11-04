import { prisma } from '../db.js';
import { NotFoundError } from '../errors/index.js';
import { unidadesConsultadas } from './escopo.js';
import type { AccessClaims } from '../auth/tokens.js';

/**
 * Resolve o recorte de unidades de um relatorio (secao 5.6), conferindo que a
 * unidade pedida existe.
 *
 * `escopo.ts` e puro e so sabe dizer se o usuario ALCANCA a unidade. Para quem tem
 * `unidade:todas` isso e sempre verdade - inclusive para um id inexistente, e ai o
 * relatorio sairia zerado como se aquele fosse o numero da unidade. Zero apurado e
 * zero por engano de digitacao sao coisas diferentes, e um painel executivo nao pode
 * confundir os dois.
 */
export async function resolverUnidadesDoRelatorio(
  claims: AccessClaims,
  unidadeIdPedida?: string | null,
): Promise<{ consultadas: string[] | 'TODAS'; recorte: string[] }> {
  // valida o alcance antes de ir ao banco: quem nao alcanca nem descobre se existe
  const consultadas = unidadesConsultadas(claims, unidadeIdPedida);

  if (unidadeIdPedida) {
    const existe = await prisma.unidade.findFirst({
      where: { id: unidadeIdPedida, deletedAt: null },
      select: { id: true },
    });
    if (!existe) throw new NotFoundError('Unidade');
  }

  return { consultadas, recorte: consultadas === 'TODAS' ? [] : consultadas };
}
