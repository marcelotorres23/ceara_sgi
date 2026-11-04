import { prisma } from '../db.js';
import { env } from '../env.js';
import { registrarAuditoria } from '../audit/index.js';
import { urlAssinada } from '../storage/index.js';
import { ADAPTADORES, canaisConfigurados, type Adaptador } from './adaptadores.js';
import {
  MAX_TENTATIVAS,
  elegivelParaEnvio,
  proximoEstado,
  type Canal,
  type ResultadoEntrega,
} from './entrega.js';

/**
 * Prazo do link assinado que acompanha a mensagem externa. Sete dias porque o
 * destinatario nao tem login para pedir outro: o link precisa continuar abrindo
 * depois do fim de semana e da viagem.
 */
const VALIDADE_DO_ANEXO_SEGUNDOS = 7 * 24 * 60 * 60;

/**
 * Despacho da fila de saida (F10). Roda em job, nunca em request.
 *
 * IN_APP ja nasce entregue no `notificar`; aqui saem os canais que dependem de
 * terceiro. Falha nao some: fica em `ultimo_erro`, com tentativa e data da proxima.
 */

export interface ResumoDespacho {
  processadas: number;
  entregues: number;
  reagendadas: number;
  descartadas: number;
  naoConfigurados: Partial<Record<Canal, number>>;
}

export async function despacharPendentes(
  limite = 100,
  agora = new Date(),
  adaptadores: Record<Canal, Adaptador> = ADAPTADORES,
): Promise<ResumoDespacho> {
  const pendentes = await prisma.notificacao.findMany({
    where: {
      enviadaEm: null,
      descartadaEm: null,
      tentativas: { lt: MAX_TENTATIVAS },
      OR: [{ proximaTentativaEm: null }, { proximaTentativaEm: { lte: agora } }],
    },
    include: { usuario: { select: { nome: true, email: true, telefone: true } } },
    orderBy: { createdAt: 'asc' },
    take: limite,
  });

  const resumo: ResumoDespacho = {
    processadas: 0,
    entregues: 0,
    reagendadas: 0,
    descartadas: 0,
    naoConfigurados: {},
  };

  for (const n of pendentes) {
    const naFila = {
      id: n.id,
      canal: n.canal as Canal,
      tentativas: n.tentativas,
      enviadaEm: n.enviadaEm,
      descartadaEm: n.descartadaEm,
      proximaTentativaEm: n.proximaTentativaEm,
    };

    // a consulta ja filtrou, mas o estado pode ter mudado entre a leitura e aqui
    if (!elegivelParaEnvio(naFila, agora)) continue;

    const adaptador = adaptadores[naFila.canal];
    const resultado = await adaptador(
      { nome: n.usuario.nome, email: n.usuario.email, telefone: n.usuario.telefone },
      { titulo: n.titulo, corpo: n.corpo, entidade: n.entidade, entidadeId: n.entidadeId },
    );

    const decisao = proximoEstado(naFila, resultado, agora);

    await prisma.notificacao.update({
      where: { id: n.id },
      data: {
        enviadaEm: decisao.enviadaEm,
        tentativas: decisao.tentativas,
        proximaTentativaEm: decisao.proximaTentativaEm,
        ultimoErro: decisao.ultimoErro,
        descartadaEm: decisao.descartadaEm,
        referenciaExterna: decisao.referenciaExterna,
      },
    });

    resumo.processadas += 1;
    if (resultado.estado === 'ENTREGUE') resumo.entregues += 1;
    else if (resultado.estado === 'NAO_CONFIGURADO') {
      resumo.naoConfigurados[naFila.canal] = (resumo.naoConfigurados[naFila.canal] ?? 0) + 1;
    } else if (decisao.descartadaEm) {
      resumo.descartadas += 1;
    } else {
      resumo.reagendadas += 1;
    }

    // desistir de avisar alguem e evento de governanca, nao detalhe tecnico
    if (decisao.descartadaEm) {
      await registrarAuditoria({
        usuarioId: null,
        entidade: 'notificacoes',
        entidadeId: n.id,
        acao: 'ENTREGA_DESCARTADA',
        valorNovo: {
          canal: n.canal,
          destinatario: n.usuarioId,
          titulo: n.titulo,
          tentativas: decisao.tentativas,
          erro: decisao.ultimoErro,
        },
        severidade: 'ALERTA',
      });
    }
  }

  return resumo;
}

/** Situacao da fila, para a tela de governanca e para o /health. */
export async function situacaoDaFila() {
  const [pendentes, descartadas, porCanal] = await Promise.all([
    prisma.notificacao.count({ where: { enviadaEm: null, descartadaEm: null } }),
    prisma.notificacao.count({ where: { descartadaEm: { not: null } } }),
    prisma.notificacao.groupBy({
      by: ['canal'],
      where: { enviadaEm: null, descartadaEm: null },
      _count: true,
    }),
  ]);

  return {
    pendentes,
    descartadas,
    porCanal: Object.fromEntries(porCanal.map((c) => [c.canal, c._count])),
    canaisConfigurados: canaisConfigurados(),
  };
}

/** Recoloca na fila o que foi descartado, depois de resolver a causa. */
export async function reenfileirarDescartadas(usuarioId: string, ids?: string[]): Promise<number> {
  const { count } = await prisma.notificacao.updateMany({
    where: { descartadaEm: { not: null }, ...(ids && ids.length > 0 ? { id: { in: ids } } : {}) },
    data: { descartadaEm: null, tentativas: 0, proximaTentativaEm: null, ultimoErro: null },
  });

  if (count > 0) {
    await registrarAuditoria({
      usuarioId,
      entidade: 'notificacoes',
      entidadeId: null,
      acao: 'REENFILEIRAR',
      valorNovo: { quantidade: count, ids: ids ?? 'todas' },
    });
  }

  return count;
}

