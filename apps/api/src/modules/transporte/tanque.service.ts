import type { Prisma, TipoMovimentacaoTanque as TipoPrisma } from '@prisma/client';
import { db, novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { notificarPorPermissao } from '../../core/notifications/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { Decimal, dinheiro, emPtBr, paraBanco } from '../../core/money.js';
import type { Ator } from '../compras/service.js';
import {
  abastecerTanque,
  apurarAfericao,
  conferirEncerrante,
  ehEntradaNoTanque,
  retirarDoTanque,
  valorNoTanque,
} from './tanque.js';

/**
 * Estoque de combustivel do tanque proprio (secao 7.9).
 *
 * Toda movimentacao roda em transacao com `SELECT ... FOR UPDATE` na linha do
 * tanque: dois abastecimentos simultaneos no mesmo bico nao podem ler o mesmo
 * saldo e ambos passarem na checagem. E o mesmo cuidado do almoxarifado (secao 8.2).
 */

const requisicaoDe = (ator: Ator) => ({ ip: ator.ip ?? null, userAgent: ator.userAgent ?? null });

/** Tolerancia de perda na afericao, em fracao do saldo. Parametrizavel (secao 5.5). */
async function toleranciaAfericao(): Promise<number> {
  const p = await prisma.parametro.findUnique({ where: { chave: 'frota.tolerancia_afericao_tanque' } });
  return Number(p?.valor ?? 0.005);
}

async function tanqueNoEscopo(ator: Ator, tanqueId: string) {
  const tanque = await prisma.tanque.findFirst({
    where: { id: tanqueId, deletedAt: null },
    include: { produto: true, unidade: { select: { codigo: true } } },
  });
  if (!tanque) throw new NotFoundError('Tanque');

  if (!ator.todasUnidades && ator.unidadeId !== tanque.unidadeId) throw new NotFoundError('Tanque');
  return tanque;
}

// ---------------------------------------------------------------- movimentacao

export interface MovimentacaoDeTanque {
  tipo: TipoPrisma;
  litros: string;
  custoUnitario?: string | null;
  notaFiscal?: string | null;
  fornecedorId?: string | null;
  tanqueDestinoId?: string | null;
  abastecimentoId?: string | null;
  afericaoId?: string | null;
  motivo?: string | null;
  data?: Date;
}

/** Tipos que exigem motivo declarado - acerto mexe no saldo sem lastro fisico. */
const EXIGEM_MOTIVO = new Set<TipoPrisma>(['ENTRADA_ACERTO', 'SAIDA_ACERTO']);

export async function movimentarTanque(
  ator: Ator,
  tanqueId: string,
  entrada: MovimentacaoDeTanque,
  tx?: Prisma.TransactionClient,
) {
  const litros = dinheiro(entrada.litros);
  if (litros.lessThanOrEqualTo(0)) throw new ValidationError('Informe um volume maior que zero.');

  if (EXIGEM_MOTIVO.has(entrada.tipo) && (entrada.motivo?.trim().length ?? 0) < 5) {
    throw new ValidationError('Acerto de tanque exige motivo registrado.');
  }

  if (entrada.tipo === 'ENTRADA_COMPRA' && !entrada.notaFiscal?.trim()) {
    throw new ValidationError('Entrada por compra exige o numero da nota fiscal.');
  }

  const executar = async (cliente: Prisma.TransactionClient) => {
    const [linha] = await cliente.$queryRaw<Array<{ id: string; saldo_litros: string; custo_medio: string; capacidade_litros: string }>>`
      SELECT id, saldo_litros::text, custo_medio::text, capacidade_litros::text
      FROM tanques
      WHERE id = ${tanqueId} AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (!linha) throw new NotFoundError('Tanque');

    const atual = {
      saldoLitros: new Decimal(linha.saldo_litros),
      custoMedio: new Decimal(linha.custo_medio),
    };

    const custo = entrada.custoUnitario != null ? dinheiro(entrada.custoUnitario) : atual.custoMedio;

    let nova;
    try {
      nova = ehEntradaNoTanque(entrada.tipo)
        ? abastecerTanque(atual, litros, custo, linha.capacidade_litros)
        : retirarDoTanque(atual, litros);
    } catch (erro) {
      // saldo insuficiente e capacidade estourada sao conflito de negocio, nao bug
      throw new ConflictError(erro instanceof Error ? erro.message : 'Movimentacao invalida.');
    }

    await cliente.tanque.update({
      where: { id: tanqueId },
      data: {
        saldoLitros: nova.saldoLitros.toFixed(3),
        custoMedio: nova.custoMedio.toFixed(4),
        updatedBy: ator.usuarioId,
      },
    });

    return cliente.movimentacaoTanque.create({
      data: {
        id: novoId(),
        tanqueId,
        tipo: entrada.tipo,
        litros: litros.toFixed(3),
        custoUnitario: custo.toFixed(4),
        custoMedioApos: nova.custoMedio.toFixed(4),
        saldoApos: nova.saldoLitros.toFixed(3),
        notaFiscal: entrada.notaFiscal?.trim() ?? null,
        fornecedorId: entrada.fornecedorId ?? null,
        tanqueDestinoId: entrada.tanqueDestinoId ?? null,
        abastecimentoId: entrada.abastecimentoId ?? null,
        afericaoId: entrada.afericaoId ?? null,
        motivo: entrada.motivo?.trim() ?? null,
        usuarioId: ator.usuarioId,
        data: entrada.data ?? new Date(),
      },
    });
  };

  const movimentacao = tx ? await executar(tx) : await prisma.$transaction(executar);

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'movimentacoes_tanque',
    entidadeId: movimentacao.id,
    acao: entrada.tipo,
    valorNovo: {
      tanque: tanqueId,
      litros: movimentacao.litros.toString(),
      custoUnitario: movimentacao.custoUnitario.toString(),
      saldoApos: movimentacao.saldoApos.toString(),
      notaFiscal: movimentacao.notaFiscal,
    },
    severidade: EXIGEM_MOTIVO.has(entrada.tipo) ? 'ALERTA' : 'INFO',
  });

  return movimentacao;
}

/**
 * Transferencia do tanque fixo para o comboio (CTA Mobile faz o mesmo papel).
 * Sai de um, entra no outro, com o custo medio da origem: o combustivel nao muda
 * de valor por mudar de tanque.
 */
export async function transferirEntreTanques(
  ator: Ator,
  origemId: string,
  destinoId: string,
  litros: string,
  motivo?: string | null,
) {
  if (origemId === destinoId) throw new ValidationError('Origem e destino sao o mesmo tanque.');

  const [origem, destino] = await Promise.all([
    tanqueNoEscopo(ator, origemId),
    tanqueNoEscopo(ator, destinoId),
  ]);

  if (origem.produtoId !== destino.produtoId) {
    throw new ValidationError(
      `Nao se transfere ${origem.produto.nome} para um tanque de ${destino.produto.nome}. Misturar produto contamina os dois.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const saida = await movimentarTanque(
      ator,
      origemId,
      { tipo: 'SAIDA_TRANSFERENCIA', litros, tanqueDestinoId: destinoId, motivo },
      tx,
    );

    const entrada = await movimentarTanque(
      ator,
      destinoId,
      {
        tipo: 'ENTRADA_TRANSFERENCIA',
        litros,
        // o custo vem da origem, apurado na saida
        custoUnitario: saida.custoUnitario.toString(),
        motivo: motivo ?? `Transferencia do tanque ${origem.codigo}`,
      },
      tx,
    );

    return { saida, entrada };
  });
}

