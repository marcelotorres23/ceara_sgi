import { prisma } from '../../core/db.js';
import { NotFoundError } from '../../core/errors/index.js';
import type { AccessClaims } from '../../core/auth/tokens.js';
import { filtroUnidadeEm } from '../../core/rbac/escopo.js';
import { gerarPdfDoPedido, type PedidoParaImprimir } from './pedido-pdf.js';

/**
 * Monta o pedido para impressao a partir do banco (secao 6.1.8).
 *
 * O layout mora em `pedido-pdf.ts` e nao sabe o que e Prisma; aqui so se le. A separacao
 * paga por si na hora de testar: a folha se confere sem banco, e a consulta se confere sem
 * abrir PDF.
 */

/**
 * `Fornecedor.contatos` e JSON livre. Aceita o objeto solto e a lista, porque o cadastro
 * veio de importacao e as duas formas existem no banco.
 */
function contatoDo(contatos: unknown): { email: string | null; telefone: string | null } {
  const primeiro = Array.isArray(contatos) ? contatos[0] : contatos;
  if (!primeiro || typeof primeiro !== 'object') return { email: null, telefone: null };
  const c = primeiro as Record<string, unknown>;
  const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  return { email: texto(c.email), telefone: texto(c.telefone) ?? texto(c.fone) ?? texto(c.celular) };
}

/** Formata CNPJ so na apresentacao; no banco ele mora limpo. */
const cnpjFormatado = (cnpj: string | null): string | null => {
  if (!cnpj) return null;
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

export async function pdfDoPedido(claims: AccessClaims, pedidoId: string): Promise<{ nome: string; conteudo: Buffer }> {
  const pedido = await prisma.pedido.findFirst({
    // o pedido herda a unidade do lote: quem nao alcanca a unidade nao baixa o documento
    where: { id: pedidoId, deletedAt: null, ...filtroUnidadeEm(claims, 'lote') },
    include: {
      itens: { include: { item: { select: { codigo: true, unidadeMedida: true } } } },
      fornecedor: true,
      lote: {
        include: {
          unidade: true,
          comprador: { select: { nome: true } },
          // a decisao vigente e a ultima; devolucoes anteriores ficam no historico do lote
          aprovacoes: { include: { aprovador: { select: { nome: true } } }, orderBy: { decididoEm: 'desc' } },
          mapas: { orderBy: { geradoEm: 'desc' }, take: 1 },
          solicitacoes: {
            include: {
              centroCusto: {
                select: { codigo: true, nome: true, veiculos: { where: { deletedAt: null }, select: { placa: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!pedido) throw new NotFoundError('Pedido');

  const cotacaoId = pedido.lote.mapas[0]?.cotacaoEscolhidaId ?? null;
  const cotacao = cotacaoId
    ? await prisma.cotacao.findUnique({
        where: { id: cotacaoId },
        select: { freteValor: true, descontoAvista: true, condicaoPagamento: true },
      })
    : null;

  // so aprovacao que aprova entra como prova; devolucao e reprovacao ficam no historico do lote
  const decisao = pedido.lote.aprovacoes.find((a) => a.decisao === 'APROVADO' || a.decisao === 'APROVADO_COM_RESSALVA');

  const centros = [...new Set(pedido.lote.solicitacoes.map((s) => `${s.centroCusto.codigo} — ${s.centroCusto.nome}`))];
  const placas = [
    ...new Set(pedido.lote.solicitacoes.flatMap((s) => s.centroCusto.veiculos.map((v) => v.placa))),
  ];

  const paraImprimir: PedidoParaImprimir = {
    numero: pedido.numero,
    emitidoEm: pedido.createdAt,
    emitidoPor: pedido.lote.comprador?.nome ?? '—',
    loteNumero: pedido.lote.numero,
    unidade: {
      nome: pedido.lote.unidade.nome,
      // a unidade ainda nao tem CNPJ no cadastro; o campo existe no layout para quando tiver
      cnpj: null,
      endereco: [pedido.lote.unidade.cidade, pedido.lote.unidade.uf].filter(Boolean).join('/') || null,
    },
    fornecedor: {
      razaoSocial: pedido.fornecedor.razaoSocial,
      cnpj: cnpjFormatado(pedido.fornecedor.cnpj),
      ...contatoDo(pedido.fornecedor.contatos),
    },
    condicaoPagamento: pedido.condicaoPagamento ?? cotacao?.condicaoPagamento ?? null,
    dataPrometida: pedido.dataReprogramada ?? pedido.dataPrometida,
    entrega: { local: pedido.lote.unidade.nome, centrosCusto: centros, placas },
    itens: pedido.itens.map((i) => ({
      codigo: i.item?.codigo ?? null,
      descricao: i.descricao,
      quantidade: i.quantidade.toString(),
      unidadeMedida: i.item?.unidadeMedida ?? 'UN',
      precoUnitario: i.precoUnitario.toString(),
    })),
    freteValor: cotacao?.freteValor?.toString() ?? null,
    descontoAvista: cotacao?.descontoAvista?.toString() ?? null,
    valorTotal: pedido.valorTotal.toString(),
    aprovacao: decisao
      ? {
          aprovador: decisao.aprovador?.nome ?? '—',
          decididoEm: decisao.decididoEm,
          nivel: decisao.nivel,
          hash: decisao.hash,
          ressalva: decisao.ressalva,
          autoaprovacao: decisao.autoaprovacao,
        }
      : null,
    observacoes: null,
  };

  return { nome: `${pedido.numero}.pdf`, conteudo: await gerarPdfDoPedido(paraImprimir) };
}
