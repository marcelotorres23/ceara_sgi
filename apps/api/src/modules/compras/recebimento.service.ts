import { db, novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { notificar } from '../../core/notifications/index.js';
import { garantirSod } from '../../core/rbac/sod.enforce.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { documentoDoTipo, validarDocumentoFiscal, type TipoDemanda } from './documento-fiscal.js';
import { dinheiro, paraBanco } from '../../core/money.js';
import { transicionarLote, type Ator } from './service.js';
import {
  atrasoEntradaFiscal, conferirRecebimento, podeGerarTitulo,
  type ItemConferido, type ItemDoPedido,
} from './three-way-match.js';
import type { StatusLote } from './state-machine.js';

const requisicaoDe = (ator: Ator) => ({ ip: ator.ip ?? null, userAgent: ator.userAgent ?? null });

async function toleranciaPreco(): Promise<number> {
  const p = await prisma.parametro.findUnique({ where: { chave: 'compras.tolerancia_divergencia_preco_nfe' } });
  return Number(p?.valor ?? 0.02);
}

export interface EntradaRecebimento {
  nfNumero?: string | null;
  nfChave?: string | null;
  nfValor?: string | null;
  nfEmitidaEm?: Date | null;
  observacao?: string | null;
  itens: Array<{
    pedidoItemId: string;
    quantidadeRecebida: string;
    precoNotaFiscal?: string | null;
    divergenciaManual?: 'ESPECIFICACAO' | 'AVARIA' | 'DOCUMENTACAO' | null;
    observacao?: string | null;
    anexoId?: string | null;
  }>;
}

/**
 * Registra o recebimento com three-way match (secao 6.1.10).
 * SoD: quem aprovou o lote e quem o cotou nao podem receber (regra de ouro 5).
 */
export async function registrarRecebimento(ator: Ator, pedidoId: string, entrada: EntradaRecebimento) {
  if (entrada.itens.length === 0) throw new ValidationError('Informe ao menos um item conferido.');

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, deletedAt: null },
    include: {
      itens: true,
      fornecedor: true,
      lote: { include: { solicitacoes: { select: { solicitanteId: true } } } },
      recebimentos: { where: { deletedAt: null }, include: { itens: true } },
    },
  });
  if (!pedido) throw new NotFoundError('Pedido');
  if (pedido.status === 'CANCELADO') throw new ConflictError('Pedido cancelado nao pode ser recebido.');
  if (pedido.status === 'RECEBIDO') throw new ConflictError('Este pedido ja foi integralmente recebido.');

  await garantirSod(
    {
      usuarioId: ator.usuarioId,
      acao: 'RECEBER',
      solicitantesIds: pedido.lote.solicitacoes.map((s) => s.solicitanteId),
      compradorId: pedido.lote.compradorId,
      aprovadorId: pedido.lote.aprovadorId,
      entidade: 'pedidos',
      entidadeId: pedidoId,
    },
    requisicaoDe(ator),
  );

  // quantidade ja recebida em conferencias anteriores, por item
  const jaRecebido = new Map<string, string>();
  for (const r of pedido.recebimentos) {
    for (const i of r.itens) {
      const atual = dinheiro(jaRecebido.get(i.pedidoItemId) ?? '0');
      jaRecebido.set(i.pedidoItemId, atual.plus(dinheiro(i.quantidadeRecebida.toString())).toString());
    }
  }

  const itensPedido: ItemDoPedido[] = pedido.itens.map((i) => ({
    pedidoItemId: i.id,
    descricao: i.descricao,
    quantidadePedida: i.quantidade.toString(),
    quantidadeJaRecebida: jaRecebido.get(i.id) ?? '0',
    precoUnitario: i.precoUnitario.toString(),
  }));

  const conferidos: ItemConferido[] = entrada.itens.map((i) => ({
    pedidoItemId: i.pedidoItemId,
    quantidadeRecebida: i.quantidadeRecebida,
    precoNotaFiscal: i.precoNotaFiscal ?? null,
    divergenciaManual: i.divergenciaManual ?? null,
    observacao: i.observacao ?? null,
  }));

  const match = conferirRecebimento(itensPedido, conferidos, await toleranciaPreco());

  const recebimento = await prisma.$transaction(async (tx) => {
    const id = novoId();
    const criado = await tx.recebimento.create({
      data: {
        id,
        pedidoId,
        almoxarifeId: ator.usuarioId,
        nfNumero: entrada.nfNumero ?? null,
        nfChave: entrada.nfChave ?? null,
        nfValor: entrada.nfValor ?? null,
        nfEmitidaEm: entrada.nfEmitidaEm ?? null,
        status: match.status,
        threeWayOk: match.threeWayOk,
        observacao: entrada.observacao ?? null,
        createdBy: ator.usuarioId,
        itens: {
          create: match.itens.map((i) => {
            const original = entrada.itens.find((e) => e.pedidoItemId === i.pedidoItemId);
            return {
              id: novoId(),
              pedidoItemId: i.pedidoItemId,
              quantidadeRecebida: i.quantidadeRecebida.toString(),
              precoNotaFiscal: i.precoNotaFiscal.toString(),
              conforme: i.conforme,
              tipoDivergencia: i.tipoDivergencia,
              pagamentoRetido: i.pagamentoRetido,
              observacao: i.observacao,
              anexoId: original?.anexoId ?? null,
            };
          }),
        },
      },
      include: { itens: true },
    });

    // acumula a quantidade recebida no item do pedido
    for (const i of match.itens) {
      await tx.pedidoItem.update({
        where: { id: i.pedidoItemId },
        data: { quantidadeRecebida: i.quantidadeAcumulada.toString() },
      });
    }

    await tx.pedido.update({
      where: { id: pedidoId },
      data: { status: match.entregaPendente ? 'PARCIALMENTE_RECEBIDO' : 'RECEBIDO' },
    });

    return criado;
  });

  // o lote acompanha o recebimento pela maquina de estados, nunca por UPDATE direto
  const lote = pedido.lote;
  const destino: StatusLote = match.bloqueiaEntradaFiscal
    ? 'BLOQUEADO_DIVERGENCIA'
    : match.entregaPendente
      ? 'RECEBIDO_PARCIAL'
      : 'RECEBIDO';

  if (lote.status === 'PEDIDO_EMITIDO') {
    await transicionarLote(ator, lote.id, 'AGUARDANDO_ENTREGA');
  }
  await transicionarLote(ator, lote.id, destino, match.motivoBloqueio ?? null);

  if (match.bloqueiaEntradaFiscal) {
    await notificar({
      usuarioId: lote.compradorId,
      titulo: `Divergencia de preco bloqueou o lote ${lote.numero}`,
      corpo: match.motivoBloqueio ?? 'Divergencia de preco na NF-e.',
      entidade: 'lotes',
      entidadeId: lote.id,
    });
  }

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'recebimentos',
    entidadeId: recebimento.id,
    acao: 'REGISTRAR',
    valorNovo: {
      pedido: pedido.numero,
      status: match.status,
      threeWayOk: match.threeWayOk,
      valorLiberado: match.valorLiberado.toFixed(2),
      valorRetido: match.valorRetido.toFixed(2),
      divergencias: match.divergencias,
      bloqueado: match.bloqueiaEntradaFiscal,
    },
    severidade: match.divergencias.length > 0 ? 'ALERTA' : 'INFO',
  });

  return { recebimento, match };
}

