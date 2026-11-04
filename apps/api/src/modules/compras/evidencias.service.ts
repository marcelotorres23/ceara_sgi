import { db, novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { MIMES_EVIDENCIA, salvarArquivo, urlAssinada } from '../../core/storage/index.js';
import type { Ator } from './service.js';

/**
 * Evidencia da cotacao (secao 6.1.5): o print ou o PDF do orcamento que o
 * fornecedor mandou.
 *
 * O POP tratou "cotacao por WhatsApp sem registro" como fragilidade. O preco
 * digitado pelo comprador e a palavra dele; a evidencia e o que sustenta o preco
 * numa auditoria, seis meses depois, quando ninguem lembra da conversa.
 *
 * A evidencia acompanha a COTACAO, nao o lote: cada fornecedor tem a sua, e o
 * mapa consegue apontar de onde veio cada numero comparado.
 */

/** Entidade usada em `anexos.entidade` - a mesma tabela das fotos de checklist. */
const ENTIDADE = 'cotacoes';

export interface EvidenciaParaAnexar {
  conteudo: Buffer;
  mime: string;
  nome: string;
  /** o que e este arquivo: 'Orcamento em PDF', 'Print do WhatsApp', 'E-mail do vendedor' */
  descricao?: string | null;
}

/** Estados do lote em que ainda faz sentido anexar evidencia. */
const ENCERRADOS = new Set(['ENCERRADO', 'CANCELADO', 'REPROVADO']);

async function cotacaoNoEscopo(ator: Ator, cotacaoId: string) {
  const cotacao = await prisma.cotacao.findFirst({
    where: { id: cotacaoId, deletedAt: null },
    include: {
      fornecedor: { select: { razaoSocial: true } },
      lote: { select: { id: true, numero: true, status: true, unidadeId: true } },
    },
  });
  if (!cotacao) throw new NotFoundError('Cotacao');

  // mesmo recorte de unidade das demais telas de compras (secao 5.6)
  if (!ator.todasUnidades && ator.unidadeId !== cotacao.lote.unidadeId) {
    throw new NotFoundError('Cotacao');
  }

  return cotacao;
}

export async function anexarEvidencia(ator: Ator, cotacaoId: string, arquivo: EvidenciaParaAnexar) {
  const cotacao = await cotacaoNoEscopo(ator, cotacaoId);

  if (ENCERRADOS.has(cotacao.lote.status)) {
    throw new ConflictError(`O lote ${cotacao.lote.numero} esta ${cotacao.lote.status.toLowerCase()} e nao recebe mais evidencia.`);
  }

  const salvo = await salvarArquivo({
    conteudo: arquivo.conteudo,
    mime: arquivo.mime,
    nome: arquivo.nome,
    pasta: `cotacoes/${cotacao.lote.numero}`,
    mimesAceitos: MIMES_EVIDENCIA,
  });

  // o hash deduplica: reenviar o mesmo print nao cria segunda linha
  const existente = await prisma.anexo.findFirst({
    where: { entidade: ENTIDADE, entidadeId: cotacaoId, hashSha256: salvo.hashSha256, deletedAt: null },
  });
  if (existente) return { anexo: existente, duplicada: true };

  const anexo = await prisma.anexo.create({
    data: {
      id: novoId(),
      entidade: ENTIDADE,
      entidadeId: cotacaoId,
      nome: arquivo.descricao?.trim() || arquivo.nome,
      mime: arquivo.mime,
      tamanho: salvo.tamanho,
      url: salvo.chave,
      hashSha256: salvo.hashSha256,
      usuarioId: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ip: ator.ip ?? null,
    userAgent: ator.userAgent ?? null,
    entidade: 'cotacoes',
    entidadeId: cotacaoId,
    acao: 'ANEXAR_EVIDENCIA',
    valorNovo: {
      lote: cotacao.lote.numero,
      fornecedor: cotacao.fornecedor.razaoSocial,
      arquivo: anexo.nome,
      mime: anexo.mime,
      hash: salvo.hashSha256,
    },
  });

  return { anexo, duplicada: false };
}

/** Evidencias de uma cotacao, com URL assinada de leitura temporaria. */
export async function evidenciasDaCotacao(ator: Ator, cotacaoId: string) {
  await cotacaoNoEscopo(ator, cotacaoId);

  const anexos = await prisma.anexo.findMany({
    where: { entidade: ENTIDADE, entidadeId: cotacaoId, deletedAt: null },
    include: { usuario: { select: { nome: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return Promise.all(
    anexos.map(async (a) => ({
      id: a.id,
      nome: a.nome,
      mime: a.mime,
      tamanho: a.tamanho,
      anexadoPor: a.usuario.nome,
      anexadoEm: a.createdAt,
      hashSha256: a.hashSha256,
      // o bucket nao e publico: a URL vale por uma hora
      url: await urlAssinada(a.url),
    })),
  );
}

/** Quantas evidencias cada cotacao do lote tem - alimenta a tela e o mapa. */
export async function contarEvidenciasDoLote(loteId: string): Promise<Record<string, number>> {
  const cotacoes = await prisma.cotacao.findMany({
    where: { loteId, deletedAt: null },
    select: { id: true },
  });
  if (cotacoes.length === 0) return {};

  const anexos = await prisma.anexo.groupBy({
    by: ['entidadeId'],
    where: { entidade: ENTIDADE, entidadeId: { in: cotacoes.map((c) => c.id) }, deletedAt: null },
    _count: true,
  });

  return Object.fromEntries(anexos.map((a) => [a.entidadeId, a._count]));
}

/**
 * Regra de ouro 2 aplicada ao anexo: nao se exclui, inativa-se com motivo.
 * Print anexado por engano some da tela, mas o registro de que existiu permanece.
 */
export async function removerEvidencia(ator: Ator, anexoId: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo da remocao da evidencia.');

  const anexo = await prisma.anexo.findFirst({
    where: { id: anexoId, entidade: ENTIDADE, deletedAt: null },
  });
  if (!anexo) throw new NotFoundError('Evidencia');

  await cotacaoNoEscopo(ator, anexo.entidadeId);

  const removido = await db.anexo.update({ where: { id: anexoId }, data: { deletedAt: new Date() } });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ip: ator.ip ?? null,
    userAgent: ator.userAgent ?? null,
    entidade: 'cotacoes',
    entidadeId: anexo.entidadeId,
    acao: 'REMOVER_EVIDENCIA',
    valorAnterior: { arquivo: anexo.nome, hash: anexo.hashSha256 },
    valorNovo: { motivo: texto },
    severidade: 'ALERTA',
  });

  return removido;
}