// ---------------------------------------------------------------- afericao

export interface NovaAfericao {
  saldoMedido: string;
  data?: Date;
  motivo?: string | null;
  anexoId?: string | null;
  /** true para ja lancar o acerto que iguala o sistema a medicao */
  acertarSaldo?: boolean;
}

/**
 * Afericao: a regua contra o sistema (secao 7.9).
 *
 * Diferenca acima da tolerancia **nao** vira ajuste silencioso: exige motivo e
 * notifica a gestao de frota. Diferenca de combustivel some quando o sistema a
 * absorve sem perguntar - e era isso que a planilha fazia.
 */
export async function aferirTanque(ator: Ator, tanqueId: string, entrada: NovaAfericao) {
  const tanque = await tanqueNoEscopo(ator, tanqueId);
  const tolerancia = await toleranciaAfericao();

  const apuracao = apurarAfericao(
    tanque.saldoLitros.toString(),
    entrada.saldoMedido,
    tanque.custoMedio.toString(),
    tolerancia,
  );

  if (apuracao.exigeJustificativa && (entrada.motivo?.trim().length ?? 0) < 10) {
    throw new ValidationError(
      `${apuracao.mensagem} Descreva o que foi apurado em ao menos 10 caracteres para prosseguir.`,
    );
  }

  const agora = entrada.data ?? new Date();

  const afericao = await prisma.$transaction(async (tx) => {
    const criada = await tx.afericaoTanque.create({
      data: {
        id: novoId(),
        tanqueId,
        data: agora,
        saldoSistema: apuracao.saldoSistema,
        saldoMedido: apuracao.saldoMedido,
        diferenca: apuracao.diferenca,
        percentual: apuracao.percentual.toFixed(4),
        dentroDaTolerancia: apuracao.dentroDaTolerancia,
        motivo: entrada.motivo?.trim() ?? null,
        anexoId: entrada.anexoId ?? null,
        aferidoPor: ator.usuarioId,
      },
    });

    // o acerto e opcional e explicito: aferir e medir, ajustar e outra decisao
    if (entrada.acertarSaldo && apuracao.resultado !== 'CONFORME') {
      const diferenca = dinheiro(apuracao.diferenca);
      await movimentarTanque(
        ator,
        tanqueId,
        {
          tipo: diferenca.isPositive() ? 'ENTRADA_ACERTO' : 'SAIDA_ACERTO',
          litros: diferenca.abs().toFixed(3),
          afericaoId: criada.id,
          motivo: entrada.motivo?.trim() || `Acerto pela afericao de ${agora.toLocaleDateString('pt-BR')}`,
          data: agora,
        },
        tx,
      );
    }

    await tx.tanque.update({ where: { id: tanqueId }, data: { ultimaAfericaoEm: agora } });
    return criada;
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'afericoes_tanque',
    entidadeId: afericao.id,
    acao: 'AFERIR',
    valorNovo: {
      tanque: tanque.codigo,
      saldoSistema: apuracao.saldoSistema,
      saldoMedido: apuracao.saldoMedido,
      diferenca: apuracao.diferenca,
      resultado: apuracao.resultado,
      dentroDaTolerancia: apuracao.dentroDaTolerancia,
      impactoFinanceiro: apuracao.impactoFinanceiro,
      acertou: entrada.acertarSaldo ?? false,
    },
    severidade: apuracao.dentroDaTolerancia ? 'INFO' : 'CRITICO',
  });

  if (!apuracao.dentroDaTolerancia) {
    await notificarPorPermissao('veiculo:gerenciar', {
      titulo: `Divergencia no tanque ${tanque.codigo}`,
      corpo:
        `${apuracao.mensagem}\n` +
        `Impacto financeiro: R$ ${emPtBr(apuracao.impactoFinanceiro)}.\n` +
        `Motivo informado: ${entrada.motivo?.trim() ?? 'nao informado'}`,
      entidade: 'tanques',
      entidadeId: tanqueId,
    });
  }

  return { afericao, apuracao };
}