/**
 * Entrada fiscal: gera o titulo do valor LIBERADO (secao 6.1.11).
 * So habilita apos aceite; divergencia de preco acima da tolerancia bloqueia.
 */
export async function lancarEntradaFiscal(
  ator: Ator,
  recebimentoId: string,
  entrada: { vencimento: Date; condicao?: string | null; nfNumero?: string | null; nfChave?: string | null },
) {
  const recebimento = await prisma.recebimento.findFirst({
    where: { id: recebimentoId, deletedAt: null },
    include: {
      itens: true,
      titulos: { where: { deletedAt: null } },
      pedido: { include: { fornecedor: true, lote: true } },
    },
  });
  if (!recebimento) throw new NotFoundError('Recebimento');
  if (recebimento.titulos.length > 0) throw new ConflictError('Este recebimento ja gerou titulo.');

  // material fecha com NF-e e servico com NFS-e; a regra mora em `documento-fiscal.ts`
  const tipo = recebimento.pedido.lote.tipo as TipoDemanda;
  const documento = documentoDoTipo(tipo);

  const nfNumero = entrada.nfNumero ?? recebimento.nfNumero;
  const chaveInformada = entrada.nfChave ?? recebimento.nfChave;

  const problema = validarDocumentoFiscal({
    tipo,
    numero: nfNumero,
    chave: chaveInformada,
    cnpjDoFornecedor: recebimento.pedido.fornecedor.cnpj,
    razaoSocialDoFornecedor: recebimento.pedido.fornecedor.razaoSocial,
  });
  if (problema) throw new ValidationError(problema.mensagem);

  const valorLiberado = recebimento.itens
    .filter((i) => !i.pagamentoRetido)
    .reduce((soma, i) => soma.plus(dinheiro(i.quantidadeRecebida.toString()).times(dinheiro((i.precoNotaFiscal ?? 0).toString()))), dinheiro(0));

  const valorRetido = recebimento.itens
    .filter((i) => i.pagamentoRetido)
    .reduce((soma, i) => soma.plus(dinheiro(i.quantidadeRecebida.toString()).times(dinheiro((i.precoNotaFiscal ?? 0).toString()))), dinheiro(0));

  const bloqueado = recebimento.itens.some((i) => i.tipoDivergencia === 'PRECO_ACIMA_TOLERANCIA');

  const permissao = podeGerarTitulo({
    status: recebimento.status,
    bloqueiaEntradaFiscal: bloqueado,
    valorLiberado,
  });
  if (!permissao.pode) throw new ConflictError(permissao.motivo!);

  const agora = new Date();
  const prazo = atrasoEntradaFiscal(recebimento.recebidoEm, agora);

  const titulo = await prisma.$transaction(async (tx) => {
    await tx.recebimento.update({
      where: { id: recebimentoId },
      data: { fiscalEm: agora, nfNumero, nfChave: chaveInformada },
    });

    return tx.titulo.create({
      data: {
        id: novoId(),
        recebimentoId,
        fornecedorId: recebimento.pedido.fornecedorId,
        valor: paraBanco(valorLiberado),
        valorRetido: paraBanco(valorRetido),
        vencimento: entrada.vencimento,
        condicao: entrada.condicao ?? recebimento.pedido.condicaoPagamento,
        status: 'PROVISIONADO',
        createdBy: ator.usuarioId,
      },
    });
  });

  const lote = recebimento.pedido.lote;
  if (lote.status === 'RECEBIDO') await transicionarLote(ator, lote.id, 'NF_LANCADA');

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'titulos',
    entidadeId: titulo.id,
    acao: 'LANCAR_ENTRADA_FISCAL',
    valorNovo: {
      documento,
      nfNumero,
      valor: paraBanco(valorLiberado),
      valorRetido: paraBanco(valorRetido),
      horasEntreFisicoEFiscal: prazo.horas,
      dentroDoPrazo48h: prazo.dentroDoPrazo,
    },
    severidade: prazo.dentroDoPrazo ? 'INFO' : 'ALERTA',
  });

  /*
   * Fechada a nota, o processo acabou — e o sistema diz isso.
   *
   * As tres condicoes do encerramento (aceite, entrada fiscal, titulo) acabam de se
   * cumprir aqui: seria estranho exigir que alguem voltasse depois para clicar "encerrar".
   * Lote que fica parado em NF_LANCADA vira fila fantasma no painel — trabalho terminado
   * que continua pedindo atencao.
   *
   * Encerra em silencio se nao der: divergencia retida, por exemplo, mantem o lote aberto
   * de proposito, e a falha aqui nao pode desfazer o titulo que ja foi gravado.
   */
  const encerramento = await encerrarSePossivel(ator, lote.id);

  return { titulo, prazo, encerrado: encerramento };
}

