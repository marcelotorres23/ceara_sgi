import { SodViolationError } from '../errors/index.js';
import { registrarAuditoria } from '../audit/index.js';
import { avaliarSod, type ContextoSod, type ResultadoSod } from './sod.js';

/**
 * Aplica a avaliacao de SoD: bloqueia e registra a tentativa com severidade SOD_VIOLATION.
 * Toda tentativa bloqueada e auditada, mesmo que o usuario tenha a permissao RBAC -
 * inclusive o Administrador.
 */
export async function garantirSod(
  ctx: ContextoSod,
  requisicao?: { ip?: string | null; userAgent?: string | null },
): Promise<ResultadoSod> {
  const resultado = avaliarSod(ctx);

  if (!resultado.permitido) {
    await registrarAuditoria({
      usuarioId: ctx.usuarioId,
      ip: requisicao?.ip ?? null,
      userAgent: requisicao?.userAgent ?? null,
      entidade: ctx.entidade,
      entidadeId: ctx.entidadeId,
      acao: `SOD_BLOQUEIO:${ctx.acao}`,
      valorNovo: { regra: resultado.regra, contexto: ctx },
      severidade: 'SOD_VIOLATION',
    });
    throw new SodViolationError(
      resultado.mensagem ?? 'Acao bloqueada por segregacao de funcoes.',
      resultado.regra ?? 'DESCONHECIDA',
    );
  }

  return resultado;
}
