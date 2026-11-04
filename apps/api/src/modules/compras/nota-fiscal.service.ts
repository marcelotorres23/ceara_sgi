import { novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { NotFoundError, ValidationError } from '../../core/errors/index.js';
import { salvarArquivo, urlAssinada } from '../../core/storage/index.js';
import type { Ator } from './service.js';

/**
 * Arquivo da nota fiscal do recebimento (secao 6.1.11).
 *
 * O numero e a chave ja ficavam gravados, mas o **documento** nao. Quem precisa dele
 * depois — o fiscal na conferencia, o financeiro na divergencia de pagamento, o auditor
 * seis meses adiante — ia procurar no e-mail de alguem. Nota fiscal cujo arquivo mora na
 * caixa de entrada de uma pessoa e nota que some quando essa pessoa sai da empresa.
 *
 * Aceita o PDF (DANFE ou a nota de servico impressa), o XML da NF-e e a foto da nota em
 * papel, que ainda chega assim do fornecedor pequeno.
 */

/** Entidade usada em `anexos.entidade`. */
const ENTIDADE = 'recebimentos';

/**
 * Tipos aceitos.
 *
 * O XML entra como `text/xml` ou `application/xml` conforme o navegador; alguns mandam
 * `application/octet-stream` quando o arquivo vem de anexo de e-mail salvo em disco, e
 * recusar isso so faria a pessoa renomear o arquivo para conseguir subir.
 */
const MIMES_NOTA = new Set([
  'application/pdf',
  'text/xml',
  'application/xml',
  'application/octet-stream',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface NotaParaAnexar {
  conteudo: Buffer;
  mime: string;
  nome: string;
  /** o que e o arquivo: 'DANFE', 'XML da NF-e', 'NFS-e da prefeitura' */
  descricao?: string | null;
}

async function recebimentoNoEscopo(ator: Ator, recebimentoId: string) {
  const recebimento = await prisma.recebimento.findFirst({
    where: { id: recebimentoId, deletedAt: null },
    include: {
      pedido: {
        select: {
          numero: true,
          fornecedor: { select: { razaoSocial: true } },
          lote: { select: { id: true, numero: true, tipo: true, unidadeId: true } },
        },
      },
    },
  });
  if (!recebimento) throw new NotFoundError('Recebimento');

  // mesmo recorte de unidade das demais telas de compras (secao 5.6)
  if (!ator.todasUnidades && ator.unidadeId !== recebimento.pedido.lote.unidadeId) {
    throw new NotFoundError('Recebimento');
  }

  return recebimento;
}

export async function anexarNotaFiscal(ator: Ator, recebimentoId: string, arquivo: NotaParaAnexar) {
  const recebimento = await recebimentoNoEscopo(ator, recebimentoId);

  const salvo = await salvarArquivo({
    conteudo: arquivo.conteudo,
    mime: arquivo.mime,
    nome: arquivo.nome,
    pasta: `notas-fiscais/${recebimento.pedido.lote.numero}`,
    mimesAceitos: MIMES_NOTA,
  });

  // o hash deduplica: reenviar o mesmo arquivo nao cria segunda linha
  const existente = await prisma.anexo.findFirst({
    where: { entidade: ENTIDADE, entidadeId: recebimentoId, hashSha256: salvo.hashSha256, deletedAt: null },
  });
  if (existente) return { anexo: existente, duplicada: true };

  const anexo = await prisma.anexo.create({
    data: {
      id: novoId(),
      entidade: ENTIDADE,
      entidadeId: recebimentoId,
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
    entidade: ENTIDADE,
    entidadeId: recebimentoId,
    acao: 'ANEXAR_NOTA_FISCAL',
    valorNovo: {
      pedido: recebimento.pedido.numero,
      fornecedor: recebimento.pedido.fornecedor.razaoSocial,
      documento: recebimento.pedido.lote.tipo === 'SERVICO' ? 'NFS-e' : 'NF-e',
      arquivo: anexo.nome,
      mime: anexo.mime,
      hash: salvo.hashSha256,
    },
  });

  return { anexo, duplicada: false };
}

/** Notas anexadas a um recebimento, com URL assinada de leitura temporaria. */
export async function notasDoRecebimento(ator: Ator, recebimentoId: string) {
  await recebimentoNoEscopo(ator, recebimentoId);

  const anexos = await prisma.anexo.findMany({
    where: { entidade: ENTIDADE, entidadeId: recebimentoId, deletedAt: null },
    include: { usuario: { select: { nome: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return Promise.all(
    anexos.map(async (a) => ({
      id: a.id,
      nome: a.nome,
      mime: a.mime,
      tamanho: a.tamanho,
      enviadoPor: a.usuario.nome,
      enviadoEm: a.createdAt,
      url: await urlAssinada(a.url),
    })),
  );
}

/**
 * Remove o anexo com motivo (regra de ouro 2: nao se apaga, inativa-se).
 *
 * Existe porque anexar a nota errada acontece — e a nota errada no recebimento certo e
 * pior que nenhuma nota: alguem confere o pagamento contra o documento de outro pedido.
 */
export async function removerNotaFiscal(ator: Ator, anexoId: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo da remocao para prosseguir.');

  const anexo = await prisma.anexo.findFirst({ where: { id: anexoId, entidade: ENTIDADE, deletedAt: null } });
  if (!anexo) throw new NotFoundError('Anexo');

  await recebimentoNoEscopo(ator, anexo.entidadeId);

  const removido = await prisma.anexo.update({ where: { id: anexoId }, data: { deletedAt: new Date() } });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ip: ator.ip ?? null,
    userAgent: ator.userAgent ?? null,
    entidade: ENTIDADE,
    entidadeId: anexo.entidadeId,
    acao: 'REMOVER_NOTA_FISCAL',
    valorAnterior: { arquivo: anexo.nome, hash: anexo.hashSha256 },
    valorNovo: { motivo: texto },
    severidade: 'ALERTA',
  });

  return removido;
}