/**
 * Encerra o lote quando as condicoes ja se cumpriram, sem quebrar quando nao se cumpriram.
 *
 * Devolve o que aconteceu, para a tela poder dizer "processo finalizado" em vez de deixar
 * a pessoa adivinhar se ainda falta alguma coisa.
 */
async function encerrarSePossivel(ator: Ator, loteId: string): Promise<{ ok: boolean; motivo: string | null }> {
  try {
    await encerrarLote(ator, loteId);
    return { ok: true, motivo: null };
  } catch (erro) {
    return { ok: false, motivo: erro instanceof Error ? erro.message : null };
  }
}

/** Bloqueio manual de titulo pelo fiscal/financeiro, sempre com motivo. */
export async function bloquearTitulo(ator: Ator, tituloId: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo do bloqueio para prosseguir.');

  const titulo = await prisma.titulo.findFirst({ where: { id: tituloId, deletedAt: null } });
  if (!titulo) throw new NotFoundError('Titulo');
  if (titulo.status === 'PAGO') throw new ConflictError('Titulo pago nao pode ser bloqueado.');

  const atualizado = await db.titulo.update({
    where: { id: tituloId },
    data: { bloqueado: true, motivoBloqueio: texto, status: 'BLOQUEADO' },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'titulos',
    entidadeId: tituloId,
    acao: 'BLOQUEAR',
    valorAnterior: { status: titulo.status },
    valorNovo: { status: 'BLOQUEADO', motivo: texto },
    severidade: 'ALERTA',
  });

  return atualizado;
}

