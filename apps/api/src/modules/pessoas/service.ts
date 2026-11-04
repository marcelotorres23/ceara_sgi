import type { StatusOcorrencia as StatusPrisma } from '@prisma/client';
import { db, novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { notificar, notificarPorPermissao } from '../../core/notifications/index.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import type { Ator } from '../compras/service.js';
import * as parametros from '../compras/parametros.js';
import {
  competenciaDe,
  consolidarCompetencia,
  consolidarPainel,
  aplicarVisibilidade,
  pontosDoCriterio,
  prazoEmDiasUteis,
  prazoVencido,
  type ExtratoMensal,
} from './pontuacao.js';

const requisicaoDe = (ator: Ator) => ({ ip: ator.ip ?? null, userAgent: ator.userAgent ?? null });

async function parametrosDePessoas() {
  const [base, dias, visibilidade] = await Promise.all([
    prisma.parametro.findUnique({ where: { chave: 'pessoas.pontos_base_mensal' } }),
    prisma.parametro.findUnique({ where: { chave: 'pessoas.dias_uteis_contestacao' } }),
    prisma.parametro.findUnique({ where: { chave: 'pessoas.visibilidade_ranking' } }),
  ]);

  return {
    pontosBase: Number(base?.valor ?? 100),
    diasContestacao: Number(dias?.valor ?? 5),
    visibilidade: String(visibilidade?.valor ?? 'APENAS_GESTOR') as 'PUBLICO' | 'APENAS_GESTOR' | 'ANONIMIZADO',
  };
}

// ---------------------------------------------------------------- ocorrencia

export interface NovaOcorrencia {
  colaboradorId: string;
  criterioId: string;
  descricao: string;
  competencia?: string;
  data?: Date;
  evidenciaTipo?: string | null;
  evidenciaId?: string | null;
  anexoId?: string | null;
  /** true quando quem lanca e o proprio sistema: nasce SUGERIDA (secao 9.2) */
  automatica?: boolean;
}

/**
 * Lanca a ocorrencia (secao 9.2).
 *
 * Exige evidencia e descricao factual; congela os pontos no lancamento — mudar o
 * peso do criterio depois nao pode reescrever competencia passada; e abre o prazo
 * de contestacao em dias uteis, notificando o colaborador.
 */
export async function lancarOcorrencia(ator: Ator, entrada: NovaOcorrencia) {
  const descricao = entrada.descricao?.trim() ?? '';
  if (descricao.length < 10) {
    throw new ValidationError('Descreva o fato em ao menos 10 caracteres. Pontuacao exige descricao factual.');
  }

  const [colaborador, criterio, cfg, calendario] = await Promise.all([
    prisma.colaborador.findFirst({
      where: { id: entrada.colaboradorId, deletedAt: null },
      include: { usuario: { select: { id: true } } },
    }),
    prisma.criterioPontuacao.findFirst({ where: { id: entrada.criterioId, ativo: true } }),
    parametrosDePessoas(),
    parametros.calendario(),
  ]);

  if (!colaborador) throw new NotFoundError('Colaborador');
  if (!criterio) throw new NotFoundError('Criterio de pontuacao');

  // manual sem evidencia e percepcao, nao medicao (secao 9.2)
  if (!entrada.automatica && !entrada.evidenciaId && !entrada.anexoId) {
    throw new ValidationError('Anexe a evidencia: registro do sistema, foto ou documento.');
  }

  const agora = entrada.data ?? new Date();
  const competencia = entrada.competencia ?? competenciaDe(agora);

  // competencia fechada e congelada: a ocorrencia atrasada vai para a competencia aberta
  const fechada = await prisma.pontuacaoMensal.findFirst({
    where: { colaboradorId: colaborador.id, competencia, fechadoEm: { not: null } },
  });
  if (fechada) {
    throw new ConflictError(
      `A competencia ${competencia} ja foi fechada. Lance a ocorrencia na competencia aberta, citando a data do fato.`,
    );
  }

  const automatica = entrada.automatica ?? false;
  const status: StatusPrisma = automatica ? 'SUGERIDA' : 'VALIDADA';
  const pontos = pontosDoCriterio(criterio.tipo, criterio.peso);

  // ocorrencia sugerida ainda nao vale: o prazo de defesa comeca na validacao
  const contestarAte = automatica ? null : prazoEmDiasUteis(agora, cfg.diasContestacao, calendario);

  const ocorrencia = await prisma.ocorrencia.create({
    data: {
      id: novoId(),
      colaboradorId: colaborador.id,
      criterioId: criterio.id,
      competencia,
      pontos,
      descricao,
      evidenciaTipo: entrada.evidenciaTipo ?? null,
      evidenciaId: entrada.evidenciaId ?? null,
      anexoId: entrada.anexoId ?? null,
      status,
      lancadoPor: ator.usuarioId,
      lancadoEm: agora,
      contestarAte,
    },
    include: { criterio: true },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'ocorrencias',
    entidadeId: ocorrencia.id,
    acao: automatica ? 'SUGERIR' : 'LANCAR',
    valorNovo: {
      colaborador: colaborador.nome,
      criterio: criterio.codigo,
      pontos,
      competencia,
      evidencia: entrada.evidenciaTipo ?? null,
    },
    severidade: 'ALERTA',
  });

  // o colaborador precisa saber para poder se defender dentro do prazo
  if (!automatica && colaborador.usuario) {
    await notificar({
      usuarioId: colaborador.usuario.id,
      titulo: `Ocorrencia lancada: ${criterio.descricao}`,
      corpo:
        `${descricao}\n\nPontos: ${pontos} · Competencia: ${competencia}\n` +
        `Voce pode contestar ate ${contestarAte?.toLocaleDateString('pt-BR')} com texto e anexo.`,
      entidade: 'ocorrencias',
      entidadeId: ocorrencia.id,
    });
  }

  if (automatica) {
    await notificarPorPermissao('ocorrencia:lancar', {
      titulo: `Ocorrencia sugerida pelo sistema: ${colaborador.nome}`,
      corpo: `${criterio.descricao}\n${descricao}\n\nSo vale apos validacao humana.`,
      entidade: 'ocorrencias',
      entidadeId: ocorrencia.id,
    });
  }

  return ocorrencia;
}

/** Valida ou descarta a ocorrencia sugerida pelo sistema (secao 9.2). */
export async function decidirSugestao(ator: Ator, ocorrenciaId: string, aceitar: boolean, justificativa: string) {
  const texto = justificativa?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe a justificativa da decisao para prosseguir.');

  const ocorrencia = await prisma.ocorrencia.findFirst({
    where: { id: ocorrenciaId },
    include: { colaborador: { include: { usuario: { select: { id: true } } } }, criterio: true },
  });
  if (!ocorrencia) throw new NotFoundError('Ocorrencia');
  if (ocorrencia.status !== 'SUGERIDA') {
    throw new ConflictError('Esta ocorrencia nao esta pendente de validacao.');
  }

  const [cfg, calendario] = await Promise.all([parametrosDePessoas(), parametros.calendario()]);
  const agora = new Date();

  const atualizada = await db.ocorrencia.update({
    where: { id: ocorrenciaId },
    data: {
      status: aceitar ? 'VALIDADA' : 'DESCARTADA',
      decisao: texto,
      decididoPor: ator.usuarioId,
      decididoEm: agora,
      // o prazo de defesa comeca a contar quando a ocorrencia passa a valer
      contestarAte: aceitar ? prazoEmDiasUteis(agora, cfg.diasContestacao, calendario) : null,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'ocorrencias',
    entidadeId: ocorrenciaId,
    acao: aceitar ? 'VALIDAR_SUGESTAO' : 'DESCARTAR_SUGESTAO',
    valorAnterior: { status: 'SUGERIDA' },
    valorNovo: { status: atualizada.status, justificativa: texto },
    severidade: 'ALERTA',
  });

  if (aceitar && ocorrencia.colaborador.usuario) {
    await notificar({
      usuarioId: ocorrencia.colaborador.usuario.id,
      titulo: `Ocorrencia validada: ${ocorrencia.criterio.descricao}`,
      corpo:
        `${ocorrencia.descricao}\n\nPontos: ${ocorrencia.pontos}\n` +
        `Voce pode contestar ate ${atualizada.contestarAte?.toLocaleDateString('pt-BR')}.`,
      entidade: 'ocorrencias',
      entidadeId: ocorrenciaId,
    });
  }

  return atualizada;
}

/** Contestacao do colaborador (secao 9.2): so ele mesmo, e dentro do prazo. */
export async function contestar(
  ator: Ator,
  ocorrenciaId: string,
  entrada: { texto: string; anexoId?: string | null },
) {
  const texto = entrada.texto?.trim() ?? '';
  if (texto.length < 10) throw new ValidationError('Descreva a contestacao em ao menos 10 caracteres.');

  const ocorrencia = await prisma.ocorrencia.findFirst({
    where: { id: ocorrenciaId },
    include: { colaborador: { include: { gestor: { include: { usuario: { select: { id: true } } } } } } },
  });
  if (!ocorrencia) throw new NotFoundError('Ocorrencia');

  const colaborador = await prisma.colaborador.findFirst({
    where: { id: ocorrencia.colaboradorId, usuarioId: ator.usuarioId },
    select: { id: true, nome: true },
  });
  if (!colaborador) throw new ForbiddenError('Somente o proprio colaborador pode contestar a ocorrencia.');

  if (ocorrencia.status === 'SUGERIDA') {
    throw new ConflictError('Esta ocorrencia ainda nao foi validada. Nao ha o que contestar.');
  }
  if (ocorrencia.status !== 'VALIDADA') {
    throw new ConflictError('Esta ocorrencia ja passou pela contestacao.');
  }
  if (prazoVencido(ocorrencia.contestarAte)) {
    throw new ConflictError(
      `O prazo de contestacao venceu em ${ocorrencia.contestarAte?.toLocaleDateString('pt-BR')}.`,
    );
  }

  const contestada = await db.ocorrencia.update({
    where: { id: ocorrenciaId },
    data: {
      status: 'CONTESTADA',
      contestadaEm: new Date(),
      contestacaoTexto: texto,
      contestacaoAnexoId: entrada.anexoId ?? null,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'ocorrencias',
    entidadeId: ocorrenciaId,
    acao: 'CONTESTAR',
    valorAnterior: { status: 'VALIDADA' },
    valorNovo: { status: 'CONTESTADA', texto },
  });

  const gestor = ocorrencia.colaborador.gestor?.usuario;
  if (gestor) {
    await notificar({
      usuarioId: gestor.id,
      titulo: `Contestacao de ${colaborador.nome}`,
      corpo: `${texto}\n\nRegistre a decisao com justificativa.`,
      entidade: 'ocorrencias',
      entidadeId: ocorrenciaId,
    });
  } else {
    await notificarPorPermissao('ocorrencia:decidir', {
      titulo: `Contestacao de ${colaborador.nome}`,
      corpo: `${texto}\n\nColaborador sem gestor imediato cadastrado. Registre a decisao com justificativa.`,
      entidade: 'ocorrencias',
      entidadeId: ocorrenciaId,
    });
  }

  return contestada;
}

/**
 * Decisao do gestor sobre a contestacao (secao 9.2). Reverter nao apaga:
 * o registro fica marcado como revertido e sai apenas da conta de pontos.
 */
export async function decidirContestacao(
  ator: Ator,
  ocorrenciaId: string,
  manter: boolean,
  justificativa: string,
) {
  const texto = justificativa?.trim() ?? '';
  if (texto.length < 10) {
    throw new ValidationError('A decisao exige justificativa de ao menos 10 caracteres.');
  }

  const ocorrencia = await prisma.ocorrencia.findFirst({
    where: { id: ocorrenciaId },
    include: { colaborador: { include: { usuario: { select: { id: true } } } }, criterio: true },
  });
  if (!ocorrencia) throw new NotFoundError('Ocorrencia');
  if (ocorrencia.status !== 'CONTESTADA') {
    throw new ConflictError('Esta ocorrencia nao esta em contestacao.');
  }

  // quem lancou nao decide a propria contestacao - e o mesmo principio da SoD (secao 5.3)
  if (ocorrencia.lancadoPor === ator.usuarioId) {
    await registrarAuditoria({
      usuarioId: ator.usuarioId,
      ...requisicaoDe(ator),
      entidade: 'ocorrencias',
      entidadeId: ocorrenciaId,
      acao: 'NEGADO:DECIDIR_PROPRIA_OCORRENCIA',
      valorNovo: { lancadoPor: ocorrencia.lancadoPor },
      severidade: 'SOD_VIOLATION',
    });
    throw new ForbiddenError('Quem lancou a ocorrencia nao decide a contestacao dela.');
  }

  const decidida = await db.ocorrencia.update({
    where: { id: ocorrenciaId },
    data: {
      status: manter ? 'MANTIDA' : 'REVERTIDA',
      decisao: texto,
      decididoPor: ator.usuarioId,
      decididoEm: new Date(),
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'ocorrencias',
    entidadeId: ocorrenciaId,
    acao: manter ? 'MANTER_OCORRENCIA' : 'REVERTER_OCORRENCIA',
    valorAnterior: { status: 'CONTESTADA', pontos: ocorrencia.pontos },
    valorNovo: { status: decidida.status, justificativa: texto },
    severidade: 'ALERTA',
  });

  if (ocorrencia.colaborador.usuario) {
    await notificar({
      usuarioId: ocorrencia.colaborador.usuario.id,
      titulo: manter ? 'Contestacao analisada: ocorrencia mantida' : 'Contestacao acolhida: ocorrencia revertida',
      corpo: `${ocorrencia.criterio.descricao}\n\nDecisao: ${texto}`,
      entidade: 'ocorrencias',
      entidadeId: ocorrenciaId,
    });
  }

  return decidida;
}

// ---------------------------------------------------------------- extrato e fechamento

/** Extrato da competencia, calculado ao vivo enquanto o mes nao foi fechado. */
export async function extratoDoColaborador(colaboradorId: string, competencia: string): Promise<{
  colaborador: { id: string; nome: string; cargo: string; setor: string; unidadeId: string };
  extrato: ExtratoMensal;
  fechado: boolean;
  ocorrencias: Array<Record<string, unknown>>;
}> {
  const colaborador = await prisma.colaborador.findFirst({
    where: { id: colaboradorId, deletedAt: null },
    select: { id: true, nome: true, cargo: true, setor: true, unidadeId: true },
  });
  if (!colaborador) throw new NotFoundError('Colaborador');

  const [ocorrencias, cfg, congelado] = await Promise.all([
    prisma.ocorrencia.findMany({
      where: { colaboradorId, competencia },
      include: { criterio: true },
      orderBy: { lancadoEm: 'desc' },
    }),
    parametrosDePessoas(),
    prisma.pontuacaoMensal.findUnique({
      where: { colaboradorId_competencia: { colaboradorId, competencia } },
    }),
  ]);

  const extrato = consolidarCompetencia(
    competencia,
    congelado?.pontosBase ?? cfg.pontosBase,
    ocorrencias.map((o) => ({
      id: o.id,
      criterioCodigo: o.criterio.codigo,
      criterioDescricao: o.criterio.descricao,
      tipo: o.criterio.tipo,
      pontos: o.pontos,
      status: o.status,
    })),
  );

  return {
    colaborador,
    // competencia fechada devolve o numero congelado, nao o recalculado
    extrato: congelado?.fechadoEm
      ? {
          ...extrato,
          pontosPositivos: congelado.pontosPositivos,
          pontosNegativos: congelado.pontosNegativos,
          pontosFinal: congelado.pontosFinal,
        }
      : extrato,
    fechado: Boolean(congelado?.fechadoEm),
    ocorrencias: ocorrencias.map((o) => ({
      id: o.id,
      criterio: o.criterio.descricao,
      codigo: o.criterio.codigo,
      tipo: o.criterio.tipo,
      pontos: o.pontos,
      descricao: o.descricao,
      status: o.status,
      lancadoEm: o.lancadoEm,
      contestarAte: o.contestarAte,
      contestacaoTexto: o.contestacaoTexto,
      decisao: o.decisao,
    })),
  };
}

/**
 * Fechamento mensal (secao 9.3): consolida, congela e impede novo lancamento na
 * competencia. Contestacao ainda aberta bloqueia o fechamento — fechar por cima
 * de uma defesa pendente tornaria o direito de contestar decorativo.
 */
export async function fecharCompetencia(ator: Ator, competencia: string, unidades: string[] = []) {
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    throw new ValidationError('Informe a competencia no formato AAAA-MM.');
  }
  if (competencia >= competenciaDe(new Date())) {
    throw new ValidationError('So e possivel fechar competencia ja encerrada.');
  }

  const cfg = await parametrosDePessoas();

  const colaboradores = await prisma.colaborador.findMany({
    where: {
      deletedAt: null,
      status: { not: 'DESLIGADO' },
      ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}),
    },
    select: { id: true, nome: true },
  });

  const pendentes = await prisma.ocorrencia.findMany({
    where: {
      competencia,
      status: { in: ['CONTESTADA', 'SUGERIDA'] },
      colaboradorId: { in: colaboradores.map((c) => c.id) },
    },
    include: { colaborador: { select: { nome: true } } },
  });

  if (pendentes.length > 0) {
    throw new ConflictError(
      `Ha ${pendentes.length} ocorrencia(s) pendentes de decisao ou validacao em ${competencia}. ` +
        `Resolva antes de fechar: ${[...new Set(pendentes.map((p) => p.colaborador.nome))].slice(0, 5).join(', ')}.`,
    );
  }

  const agora = new Date();
  const fechados: Array<{ colaboradorId: string; nome: string; pontosFinal: number }> = [];

  for (const colaborador of colaboradores) {
    const ocorrencias = await prisma.ocorrencia.findMany({
      where: { colaboradorId: colaborador.id, competencia },
      include: { criterio: true },
    });

    const extrato = consolidarCompetencia(
      competencia,
      cfg.pontosBase,
      ocorrencias.map((o) => ({
        id: o.id,
        criterioCodigo: o.criterio.codigo,
        criterioDescricao: o.criterio.descricao,
        tipo: o.criterio.tipo,
        pontos: o.pontos,
        status: o.status,
      })),
    );

    await prisma.pontuacaoMensal.upsert({
      where: { colaboradorId_competencia: { colaboradorId: colaborador.id, competencia } },
      update: {
        pontosBase: extrato.pontosBase,
        pontosPositivos: extrato.pontosPositivos,
        pontosNegativos: extrato.pontosNegativos,
        pontosFinal: extrato.pontosFinal,
        ocorrencias: extrato.ocorrenciasConsideradas,
        fechadoEm: agora,
        fechadoPor: ator.usuarioId,
      },
      create: {
        id: novoId(),
        colaboradorId: colaborador.id,
        competencia,
        pontosBase: extrato.pontosBase,
        pontosPositivos: extrato.pontosPositivos,
        pontosNegativos: extrato.pontosNegativos,
        pontosFinal: extrato.pontosFinal,
        ocorrencias: extrato.ocorrenciasConsideradas,
        fechadoEm: agora,
        fechadoPor: ator.usuarioId,
      },
    });

    fechados.push({ colaboradorId: colaborador.id, nome: colaborador.nome, pontosFinal: extrato.pontosFinal });
  }

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'pontuacao_mensal',
    entidadeId: null,
    acao: 'FECHAR_COMPETENCIA',
    valorNovo: { competencia, colaboradores: fechados.length, unidades },
    severidade: 'CRITICO',
  });

  return { competencia, fechados: fechados.length, colaboradores: fechados };
}

