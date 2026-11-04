import type { Prisma } from '@prisma/client';
import { db, novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { notificarPorPermissao } from '../../core/notifications/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { Decimal, dinheiro, paraBanco } from '../../core/money.js';
import type { Ator } from '../compras/service.js';
import { proximoNumero } from '../compras/numeracao.js';
import { movimentar } from '../almoxarifado/service.js';
import {
  apurarCustoOs,
  avaliarPlano,
  consolidarManutencao,
  disponibilidade,
  tempoParadoHoras,
  type AvaliacaoPlano,
} from './manutencao.js';
import { descricaoDaOsDeRetorno, validarConclusao, type TipoConclusao } from './conclusao-os.js';

const requisicaoDe = (ator: Ator) => ({ ip: ator.ip ?? null, userAgent: ator.userAgent ?? null });

// ---------------------------------------------------------------- planos preventivos

export interface NovoPlano {
  veiculoId: string;
  descricao: string;
  gatilhoTipo: 'KM' | 'HORAS' | 'DIAS';
  gatilhoValor: string;
  antecedencia: string;
  ultimoValor?: string | null;
  ultimoEm?: Date | null;
}

export async function criarPlano(ator: Ator, entrada: NovoPlano) {
  if (dinheiro(entrada.gatilhoValor).lessThanOrEqualTo(0)) {
    throw new ValidationError('O intervalo do plano precisa ser maior que zero.');
  }

  const veiculo = await prisma.veiculo.findFirst({ where: { id: entrada.veiculoId, deletedAt: null } });
  if (!veiculo) throw new NotFoundError('Veiculo');

  const plano = await prisma.planoManutencao.create({
    data: {
      id: novoId(),
      veiculoId: entrada.veiculoId,
      descricao: entrada.descricao.trim(),
      gatilhoTipo: entrada.gatilhoTipo,
      gatilhoValor: entrada.gatilhoValor,
      antecedencia: entrada.antecedencia,
      ultimoValor: entrada.ultimoValor ?? null,
      ultimoEm: entrada.ultimoEm ?? null,
      createdBy: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'planos_manutencao',
    entidadeId: plano.id,
    acao: 'CRIAR',
    valorNovo: { veiculo: veiculo.placa, descricao: plano.descricao, gatilho: `${entrada.gatilhoTipo} ${entrada.gatilhoValor}` },
  });

  return plano;
}

export interface PlanoNoPainel extends AvaliacaoPlano {
  planoId: string;
  veiculoId: string;
  placa: string;
  frotaNumero: string;
  unidadeId: string;
}

/**
 * Painel de preventivas (secao 7.5): o que vence, quando e em qual veiculo.
 * Ordenado por urgencia - o vencido vem primeiro, porque ja virou risco.
 */
export async function painelDePlanos(unidades: string[] = [], agora = new Date()) {
  const planos = await prisma.planoManutencao.findMany({
    where: {
      deletedAt: null,
      ativo: true,
      veiculo: {
        deletedAt: null,
        status: { not: 'VENDIDO' },
        ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}),
      },
    },
    include: {
      veiculo: { select: { id: true, placa: true, frotaNumero: true, unidadeId: true, hodometroAtual: true, horimetroAtual: true } },
    },
  });

  const ordem = { VENCIDO: 0, EM_ALERTA: 1, EM_DIA: 2 } as const;

  const avaliados: PlanoNoPainel[] = planos
    .map((p) => ({
      ...avaliarPlano(
        {
          descricao: p.descricao,
          gatilhoTipo: p.gatilhoTipo,
          gatilhoValor: p.gatilhoValor.toString(),
          antecedencia: p.antecedencia.toString(),
          ultimoValor: p.ultimoValor?.toString() ?? null,
          ultimoEm: p.ultimoEm,
        },
        {
          hodometro: p.veiculo.hodometroAtual.toString(),
          horimetro: p.veiculo.horimetroAtual?.toString() ?? null,
        },
        agora,
      ),
      planoId: p.id,
      veiculoId: p.veiculo.id,
      placa: p.veiculo.placa,
      frotaNumero: p.veiculo.frotaNumero,
      unidadeId: p.veiculo.unidadeId,
    }))
    .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || a.faltam - b.faltam);

  return {
    planos: avaliados,
    resumo: {
      vencidos: avaliados.filter((p) => p.situacao === 'VENCIDO').length,
      emAlerta: avaliados.filter((p) => p.situacao === 'EM_ALERTA').length,
      emDia: avaliados.filter((p) => p.situacao === 'EM_DIA').length,
    },
  };
}

