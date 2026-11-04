import type { Prisma, TipoMovimentacao } from '@prisma/client';
import { db, novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { Decimal, dinheiro } from '../../core/money.js';
import type { Ator } from '../compras/service.js';
import { aplicarEntrada, aplicarSaida, ehEntrada } from './estoque.js';

const requisicaoDe = (ator: Ator) => ({ ip: ator.ip ?? null, userAgent: ator.userAgent ?? null });

export interface EntradaMovimentacao {
  almoxarifadoId: string;
  itemId: string;
  tipo: TipoMovimentacao;
  quantidade: string;
  custoUnitario?: string | null;
  documentoTipo?: string | null;
  documentoId?: string | null;
  veiculoId?: string | null;
  osId?: string | null;
  motivo?: string | null;
}

/** Tipos que exigem motivo registrado (secao 8.2). */
const EXIGEM_MOTIVO = new Set<TipoMovimentacao>([
  'ENTRADA_DEVOLUCAO', 'ENTRADA_AJUSTE', 'SAIDA_AJUSTE', 'SAIDA_DESCARTE',
]);

/**
 * Movimenta o estoque e recalcula o custo medio ponderado movel.
 *
 * Roda inteira em transacao com `SELECT ... FOR UPDATE` na linha de saldo: duas saidas
 * simultaneas do mesmo item nao podem ler o mesmo saldo e ambas passarem na checagem.
 */
export async function movimentar(ator: Ator, entrada: EntradaMovimentacao, tx?: Prisma.TransactionClient) {
  const quantidade = dinheiro(entrada.quantidade);
  if (quantidade.lessThanOrEqualTo(0)) throw new ValidationError('A quantidade precisa ser maior que zero.');

  if (EXIGEM_MOTIVO.has(entrada.tipo) && (entrada.motivo?.trim().length ?? 0) < 5) {
    throw new ValidationError('Informe o motivo da movimentacao para prosseguir.');
  }

  // Saida por requisicao rastreia custo por ativo: obrigatorio vincular veiculo + OS (secao 8.2).
  if (entrada.tipo === 'SAIDA_REQUISICAO' && (!entrada.veiculoId || !entrada.osId)) {
    throw new ValidationError('Saida por requisicao exige vinculo a um veiculo e a uma OS.');
  }

  const executar = async (cliente: Prisma.TransactionClient) => {
    const [saldoAtual] = await cliente.$queryRaw<Array<{ id: string; quantidade: string; custo_medio: string }>>`
      SELECT id, quantidade::text, custo_medio::text
      FROM saldos
      WHERE almoxarifado_id = ${entrada.almoxarifadoId} AND item_id = ${entrada.itemId}
      FOR UPDATE
    `;

    const posicaoAtual = saldoAtual
      ? { quantidade: new Decimal(saldoAtual.quantidade), custoMedio: new Decimal(saldoAtual.custo_medio) }
      : { quantidade: new Decimal(0), custoMedio: new Decimal(0) };

    const custo = entrada.custoUnitario != null ? dinheiro(entrada.custoUnitario) : posicaoAtual.custoMedio;

    let nova;
    try {
      nova = ehEntrada(entrada.tipo)
        ? aplicarEntrada(posicaoAtual, quantidade, custo)
        : aplicarSaida(posicaoAtual, quantidade);
    } catch (erro) {
      // saldo insuficiente e conflito de negocio, nao erro de programacao
      throw new ConflictError(erro instanceof Error ? erro.message : 'Movimentacao invalida.');
    }

    const agora = new Date();

    if (saldoAtual) {
      await cliente.saldo.update({
        where: { id: saldoAtual.id },
        data: {
          quantidade: nova.quantidade.toFixed(4),
          custoMedio: nova.custoMedio.toFixed(4),
          ultimaMovimentacaoEm: agora,
        },
      });
    } else {
      await cliente.saldo.create({
        data: {
          id: novoId(),
          almoxarifadoId: entrada.almoxarifadoId,
          itemId: entrada.itemId,
          quantidade: nova.quantidade.toFixed(4),
          custoMedio: nova.custoMedio.toFixed(4),
          ultimaMovimentacaoEm: agora,
        },
      });
    }

    return cliente.movimentacao.create({
      data: {
        id: novoId(),
        almoxarifadoId: entrada.almoxarifadoId,
        itemId: entrada.itemId,
        tipo: entrada.tipo,
        quantidade: quantidade.toFixed(4),
        custoUnitario: custo.toFixed(4),
        saldoApos: nova.quantidade.toFixed(4),
        custoMedioApos: nova.custoMedio.toFixed(4),
        documentoTipo: entrada.documentoTipo ?? null,
        documentoId: entrada.documentoId ?? null,
        veiculoId: entrada.veiculoId ?? null,
        osId: entrada.osId ?? null,
        motivo: entrada.motivo?.trim() ?? null,
        usuarioId: ator.usuarioId,
      },
    });
  };

  const movimentacao = tx ? await executar(tx) : await prisma.$transaction(executar);

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'movimentacoes',
    entidadeId: movimentacao.id,
    acao: entrada.tipo,
    valorNovo: {
      item: entrada.itemId,
      quantidade: movimentacao.quantidade.toString(),
      saldoApos: movimentacao.saldoApos.toString(),
      custoMedioApos: movimentacao.custoMedioApos.toString(),
      veiculoId: entrada.veiculoId ?? null,
      osId: entrada.osId ?? null,
    },
  });

  return movimentacao;
}