// ---------------------------------------------------------------- consultas

/** Painel dos tanques da unidade: saldo, cobertura e o que exige atencao. */
export async function painelDeTanques(unidades: string[] = []) {
  const tanques = await prisma.tanque.findMany({
    where: {
      deletedAt: null,
      ativo: true,
      ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}),
    },
    include: {
      produto: { select: { nome: true, tipo: true } },
      unidade: { select: { codigo: true } },
      veiculo: { select: { placa: true } },
      bicos: { where: { ativo: true } },
      _count: { select: { movimentacoes: true } },
    },
    orderBy: { codigo: 'asc' },
  });

  const itens = tanques.map((t) => {
    const saldo = dinheiro(t.saldoLitros.toString());
    const capacidade = dinheiro(t.capacidadeLitros.toString());
    const ocupacao = capacidade.greaterThan(0) ? Number(saldo.dividedBy(capacidade).toDecimalPlaces(4)) : null;

    return {
      id: t.id,
      codigo: t.codigo,
      nome: t.nome,
      tipo: t.tipo,
      unidade: t.unidade.codigo,
      produto: t.produto.nome,
      veiculo: t.veiculo?.placa ?? null,
      saldoLitros: t.saldoLitros.toString(),
      capacidadeLitros: t.capacidadeLitros.toString(),
      ocupacao,
      custoMedio: t.custoMedio.toString(),
      valorEmEstoque: valorNoTanque({
        saldoLitros: saldo,
        custoMedio: dinheiro(t.custoMedio.toString()),
      }).toFixed(2),
      bicos: t.bicos.length,
      movimentacoes: t._count.movimentacoes,
      ultimaAfericaoEm: t.ultimaAfericaoEm,
      // abaixo de 20% da capacidade e hora de comprar, nao de descobrir na hora de abastecer
      alertaReposicao: ocupacao !== null && ocupacao < 0.2,
    };
  });

  return {
    itens,
    resumo: {
      tanques: itens.length,
      litros: itens.reduce((s, t) => s + Number(t.saldoLitros), 0).toFixed(3),
      valorEmEstoque: itens.reduce((s, t) => s + Number(t.valorEmEstoque), 0).toFixed(2),
      emReposicao: itens.filter((t) => t.alertaReposicao).length,
      semAfericaoRecente: itens.filter(
        (t) => !t.ultimaAfericaoEm || Date.now() - t.ultimaAfericaoEm.getTime() > 30 * 86_400_000,
      ).length,
    },
    memoriaDeCalculo: {
      saldo: 'entradas menos saidas registradas; cada abastecimento baixa o tanque',
      valor: 'saldo x custo medio ponderado movel do tanque',
      alertaReposicao: 'saldo abaixo de 20% da capacidade',
      afericao: 'tanque sem medicao fisica ha mais de 30 dias entra na contagem',
    },
  };
}

