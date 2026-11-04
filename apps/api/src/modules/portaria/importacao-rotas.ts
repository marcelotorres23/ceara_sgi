/**
 * Traducao da planilha comercial de rotas para o cadastro (secao 14.2).
 *
 * Fica separado do script de importacao para poder ser testado sem banco: o que decide
 * se a reimportacao duplica ou corrige e o `codigoDaRota`, e isso e regra, nao script.
 */

export interface LinhaDeRota {
  nome: string;
  vendedores: number | null;
  diasPreVenda: number | null;
  fechamento: string | null;
  largada: string | null;
}

/** Nome apresentavel: a planilha vem com espaco duplo e sobra no fim. */
export const nomeLimpo = (bruto: string): string => bruto.replace(/\s+/g, ' ').trim();

/** Numero da planilha; celula vazia ou lixo vira null, nunca 0. */
export const inteiro = (bruto: string): number | null => {
  const n = Number.parseInt(bruto.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * Codigo estavel a partir do nome: sem acento, sem pontuacao, espaco vira hifen.
 * "SÃO J. CARÚ" -> "SAO-J-CARU". E a chave que torna a reimportacao idempotente.
 */
export function codigoDaRota(nome: string): string {
  return nomeLimpo(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Uma linha da planilha vira uma rota; linha sem nome nao e rota. */
export function traduzirLinhaDeRota(colunas: string[]): LinhaDeRota | null {
  const nome = nomeLimpo(colunas[0] ?? '');
  if (nome === '') return null;

  return {
    nome,
    vendedores: inteiro(colunas[1] ?? ''),
    diasPreVenda: inteiro(colunas[2] ?? ''),
    fechamento: nomeLimpo(colunas[3] ?? '') || null,
    largada: nomeLimpo(colunas[4] ?? '') || null,
  };
}