/**
 * Estorno (secao 8.2): nao se apaga movimentacao, gera-se o lancamento contrario
 * e os dois registros permanecem.
 */
const CONTRARIO: Record<TipoMovimentacao, TipoMovimentacao> = {
  ENTRADA_COMPRA: 'SAIDA_ESTORNO',
  ENTRADA_DEVOLUCAO: 'SAIDA_ESTORNO',
  ENTRADA_TRANSFERENCIA: 'SAIDA_ESTORNO',
  ENTRADA_AJUSTE: 'SAIDA_ESTORNO',
  ENTRADA_ESTORNO: 'SAIDA_ESTORNO',
  SAIDA_REQUISICAO: 'ENTRADA_ESTORNO',
  SAIDA_TRANSFERENCIA: 'ENTRADA_ESTORNO',
  SAIDA_AJUSTE: 'ENTRADA_ESTORNO',
  SAIDA_DESCARTE: 'ENTRADA_ESTORNO',
  SAIDA_ESTORNO: 'ENTRADA_ESTORNO',
};

export async function estornarMovimentacao(ator: Ator, movimentacaoId: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo do estorno para prosseguir.');

  const original = await prisma.movimentacao.findUnique({ where: { id: movimentacaoId } });
  if (!original) throw new NotFoundError('Movimentacao');
  if (original.estornadaPor) throw new ConflictError('Esta movimentacao ja foi estornada.');

  const estorno = await prisma.$transaction(async (tx) => {
    const contrario = await movimentar(
      ator,
      {
        almoxarifadoId: original.almoxarifadoId,
        itemId: original.itemId,
        tipo: CONTRARIO[original.tipo],
        quantidade: original.quantidade.toString(),
        custoUnitario: original.custoUnitario.toString(),
        documentoTipo: 'estorno',
        documentoId: original.id,
        motivo: texto,
      },
      tx,
    );

    await tx.movimentacao.update({ where: { id: contrario.id }, data: { estornoDe: original.id } });
    await tx.movimentacao.update({ where: { id: original.id }, data: { estornadaPor: contrario.id } });

    return contrario;
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'movimentacoes',
    entidadeId: original.id,
    acao: 'ESTORNAR',
    valorNovo: { estornoId: estorno.id, motivo: texto },
    severidade: 'ALERTA',
  });

  return estorno;
}

/**
 * Integracao M1 -> M3 (secao 3): recebimento aprovado gera entrada no almoxarifado.
 * Nao existe entrada manual sem pedido, exceto devolucao com motivo.
 *
 * Item com pagamento retido NAO entra: material avariado ou divergente nao vira saldo
 * disponivel antes da tratativa.
 */
