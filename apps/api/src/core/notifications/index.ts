import type { CanalNotificacao } from '@prisma/client';
import { db, novoId, prisma } from '../db.js';
import { registrarAuditoria } from '../audit/index.js';

/**
 * Notificacoes (secao 5.5). WhatsApp e canal de SAIDA apenas - nunca de entrada,
 * porque foi justamente o canal duplo que o POP identificou como fragilidade.
 *
 * Nesta fase so o canal IN_APP e entregue de fato. E-mail e WhatsApp ficam
 * registrados como pendentes ate os adaptadores existirem (F10), em vez de
 * fingir que foram enviados.
 */

export interface NovaNotificacao {
  usuarioId: string;
  titulo: string;
  corpo: string;
  entidade?: string | null;
  entidadeId?: string | null;
  canal?: CanalNotificacao;
}

async function canaisAtivos(): Promise<CanalNotificacao[]> {
  const p = await prisma.parametro.findUnique({ where: { chave: 'notificacoes.canais_ativos' } });
  const valor = (p?.valor as string[] | undefined) ?? ['IN_APP'];
  return valor.filter((c): c is CanalNotificacao => c === 'IN_APP' || c === 'EMAIL' || c === 'WHATSAPP');
}

export async function notificar(entrada: NovaNotificacao): Promise<void> {
  const canais = entrada.canal ? [entrada.canal] : await canaisAtivos();

  for (const canal of canais) {
    await prisma.notificacao.create({
      data: {
        id: novoId(),
        usuarioId: entrada.usuarioId,
        canal,
        titulo: entrada.titulo,
        corpo: entrada.corpo,
        entidade: entrada.entidade ?? null,
        entidadeId: entrada.entidadeId ?? null,
        // so o in-app e entregue agora; os demais aguardam adaptador
        enviadaEm: canal === 'IN_APP' ? new Date() : null,
      },
    });
  }
}

/** Notifica todos os usuarios que possuem uma permissao - ex.: avisar quem aprova. */
export async function notificarPorPermissao(
  permissao: `${string}:${string}`,
  entrada: Omit<NovaNotificacao, 'usuarioId'>,
): Promise<number> {
  const [recurso, acao] = permissao.split(':');
  const usuarios = await prisma.usuario.findMany({
    where: {
      ativo: true,
      deletedAt: null,
      perfis: { some: { perfil: { permissoes: { some: { permissao: { recurso, acao } } } } } },
    },
    select: { id: true },
  });

  for (const u of usuarios) await notificar({ ...entrada, usuarioId: u.id });
  return usuarios.length;
}

/**
 * "Lida" so faz sentido para o que foi de fato exibido ao usuario, ou seja, o canal IN_APP.
 * As linhas de EMAIL e WHATSAPP ficam pendentes ate existir adaptador que as envie -
 * marca-las como lidas apagaria a fila de envio.
 */
export async function marcarComoLida(usuarioId: string, notificacaoId: string): Promise<void> {
  await db.notificacao.updateMany({
    where: { id: notificacaoId, usuarioId, canal: 'IN_APP', lidaEm: null },
    data: { lidaEm: new Date() },
  });
}

export async function marcarTodasComoLidas(usuarioId: string): Promise<number> {
  const r = await db.notificacao.updateMany({
    where: { usuarioId, canal: 'IN_APP', lidaEm: null },
    data: { lidaEm: new Date() },
  });
  return r.count;
}

/** Cobranca de fornecedor disparada do card do Kanban (secao 6.3). */
export async function cobrarFornecedor(
  ator: { usuarioId: string; ip?: string | null; userAgent?: string | null },
  loteId: string,
): Promise<{ notificados: number }> {
  const lote = await prisma.lote.findFirstOrThrow({
    where: { id: loteId, deletedAt: null },
    include: { cotacoes: { include: { fornecedor: true } }, pedidos: { include: { fornecedor: true } } },
  });

  const pendentes = lote.cotacoes.filter((c) => !c.respondidaEm && !c.recusada);
  const alvos = lote.pedidos.length > 0
    ? lote.pedidos.map((p) => p.fornecedor.razaoSocial)
    : pendentes.map((c) => c.fornecedor.razaoSocial);

  await notificar({
    usuarioId: ator.usuarioId,
    titulo: `Cobranca registrada no lote ${lote.numero}`,
    corpo:
      alvos.length > 0
        ? `Fornecedores cobrados: ${alvos.join(', ')}.`
        : 'Nenhum fornecedor pendente de resposta neste lote.',
    entidade: 'lotes',
    entidadeId: loteId,
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ip: ator.ip ?? null,
    userAgent: ator.userAgent ?? null,
    entidade: 'lotes',
    entidadeId: loteId,
    acao: 'COBRAR_FORNECEDOR',
    valorNovo: { fornecedores: alvos },
  });

  return { notificados: alvos.length };
}