// ---------------------------------------------------------------- ordem de servico

export interface NovaOrdemServico {
  veiculoId: string;
  tipo: 'PREVENTIVA' | 'CORRETIVA';
  origem?: 'PLANO' | 'CHECKLIST' | 'MOTORISTA' | 'ANOMALIA_ABASTECIMENTO' | 'INSPECAO_PNEU' | 'MANUAL';
  origemId?: string | null;
  planoId?: string | null;
  descricao: string;
  oficina?: string | null;
  terceiro?: boolean;
  hodometro?: string | null;
  horimetro?: string | null;
}

/** A OS herda a unidade do veiculo: custo de frota e sempre da unidade que opera o ativo. */
export async function abrirOrdemServico(ator: Ator, entrada: NovaOrdemServico, tx?: Prisma.TransactionClient) {
  const cliente = tx ?? prisma;

  const veiculo = await cliente.veiculo.findFirst({
    where: { id: entrada.veiculoId, deletedAt: null },
    select: { id: true, placa: true, unidadeId: true },
  });
  if (!veiculo) throw new NotFoundError('Veiculo');

  const criar = async (t: Prisma.TransactionClient) => {
    const numero = await proximoNumero(t, 'OS');
    return t.ordemServico.create({
      data: {
        id: novoId(),
        numero,
        unidadeId: veiculo.unidadeId,
        veiculoId: veiculo.id,
        tipo: entrada.tipo,
        origem: entrada.origem ?? 'MANUAL',
        origemId: entrada.origemId ?? null,
        planoId: entrada.planoId ?? null,
        descricao: entrada.descricao.trim(),
        oficina: entrada.oficina ?? null,
        terceiro: entrada.terceiro ?? false,
        hodometro: entrada.hodometro ?? null,
        horimetro: entrada.horimetro ?? null,
        status: 'ABERTA',
        createdBy: ator.usuarioId,
      },
    });
  };

  const os = tx ? await criar(tx) : await prisma.$transaction(criar);

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'ordens_servico',
    entidadeId: os.id,
    acao: 'ABRIR',
    valorNovo: { numero: os.numero, veiculo: veiculo.placa, tipo: os.tipo, origem: os.origem },
  });

  return os;
}

export interface ItemDaOs {
  descricao: string;
  itemId?: string | null;
  quantidade: string;
  custoUnitario?: string | null;
  maoDeObra?: boolean;
  /** de qual almoxarifado a peca sai; obrigatorio quando o item vem do catalogo */
  almoxarifadoId?: string | null;
}

/**
 * Adiciona item a OS. Peca do catalogo sai do estoque na hora, por requisicao
 * vinculada ao veiculo e a OS (secao 8.2) - nao existe consumo sem rastro de ativo.
 * O custo da peca e o custo medio do estoque, nao um valor digitado.
 */
export async function adicionarItem(ator: Ator, osId: string, entrada: ItemDaOs) {
  const quantidade = dinheiro(entrada.quantidade);
  if (quantidade.lessThanOrEqualTo(0)) throw new ValidationError('A quantidade precisa ser maior que zero.');

  const os = await prisma.ordemServico.findFirst({ where: { id: osId, deletedAt: null } });
  if (!os) throw new NotFoundError('Ordem de servico');
  if (os.status === 'CONCLUIDA' || os.status === 'CANCELADA') {
    throw new ConflictError('OS encerrada nao aceita novos itens. Abra outra OS.');
  }

  if (entrada.itemId && !entrada.almoxarifadoId) {
    throw new ValidationError('Informe o almoxarifado de onde a peca sai.');
  }

  const resultado = await prisma.$transaction(async (tx) => {
    let movimentacaoId: string | null = null;
    let custoUnitario = dinheiro(entrada.custoUnitario ?? '0');

    if (entrada.itemId) {
      const movimentacao = await movimentar(
        ator,
        {
          almoxarifadoId: entrada.almoxarifadoId!,
          itemId: entrada.itemId,
          tipo: 'SAIDA_REQUISICAO',
          quantidade: entrada.quantidade,
          documentoTipo: 'ordens_servico',
          documentoId: osId,
          veiculoId: os.veiculoId,
          osId,
          motivo: `Requisicao para a OS ${os.numero}`,
        },
        tx,
      );
      movimentacaoId = movimentacao.id;
      // o custo da peca e o do estoque - custo medio ponderado movel (secao 8.1)
      custoUnitario = dinheiro(movimentacao.custoUnitario.toString());
    }

    const item = await tx.ordemServicoItem.create({
      data: {
        id: novoId(),
        osId,
        descricao: entrada.descricao.trim(),
        itemId: entrada.itemId ?? null,
        quantidade: quantidade.toFixed(4),
        custoUnitario: custoUnitario.toFixed(4),
        custo: paraBanco(quantidade.times(custoUnitario)),
        maoDeObra: entrada.maoDeObra ?? false,
        movimentacaoId,
      },
    });

    const custos = await recalcularCustos(tx, osId);
    return { item, custos };
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'ordens_servico',
    entidadeId: osId,
    acao: 'ADICIONAR_ITEM',
    valorNovo: {
      descricao: resultado.item.descricao,
      quantidade: resultado.item.quantidade.toString(),
      custo: resultado.item.custo.toString(),
      movimentacaoId: resultado.item.movimentacaoId,
    },
  });

  return resultado;
}

