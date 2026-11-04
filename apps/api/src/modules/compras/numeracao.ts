import type { Prisma } from '@prisma/client';

export type PrefixoDocumento = 'SOL' | 'LOTE' | 'PC' | 'OS';

/**
 * Numeracao sequencial por prefixo e ano: SOL-2026-0001.
 * O incremento acontece dentro da transacao do chamador, com `UPDATE ... RETURNING`,
 * que serializa concorrentes na propria linha - dois lotes simultaneos nao repetem numero.
 */
export async function proximoNumero(
  tx: Prisma.TransactionClient,
  prefixo: PrefixoDocumento,
  agora = new Date(),
): Promise<string> {
  const ano = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric' }).format(agora),
  );

  const linhas = await tx.$queryRaw<Array<{ ultimo: number }>>`
    INSERT INTO sequencias (chave, ano, ultimo)
    VALUES (${prefixo}, ${ano}, 1)
    ON CONFLICT (chave, ano) DO UPDATE SET ultimo = sequencias.ultimo + 1
    RETURNING ultimo
  `;

  const ultimo = linhas[0]?.ultimo ?? 1;
  return `${prefixo}-${ano}-${String(ultimo).padStart(4, '0')}`;
}