/** Painel do setor (secao 9.3), respeitando a visibilidade configurada. */
export async function painelDoSetor(
  ator: Ator,
  competencia: string,
  opcoes: { setor?: string | null; unidades?: string[]; ehGestor: boolean },
) {
  const cfg = await parametrosDePessoas();

  const colaboradores = await prisma.colaborador.findMany({
    where: {
      deletedAt: null,
      status: { not: 'DESLIGADO' },
      ...(opcoes.setor ? { setor: opcoes.setor } : {}),
      ...(opcoes.unidades && opcoes.unidades.length > 0 ? { unidadeId: { in: opcoes.unidades } } : {}),
    },
    select: { id: true, nome: true, setor: true, cargo: true, fotoUrl: true },
  });

  const linhas = await Promise.all(
    colaboradores.map(async (c) => {
      const { extrato } = await extratoDoColaborador(c.id, competencia);
      return {
        colaboradorId: c.id,
        nome: c.nome,
        setor: c.setor,
        cargo: c.cargo,
        fotoUrl: c.fotoUrl,
        pontosFinal: extrato.pontosFinal,
        pontosPositivos: extrato.pontosPositivos,
        pontosNegativos: extrato.pontosNegativos,
      };
    }),
  );

  const ranking = aplicarVisibilidade(
    [...linhas].sort((a, b) => b.pontosFinal - a.pontosFinal),
    cfg.visibilidade,
    opcoes.ehGestor,
  );

  return {
    competencia,
    visibilidade: cfg.visibilidade,
    painel: consolidarPainel(linhas, cfg.pontosBase),
    ranking,
    // a tela precisa exibir este aviso junto do numero (secao 9.2)
    aviso:
      'Pontuacao e insumo de gestao e desenvolvimento. Nao substitui avaliacao de desempenho ' +
      'nem embasa sozinha decisao disciplinar.',
  };
}