export async function entradaPorRecebimento(ator: Ator, recebimentoId: string, almoxarifadoId: string) {
  const recebimento = await prisma.recebimento.findFirst({
    where: { id: recebimentoId, deletedAt: null },
    include: { itens: { include: { pedidoItem: true } }, pedido: { select: { numero: true } } },
  });
  if (!recebimento) throw new NotFoundError('Recebimento');
  if (recebimento.status === 'RECUSADO' || recebimento.status === 'EM_CONFERENCIA') {
    throw new ConflictError('Somente recebimento com aceite gera entrada no estoque.');
  }

  const jaEntrou = await prisma.movimentacao.findFirst({
    where: { documentoTipo: 'recebimento', documentoId: recebimentoId },
  });
  if (jaEntrou) throw new ConflictError('Este recebimento ja gerou entrada no estoque.');

  const aceitos = recebimento.itens.filter((i) => !i.pagamentoRetido && i.pedidoItem.itemId);
  if (aceitos.length === 0) {
    throw new ConflictError('Nenhum item conforme e vinculado ao catalogo neste recebimento.');
  }

  const movimentacoes = await prisma.$transaction(async (tx) => {
    const criadas = [];
    for (const item of aceitos) {
      criadas.push(
        await movimentar(
          ator,
          {
            almoxarifadoId,
            itemId: item.pedidoItem.itemId!,
            tipo: 'ENTRADA_COMPRA',
            quantidade: item.quantidadeRecebida.toString(),
            custoUnitario: (item.precoNotaFiscal ?? item.pedidoItem.precoUnitario).toString(),
            documentoTipo: 'recebimento',
            documentoId: recebimentoId,
          },
          tx,
        ),
      );
    }
    return criadas;
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'recebimentos',
    entidadeId: recebimentoId,
    acao: 'ENTRADA_ESTOQUE',
    valorNovo: {
      pedido: recebimento.pedido.numero,
      itens: movimentacoes.length,
      itensRetidos: recebimento.itens.length - aceitos.length,
    },
  });

  return movimentacoes;
}

/** Transferencia entre almoxarifados com dupla confirmacao: saida e entrada na mesma transacao. */
export async function transferir(
  ator: Ator,
  entrada: { origemId: string; destinoId: string; itemId: string; quantidade: string; motivo: string },
) {
  if (entrada.origemId === entrada.destinoId) {
    throw new ValidationError('Origem e destino precisam ser almoxarifados diferentes.');
  }
  const texto = entrada.motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo da transferencia.');

  return prisma.$transaction(async (tx) => {
    const saida = await movimentar(
      ator,
      {
        almoxarifadoId: entrada.origemId,
        itemId: entrada.itemId,
        tipo: 'SAIDA_TRANSFERENCIA',
        quantidade: entrada.quantidade,
        documentoTipo: 'transferencia',
        documentoId: entrada.destinoId,
        motivo: texto,
      },
      tx,
    );

    const chegada = await movimentar(
      ator,
      {
        almoxarifadoId: entrada.destinoId,
        itemId: entrada.itemId,
        tipo: 'ENTRADA_TRANSFERENCIA',
        quantidade: entrada.quantidade,
        // preserva o custo de origem: transferir nao cria nem destroi valor
        custoUnitario: saida.custoUnitario.toString(),
        documentoTipo: 'transferencia',
        documentoId: entrada.origemId,
        motivo: texto,
      },
      tx,
    );

    return { saida, entrada: chegada };
  });
}

/** Parametros de reposicao. O sistema sugere; o gestor confirma (secao 8.3). */
export async function definirParametros(
  ator: Ator,
  saldoId: string,
  dados: {
    estoqueMinimo?: string;
    estoqueMaximo?: string | null;
    pontoPedido?: string;
    loteEconomico?: string | null;
    leadTimeDias?: number;
  },
) {
  const saldo = await prisma.saldo.findUnique({ where: { id: saldoId } });
  if (!saldo) throw new NotFoundError('Saldo');

  const atualizado = await db.saldo.update({
    where: { id: saldoId },
    data: {
      ...(dados.estoqueMinimo != null ? { estoqueMinimo: dados.estoqueMinimo } : {}),
      ...(dados.estoqueMaximo !== undefined ? { estoqueMaximo: dados.estoqueMaximo } : {}),
      ...(dados.pontoPedido != null ? { pontoPedido: dados.pontoPedido, pontoPedidoManual: true } : {}),
      ...(dados.loteEconomico !== undefined ? { loteEconomico: dados.loteEconomico } : {}),
      ...(dados.leadTimeDias != null ? { leadTimeDias: dados.leadTimeDias } : {}),
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'saldos',
    entidadeId: saldoId,
    acao: 'DEFINIR_PARAMETROS',
    valorAnterior: {
      estoqueMinimo: saldo.estoqueMinimo.toString(),
      pontoPedido: saldo.pontoPedido.toString(),
      manual: saldo.pontoPedidoManual,
    },
    valorNovo: dados as never,
  });

  return atualizado;
}