async function recalcularCustos(tx: Prisma.TransactionClient, osId: string) {
  const itens = await tx.ordemServicoItem.findMany({ where: { osId } });

  const custos = apurarCustoOs(
    itens.map((i) => ({
      quantidade: i.quantidade.toString(),
      custoUnitario: i.custoUnitario.toString(),
      maoDeObra: i.maoDeObra,
    })),
  );

  await tx.ordemServico.update({
    where: { id: osId },
    data: {
      custoPecas: custos.custoPecas.toFixed(2),
      custoMaoObra: custos.custoMaoObra.toFixed(2),
      custoTotal: custos.custoTotal.toFixed(2),
    },
  });

  return custos;
}

export async function iniciarExecucao(ator: Ator, osId: string) {
  const os = await prisma.ordemServico.findFirst({ where: { id: osId, deletedAt: null } });
  if (!os) throw new NotFoundError('Ordem de servico');
  if (os.status !== 'ABERTA' && os.status !== 'AGUARDANDO_PECA') {
    throw new ConflictError(`OS em ${os.status} nao pode iniciar execucao.`);
  }

  const atualizada = await db.ordemServico.update({
    where: { id: osId },
    data: { status: 'EM_EXECUCAO', iniciadaEm: os.iniciadaEm ?? new Date(), updatedBy: ator.usuarioId },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'ordens_servico',
    entidadeId: osId,
    acao: 'INICIAR',
    valorAnterior: { status: os.status },
    valorNovo: { status: 'EM_EXECUCAO' },
  });

  return atualizada;
}

/**
 * Conclui a OS: fecha custos, apura o tempo de veiculo parado e, quando a OS
 * veio de um plano preventivo, avanca o marcador do plano - senao o alerta
 * continuaria vencido para sempre.
 */
export interface ConclusaoDeOs {
  fechadaEm?: Date;
  hodometro?: string | null;
  horimetro?: string | null;
  /** como o servico terminou de fato; a parcial deixa trabalho para tras */
  tipo?: TipoConclusao;
  /** o que o mecanico anotou na folha impressa */
  anotacoes?: string | null;
  mecanico?: string | null;
  pendencia?: string | null;
  /** na parcial, abre a OS que carrega a pendencia; ligado por padrao */
  abrirOsDeRetorno?: boolean;
}

/**
 * Fecha a OS com o relato de quem executou (secao 7.5).
 *
 * A folha impressa volta da bancada com anotacoes: o que foi feito, o que faltou, quem
 * fez. E isso que entra aqui. Conclusao parcial exige dizer o que ficou pendente e, por
 * padrao, abre a OS de retorno que carrega essa pendencia — senao ela vira uma frase num
 * campo que ninguem mais consulta, e o servico reaparece como quebra na estrada.
 */
