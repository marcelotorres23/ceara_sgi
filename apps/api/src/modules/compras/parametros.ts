import { prisma } from '../../core/db.js';
import type { CalendarioUtil } from './horas-uteis.js';
import { CALENDARIO_PADRAO } from './horas-uteis.js';

/**
 * Leitura dos parametros de compras (secao 5.5). Nenhum destes valores e constante
 * no codigo - todos sao editaveis em tela, sem deploy.
 */

async function ler<T>(chave: string, padrao: T): Promise<T> {
  const p = await prisma.parametro.findUnique({ where: { chave } });
  return (p?.valor as T | undefined) ?? padrao;
}

export const taxaMensalValorPresente = (): Promise<number> =>
  ler('compras.taxa_mensal_valor_presente', 0.015);

/** Proposta de cotacao exige print, e-mail ou PDF do orcamento anexado (secao 6.1.5). */
export const exigirEvidenciaCotacao = (): Promise<boolean> =>
  ler('compras.exigir_evidencia_cotacao', true);

export const slaHorasPorCriticidade = (): Promise<Record<string, number>> =>
  ler('compras.sla_horas_por_criticidade', { P1: 4, P2: 24, P3: 40, P4: 80 });

export async function calendario(): Promise<CalendarioUtil> {
  const expediente = await ler('compras.horario_expediente', CALENDARIO_PADRAO.expediente as unknown);
  const feriados = await ler<string[]>('compras.feriados', []);
  return { expediente: expediente as CalendarioUtil['expediente'], feriados };
}