// ------------------------------------------------------------------ mensagens externas

/**
 * Fila de saida para destinatario sem login (`mensagens_externas`).
 *
 * A politica de entrega e a mesma das notificacoes - tentativa, backoff, descarte
 * explicito - e por isso reaproveita `entrega.ts` inteiro. O que muda e de onde vem o
 * destinatario: aqui ele foi congelado na linha, e nao lido do cadastro na hora do
 * envio. Mensagem tem que provar para onde foi no dia em que saiu, e nao para onde
 * iria hoje.
 */

/** Documento anexo da mensagem, resolvido em link assinado na hora do despacho. */
async function documentoDe(anexoId: string | null): Promise<{ url: string; nome: string } | null> {
  if (!anexoId) return null;

  const anexo = await prisma.anexo.findFirst({ where: { id: anexoId, deletedAt: null } });
  if (!anexo) return null;

  // a url gravada e o endereco completo; o que se assina e a chave dentro do bucket
  const chave = anexo.url.replace(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/`, '');
  try {
    return { url: await urlAssinada(chave, VALIDADE_DO_ANEXO_SEGUNDOS), nome: anexo.nome };
  } catch {
    // storage fora do ar nao vira "sem anexo": melhor a mensagem falhar e voltar na fila
    throw new Error('Nao foi possivel gerar o link do documento anexo.');
  }
}

export interface DespachoDaMensagem {
  registro: {
    id: string;
    enviadaEm: Date | null;
    tentativas: number;
    ultimoErro: string | null;
    descartadaEm: Date | null;
    referenciaExterna: string | null;
  };
  resultado: ResultadoEntrega;
}

/** Despacha uma mensagem externa especifica e devolve o estado em que ela ficou. */
export async function despacharMensagemExterna(
  id: string,
  agora = new Date(),
  adaptadores: Record<Canal, Adaptador> = ADAPTADORES,
): Promise<DespachoDaMensagem> {
  const m = await prisma.mensagemExterna.findUniqueOrThrow({ where: { id } });

  const naFila = {
    id: m.id,
    canal: m.canal as Canal,
    tentativas: m.tentativas,
    enviadaEm: m.enviadaEm,
    descartadaEm: m.descartadaEm,
    proximaTentativaEm: m.proximaTentativaEm,
  };

  if (!elegivelParaEnvio(naFila, agora)) {
    return {
      registro: m,
      resultado: m.enviadaEm
        ? { estado: 'ENTREGUE', referenciaExterna: m.referenciaExterna }
        : { estado: 'FALHOU', erro: m.ultimoErro ?? 'Mensagem fora da janela de envio.', permanente: true },
    };
  }

  let resultado: ResultadoEntrega;
  try {
    resultado = await adaptadores[naFila.canal](
      { nome: m.destinatarioNome, email: m.destinatarioEmail, telefone: m.destinatarioTelefone },
      {
        titulo: m.titulo,
        corpo: m.corpo,
        entidade: m.entidade,
        entidadeId: m.entidadeId,
        documento: await documentoDe(m.anexoId),
      },
    );
  } catch (erro) {
    resultado = { estado: 'FALHOU', erro: erro instanceof Error ? erro.message : 'Falha ao preparar o envio.' };
  }

  const decisao = proximoEstado(naFila, resultado, agora);

  const registro = await prisma.mensagemExterna.update({
    where: { id: m.id },
    data: {
      enviadaEm: decisao.enviadaEm,
      tentativas: decisao.tentativas,
      proximaTentativaEm: decisao.proximaTentativaEm,
      ultimoErro: decisao.ultimoErro,
      descartadaEm: decisao.descartadaEm,
      referenciaExterna: decisao.referenciaExterna,
    },
  });

  // desistir de avisar alguem e evento de governanca, nao detalhe tecnico
  if (decisao.descartadaEm) {
    await registrarAuditoria({
      usuarioId: null,
      entidade: 'mensagens_externas',
      entidadeId: m.id,
      acao: 'ENTREGA_DESCARTADA',
      valorNovo: {
        canal: m.canal,
        destinatario: m.destinatarioNome,
        telefone: m.destinatarioTelefone,
        titulo: m.titulo,
        tentativas: decisao.tentativas,
        erro: decisao.ultimoErro,
      },
      severidade: 'ALERTA',
    });
  }

  return { registro, resultado };
}

/** Varredura da fila externa. Roda no mesmo job das notificacoes. */
export async function despacharMensagensExternas(limite = 100, agora = new Date()): Promise<ResumoDespacho> {
  const pendentes = await prisma.mensagemExterna.findMany({
    where: {
      enviadaEm: null,
      descartadaEm: null,
      tentativas: { lt: MAX_TENTATIVAS },
      OR: [{ proximaTentativaEm: null }, { proximaTentativaEm: { lte: agora } }],
    },
    select: { id: true, canal: true },
    orderBy: { createdAt: 'asc' },
    take: limite,
  });

  const resumo: ResumoDespacho = {
    processadas: 0,
    entregues: 0,
    reagendadas: 0,
    descartadas: 0,
    naoConfigurados: {},
  };

  for (const p of pendentes) {
    const { registro, resultado } = await despacharMensagemExterna(p.id, agora);

    resumo.processadas += 1;
    if (resultado.estado === 'ENTREGUE') resumo.entregues += 1;
    else if (resultado.estado === 'NAO_CONFIGURADO') {
      const canal = p.canal as Canal;
      resumo.naoConfigurados[canal] = (resumo.naoConfigurados[canal] ?? 0) + 1;
    } else if (registro.descartadaEm) resumo.descartadas += 1;
    else resumo.reagendadas += 1;
  }

  return resumo;
}