export async function concluirOrdemServico(ator: Ator, osId: string, entrada: ConclusaoDeOs = {}) {
  const os = await prisma.ordemServico.findFirst({
    where: { id: osId, deletedAt: null },
    include: { plano: true, _count: { select: { itens: true } } },
  });
  if (!os) throw new NotFoundError('Ordem de servico');
  if (os.status === 'CONCLUIDA') throw new ConflictError('Esta OS ja esta concluida.');
  if (os.status === 'CANCELADA') throw new ConflictError('OS cancelada nao pode ser concluida.');

  const fechadaEm = entrada.fechadaEm ?? new Date();
  const tipo = entrada.tipo ?? 'TOTAL';
  const pendencia = entrada.pendencia?.trim() || null;

  const problemas = validarConclusao({
    tipo,
    anotacoes: entrada.anotacoes ?? null,
    mecanico: entrada.mecanico ?? null,
    pendencia,
    abertaEm: os.abertaEm,
    fechadaEm,
    quantidadeDeItens: os._count.itens,
  });
  if (problemas.length > 0) throw new ValidationError(problemas.map((p) => p.mensagem).join(' '));

  const parado = tempoParadoHoras(os.abertaEm, fechadaEm);

  const concluida = await prisma.$transaction(async (tx) => {
    const custos = await recalcularCustos(tx, osId);

    // a pendencia vira OS propria, aberta antes de fechar esta, para o vinculo nascer pronto
    const retorno =
      tipo === 'PARCIAL' && pendencia && (entrada.abrirOsDeRetorno ?? true)
        ? await tx.ordemServico.create({
            data: {
              id: novoId(),
              numero: await proximoNumero(tx, 'OS'),
              unidadeId: os.unidadeId,
              veiculoId: os.veiculoId,
              tipo: os.tipo,
              origem: 'OS_PARCIAL',
              origemId: os.id,
              descricao: descricaoDaOsDeRetorno(os.numero, pendencia),
              oficina: os.oficina,
              terceiro: os.terceiro,
              status: 'ABERTA',
              createdBy: ator.usuarioId,
            },
          })
        : null;

    const atualizada = await tx.ordemServico.update({
      where: { id: osId },
      data: {
        status: 'CONCLUIDA',
        fechadaEm,
        tempoParadoHoras: parado.toFixed(2),
        hodometro: entrada.hodometro ?? os.hodometro,
        horimetro: entrada.horimetro ?? os.horimetro,
        conclusaoTipo: tipo,
        anotacoesMecanico: entrada.anotacoes?.trim() || null,
        mecanico: entrada.mecanico?.trim() ?? null,
        pendencia,
        osRetornoId: retorno?.id ?? null,
        updatedBy: ator.usuarioId,
      },
    });

    if (os.plano) {
      const marcador =
        os.plano.gatilhoTipo === 'KM'
          ? (entrada.hodometro ?? os.hodometro?.toString() ?? null)
          : os.plano.gatilhoTipo === 'HORAS'
            ? (entrada.horimetro ?? os.horimetro?.toString() ?? null)
            : null;

      await tx.planoManutencao.update({
        where: { id: os.plano.id },
        data: {
          ultimoEm: fechadaEm,
          ...(marcador != null ? { ultimoValor: marcador } : {}),
          updatedBy: ator.usuarioId,
        },
      });
    }

    // veiculo volta a operar; hodometro so avanca, nunca retrocede
    await tx.veiculo.updateMany({
      where: { id: os.veiculoId, status: 'MANUTENCAO' },
      data: { status: 'ATIVO' },
    });
    if (entrada.hodometro != null) {
      await tx.veiculo.updateMany({
        where: { id: os.veiculoId, hodometroAtual: { lt: entrada.hodometro } },
        data: { hodometroAtual: entrada.hodometro },
      });
    }

    return { os: atualizada, custos, retorno };
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'ordens_servico',
    entidadeId: osId,
    acao: `CONCLUIR:${tipo}`,
    valorAnterior: { status: os.status },
    valorNovo: {
      status: 'CONCLUIDA',
      conclusao: tipo,
      mecanico: entrada.mecanico?.trim() ?? null,
      pendencia,
      osDeRetorno: concluida.retorno?.numero ?? null,
      custoTotal: concluida.custos.custoTotal.toFixed(2),
      tempoParadoHoras: parado.toFixed(2),
    },
  });

  return concluida;
}