export async function liberarTitulo(ator: Ator, tituloId: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo da liberacao para prosseguir.');

  const titulo = await prisma.titulo.findFirst({ where: { id: tituloId, deletedAt: null } });
  if (!titulo) throw new NotFoundError('Titulo');

  const atualizado = await db.titulo.update({
    where: { id: tituloId },
    data: { bloqueado: false, motivoBloqueio: null, status: 'LIBERADO' },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'titulos',
    entidadeId: tituloId,
    acao: 'LIBERAR',
    valorAnterior: { status: titulo.status, motivoBloqueio: titulo.motivoBloqueio },
    valorNovo: { status: 'LIBERADO', motivo: texto },
  });

  return atualizado;
}

/**
 * Encerramento do lote: so com material recebido, NF-e lancada e titulo provisionado
 * (secao 6.2). As tres condicoes sao conferidas no banco, nao confiadas ao chamador.
 */
export async function encerrarLote(ator: Ator, loteId: string) {
  const lote = await prisma.lote.findFirst({
    where: { id: loteId, deletedAt: null },
    include: {
      pedidos: {
        include: { recebimentos: { where: { deletedAt: null }, include: { titulos: { where: { deletedAt: null } } } } },
      },
    },
  });
  if (!lote) throw new NotFoundError('Lote');

  const recebimentos = lote.pedidos.flatMap((p) => p.recebimentos);
  const materialRecebido = recebimentos.some((r) => r.status === 'ACEITE_TOTAL' || r.status === 'ACEITE_PARCIAL');
  const notaFiscalLancada = recebimentos.some((r) => r.fiscalEm !== null);
  const tituloProvisionado = recebimentos.flatMap((r) => r.titulos).length > 0;

  if (!materialRecebido || !notaFiscalLancada || !tituloProvisionado) {
    const faltando = [
      !materialRecebido && 'aceite de recebimento',
      !notaFiscalLancada && 'entrada fiscal',
      !tituloProvisionado && 'titulo provisionado',
    ].filter(Boolean);
    throw new ConflictError(`Encerramento exige: ${faltando.join(', ')}.`);
  }

  const encerrado = await transicionarLote(ator, loteId, 'ENCERRADO');

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'lotes',
    entidadeId: loteId,
    acao: 'ENCERRAR',
    valorNovo: { materialRecebido, notaFiscalLancada, tituloProvisionado },
  });

  return encerrado;
}
