import type { StatusLote } from '@prisma/client';
import { prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { notificar, notificarPorPermissao } from '../../core/notifications/index.js';
import { criarWorker, fila, NOMES, redisDisponivel } from '../../core/jobs/queues.js';
import { alertarEstoqueMinimo } from '../almoxarifado/alertas.service.js';
import { atualizarViews } from '../relatorios/bi.service.js';
import { despacharPendentes, despacharMensagensExternas } from '../../core/notifications/despacho.js';
import { alertarDocumentos } from '../transporte/service.js';

/**
 * Jobs de follow-up (secao 6.1.9 e 6.3). Rodam fora do request:
 * - SLA vencendo/vencido: alerta o comprador e escala para quem aprova
 * - D-2 da data prometida: alerta antes do atraso acontecer, nao depois
 */

/** Estados em que o SLA ainda corre. Depois do pedido emitido quem manda e a data prometida. */
const EM_ANDAMENTO: StatusLote[] = ['TRIAGEM', 'EM_COTACAO', 'MAPA_PRONTO', 'AGUARDANDO_APROVACAO', 'EM_RENEGOCIACAO'];

export interface ResumoSla {
  vencidos: number;
  proximosDoVencimento: number;
}

/**
 * Escalonamento automatico por SLA vencido (secao 6.1.7): o lote vencido
 * notifica o comprador E quem tem alcada de aprovacao.
 */
export async function processarSlaVencendo(agora = new Date()): Promise<ResumoSla> {
  const emSeisHoras = new Date(agora.getTime() + 6 * 3_600_000);

  const lotes = await prisma.lote.findMany({
    where: {
      deletedAt: null,
      status: { in: EM_ANDAMENTO },
      slaVenceEm: { not: null, lte: emSeisHoras },
      slaSuspensoEm: null,
    },
    select: { id: true, numero: true, compradorId: true, slaVenceEm: true, criticidade: true },
  });

  let vencidos = 0;
  let proximos = 0;

  for (const lote of lotes) {
    const venceu = lote.slaVenceEm! <= agora;
    if (venceu) vencidos += 1;
    else proximos += 1;

    await notificar({
      usuarioId: lote.compradorId,
      titulo: venceu ? `SLA vencido: ${lote.numero}` : `SLA vence em breve: ${lote.numero}`,
      corpo: venceu
        ? `O lote ${lote.numero} (${lote.criticidade}) ultrapassou o prazo. Registre o andamento ou repactue.`
        : `O lote ${lote.numero} (${lote.criticidade}) vence em menos de 6 horas uteis.`,
      entidade: 'lotes',
      entidadeId: lote.id,
    });

    if (venceu) {
      await notificarPorPermissao('lote:aprovar', {
        titulo: `Escalonamento por SLA vencido: ${lote.numero}`,
        corpo: `O lote ${lote.numero} passou do prazo sem conclusao e foi escalado para a alcada.`,
        entidade: 'lotes',
        entidadeId: lote.id,
      });

      await registrarAuditoria({
        usuarioId: null,
        entidade: 'lotes',
        entidadeId: lote.id,
        acao: 'SLA_VENCIDO',
        valorNovo: { numero: lote.numero, venceuEm: lote.slaVenceEm?.toISOString() },
        severidade: 'ALERTA',
      });
    }
  }

  return { vencidos, proximosDoVencimento: proximos };
}

/** Alerta D-2 da data prometida (secao 6.1.9). O parametro de dias e configuravel. */
export async function processarEntregaD2(agora = new Date()): Promise<{ alertados: number }> {
  const parametro = await prisma.parametro.findUnique({ where: { chave: 'compras.dias_alerta_pre_entrega' } });
  const dias = Number(parametro?.valor ?? 2);

  const limite = new Date(agora.getTime() + dias * 24 * 3_600_000);

  const pedidos = await prisma.pedido.findMany({
    where: {
      deletedAt: null,
      status: { in: ['EMITIDO', 'CONFIRMADO', 'PARCIALMENTE_RECEBIDO'] },
      dataPrometida: { lte: limite },
    },
    include: { fornecedor: { select: { razaoSocial: true } }, lote: { select: { compradorId: true, numero: true } } },
  });

  for (const pedido of pedidos) {
    const atrasado = pedido.dataPrometida < agora;
    await notificar({
      usuarioId: pedido.lote.compradorId,
      titulo: atrasado ? `Entrega atrasada: ${pedido.numero}` : `Entrega em ${dias} dias: ${pedido.numero}`,
      corpo: `${pedido.fornecedor.razaoSocial} - lote ${pedido.lote.numero}, data prometida ${pedido.dataPrometida.toLocaleDateString('pt-BR')}.`,
      entidade: 'pedidos',
      entidadeId: pedido.id,
    });
  }

  return { alertados: pedidos.length };
}

/**
 * Registra os workers e agenda a repeticao. Se o Redis nao responder, a API
 * segue no ar e os jobs ficam desligados - com aviso no log, nunca em silencio.
 */
export async function registrarJobsDeCompras(log: {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
}): Promise<boolean> {
  if (!(await redisDisponivel())) {
    log.warn(
      { redis: 'indisponivel' },
      'Jobs de SLA e D-2 desligados: Redis nao respondeu. A API continua operando.',
    );
    return false;
  }

  criarWorker(NOMES.slaVencendo, async () => processarSlaVencendo());
  criarWorker(NOMES.entregaD2, async () => processarEntregaD2());
  criarWorker(NOMES.estoqueMinimo, async () => alertarEstoqueMinimo());
  criarWorker(NOMES.documentosFrota, async () => alertarDocumentos());
  criarWorker(NOMES.refreshBi, async () => ({ views: await atualizarViews() }));
  // a mesma varredura drena as duas filas de saida: a de usuario e a de quem nao tem login
  criarWorker(NOMES.entregaNotificacoes, async () => ({
    notificacoes: await despacharPendentes(),
    mensagensExternas: await despacharMensagensExternas(),
  }));

  // de hora em hora para o SLA; uma vez ao dia, as 6h, para o D-2
  await fila(NOMES.slaVencendo).add('varredura', {}, {
    repeat: { pattern: '0 * * * *', tz: 'America/Fortaleza' },
    removeOnComplete: 50,
    removeOnFail: 50,
  });

  await fila(NOMES.entregaD2).add('varredura', {}, {
    repeat: { pattern: '0 6 * * *', tz: 'America/Fortaleza' },
    removeOnComplete: 50,
    removeOnFail: 50,
  });

  // alerta consolidado de estoque minimo, tambem as 06:00 (secao 8.3)
  await fila(NOMES.estoqueMinimo).add('varredura', {}, {
    repeat: { pattern: '0 6 * * *', tz: 'America/Fortaleza' },
    removeOnComplete: 50,
    removeOnFail: 50,
  });

  // documentos de veiculo e motorista vencendo (D-30/D-15/D-7), as 06:00
  await fila(NOMES.documentosFrota).add('varredura', {}, {
    repeat: { pattern: '0 6 * * *', tz: 'America/Fortaleza' },
    removeOnComplete: 50,
    removeOnFail: 50,
  });

  // views materializadas do BI (secao 10.3): de hora em hora, aos 10 minutos,
  // para nao concorrer com a varredura de SLA que roda na virada da hora
  await fila(NOMES.refreshBi).add('refresh', {}, {
    repeat: { pattern: '10 * * * *', tz: 'America/Fortaleza' },
    removeOnComplete: 20,
    removeOnFail: 20,
  });

  // fila de saida de e-mail e WhatsApp (F10): a cada 5 minutos
  await fila(NOMES.entregaNotificacoes).add('despacho', {}, {
    repeat: { pattern: '*/5 * * * *', tz: 'America/Fortaleza' },
    removeOnComplete: 50,
    removeOnFail: 50,
  });

  log.info(
    { filas: [NOMES.slaVencendo, NOMES.entregaD2, NOMES.estoqueMinimo, NOMES.documentosFrota, NOMES.refreshBi, NOMES.entregaNotificacoes] },
    'Jobs de compras, almoxarifado e frota registrados',
  );
  return true;
}