/** Regra de ouro 2: OS nao se exclui - cancela-se com motivo. As pecas ja baixadas exigem estorno proprio. */
export async function cancelarOrdemServico(ator: Ator, osId: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo do cancelamento para prosseguir.');

  const os = await prisma.ordemServico.findFirst({
    where: { id: osId, deletedAt: null },
    include: { itens: { where: { movimentacaoId: { not: null } } } },
  });
  if (!os) throw new NotFoundError('Ordem de servico');
  if (os.status === 'CONCLUIDA') throw new ConflictError('OS concluida nao pode ser cancelada.');
  if (os.itens.length > 0) {
    throw new ConflictError(
      'Esta OS ja consumiu peca do estoque. Estorne as movimentacoes antes de cancelar, para o saldo nao ficar errado.',
    );
  }

  const cancelada = await db.ordemServico.update({
    where: { id: osId },
    data: { status: 'CANCELADA', motivoCancelamento: texto, updatedBy: ator.usuarioId },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'ordens_servico',
    entidadeId: osId,
    acao: 'CANCELAR',
    valorAnterior: { status: os.status },
    valorNovo: { status: 'CANCELADA', motivo: texto },
    severidade: 'ALERTA',
  });

  return cancelada;
}

/**
 * Abre OS corretiva a partir de um evento do sistema - checklist reprovado,
 * anomalia de abastecimento ou inspecao de pneu (secao 3, fluxos de integracao).
 */
export async function abrirCorretivaPorEvento(
  ator: Ator,
  entrada: {
    veiculoId: string;
    origem: 'CHECKLIST' | 'MOTORISTA' | 'ANOMALIA_ABASTECIMENTO' | 'INSPECAO_PNEU';
    origemId: string;
    descricao: string;
  },
) {
  const os = await abrirOrdemServico(ator, {
    veiculoId: entrada.veiculoId,
    tipo: 'CORRETIVA',
    origem: entrada.origem,
    origemId: entrada.origemId,
    descricao: entrada.descricao,
  });

  await notificarPorPermissao('os:gerenciar', {
    titulo: `OS ${os.numero} aberta automaticamente`,
    corpo: `Origem: ${entrada.origem}. ${entrada.descricao}`,
    entidade: 'ordens_servico',
    entidadeId: os.id,
  });

  return os;
}

// ---------------------------------------------------------------- indicadores

/** Custo de manutencao, indice de preventiva, MTTR e disponibilidade (secoes 7.8 e 10.2). */
export async function indicadoresDeManutencao(
  unidades: string[] = [],
  periodo: { de: Date; ate: Date },
) {
  const ordens = await prisma.ordemServico.findMany({
    where: {
      deletedAt: null,
      status: { not: 'CANCELADA' },
      abertaEm: { gte: periodo.de, lte: periodo.ate },
      ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}),
    },
    select: { tipo: true, custoTotal: true, tempoParadoHoras: true, veiculoId: true },
  });

  const consolidado = consolidarManutencao(
    ordens.map((o) => ({
      tipo: o.tipo,
      custoTotal: o.custoTotal.toString(),
      tempoParadoHoras: o.tempoParadoHoras?.toString() ?? null,
    })),
  );

  const dias = Math.max(Math.ceil((periodo.ate.getTime() - periodo.de.getTime()) / 86_400_000), 1);

  // disponibilidade por veiculo, para nao diluir uma carreta parada 10 dias na media da frota
  const porVeiculo = new Map<string, Decimal>();
  for (const o of ordens) {
    if (o.tempoParadoHoras == null) continue;
    const atual = porVeiculo.get(o.veiculoId) ?? new Decimal(0);
    porVeiculo.set(o.veiculoId, atual.plus(dinheiro(o.tempoParadoHoras.toString())));
  }

  const veiculosDaBase = await prisma.veiculo.count({
    where: {
      deletedAt: null,
      status: { not: 'VENDIDO' },
      ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}),
    },
  });

  const disponibilidades = [...porVeiculo.values()].map((horas) => disponibilidade(dias, horas));
  const veiculosSemParada = Math.max(veiculosDaBase - disponibilidades.length, 0);
  const somaDisponibilidade = disponibilidades.reduce((a, b) => a + b, 0) + veiculosSemParada;

  return {
    ...consolidado,
    periodo: { de: periodo.de, ate: periodo.ate, dias },
    veiculos: veiculosDaBase,
    disponibilidadeMedia: veiculosDaBase > 0 ? Number((somaDisponibilidade / veiculosDaBase).toFixed(4)) : null,
    memoriaDeCalculo: {
      formulaDisponibilidade: 'dias operacionais / dias do periodo, por veiculo, com dia parado arredondado para cima',
      formulaIndicePreventiva: 'custo preventiva / custo total',
      formulaMttr: 'soma das horas paradas / OS com tempo medido',
      ordensConsideradas: ordens.length,
    },
  };
}