/** Extrato do tanque: cada litro que entrou e saiu, na ordem. */
export async function extratoDoTanque(ator: Ator, tanqueId: string, limite = 100) {
  const tanque = await tanqueNoEscopo(ator, tanqueId);

  const [movimentacoes, afericoes] = await Promise.all([
    prisma.movimentacaoTanque.findMany({
      where: { tanqueId },
      include: {
        fornecedor: { select: { razaoSocial: true } },
        tanqueDestino: { select: { codigo: true } },
      },
      orderBy: { data: 'desc' },
      take: limite,
    }),
    prisma.afericaoTanque.findMany({ where: { tanqueId }, orderBy: { data: 'desc' }, take: 20 }),
  ]);

  return {
    tanque: {
      id: tanque.id,
      codigo: tanque.codigo,
      nome: tanque.nome,
      produto: tanque.produto.nome,
      saldoLitros: tanque.saldoLitros.toString(),
      capacidadeLitros: tanque.capacidadeLitros.toString(),
      custoMedio: tanque.custoMedio.toString(),
    },
    movimentacoes,
    afericoes,
  };
}

// ---------------------------------------------------------------- abastecimento no tanque

export interface AbastecimentoInterno {
  tanqueId: string;
  bicoId?: string | null;
  encerranteInicial?: string | null;
  encerranteFinal?: string | null;
  litros: string;
}

/**
 * Confere o encerrante do bico e devolve o custo do litro pelo custo medio do
 * tanque - quem grava o abastecimento e o servico da F5, que ja sabe apurar
 * consumo e anomalia. Aqui so entra a parte de estoque.
 */
export async function prepararAbastecimentoInterno(ator: Ator, entrada: AbastecimentoInterno) {
  const tanque = await tanqueNoEscopo(ator, entrada.tanqueId);
  const litros = dinheiro(entrada.litros);

  if (litros.greaterThan(dinheiro(tanque.saldoLitros.toString()))) {
    throw new ConflictError(
      `Saldo insuficiente no tanque ${tanque.codigo}: disponivel ${emPtBr(tanque.saldoLitros.toString(), 3)} L, ` +
        `solicitado ${emPtBr(litros, 3)} L.`,
    );
  }

  let conferencia = null;
  if (entrada.bicoId && entrada.encerranteFinal != null) {
    const bico = await prisma.bico.findFirst({ where: { id: entrada.bicoId, tanqueId: entrada.tanqueId } });
    if (!bico) throw new ValidationError('Este bico nao pertence ao tanque informado.');

    const inicial = entrada.encerranteInicial ?? bico.encerranteAtual.toString();
    try {
      conferencia = conferirEncerrante(inicial, entrada.encerranteFinal, entrada.litros);
    } catch (erro) {
      throw new ValidationError(erro instanceof Error ? erro.message : 'Leitura de encerrante invalida.');
    }
  }

  return {
    tanque,
    custoUnitario: tanque.custoMedio.toString(),
    valorTotal: paraBanco(litros.times(dinheiro(tanque.custoMedio.toString()))),
    conferencia,
  };
}

/** Avanca o encerrante do bico apos o abastecimento registrado. */
export async function registrarEncerrante(
  bicoId: string,
  encerranteFinal: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const cliente = tx ?? prisma;
  // o contador so avanca: leitura menor que a atual e ignorada, nunca rebaixa
  await cliente.bico.updateMany({
    where: { id: bicoId, encerranteAtual: { lt: encerranteFinal } },
    data: { encerranteAtual: encerranteFinal },
  });
}

/** Regra de ouro 2: tanque nao se exclui - inativa-se com motivo, e so vazio. */
export async function inativarTanque(ator: Ator, tanqueId: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo da inativacao do tanque.');

  const tanque = await tanqueNoEscopo(ator, tanqueId);

  if (dinheiro(tanque.saldoLitros.toString()).greaterThan(0)) {
    throw new ConflictError(
      `O tanque ainda tem ${emPtBr(tanque.saldoLitros.toString(), 3)} L. Transfira ou registre a saida antes de inativar.`,
    );
  }

  const inativado = await db.tanque.update({
    where: { id: tanqueId },
    data: {
      ativo: false,
      inativadoEm: new Date(),
      inativadoPor: ator.usuarioId,
      motivoInativacao: texto,
      updatedBy: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'tanques',
    entidadeId: tanqueId,
    acao: 'INATIVAR',
    valorNovo: { codigo: tanque.codigo, motivo: texto },
    severidade: 'ALERTA',
  });

  return inativado;
}
