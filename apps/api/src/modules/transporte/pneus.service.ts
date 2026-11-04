import type { Prisma, StatusPneu as StatusPneuPrisma, TipoMovimentacaoPneu as TipoMovPrisma } from '@prisma/client';
import { db, novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { notificarPorPermissao } from '../../core/notifications/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { Decimal, dinheiro, paraBanco } from '../../core/money.js';
import type { Ator } from '../compras/service.js';
import {
  EXIGEM_POSICAO,
  FAIXAS_SULCO_PADRAO,
  avaliarPneu,
  calcularCpk,
  consolidarCpk,
  estadoDoSulco,
  kmDoPeriodo,
  proximoStatus,
  transicoesValidasDoPneu,
  type FaixasSulco,
} from './pneus.js';

const requisicaoDe = (ator: Ator) => ({ ip: ator.ip ?? null, userAgent: ator.userAgent ?? null });

/** Faixas de sulco e km de rodizio vem de parametro, sem deploy (secao 5.5). */
export async function parametrosDePneu(): Promise<{ faixas: FaixasSulco; kmParaRodizio: number }> {
  const [sulco, rodizio] = await Promise.all([
    prisma.parametro.findUnique({ where: { chave: 'frota.sulco_alerta_mm' } }),
    prisma.parametro.findUnique({ where: { chave: 'frota.km_rodizio_pneu' } }),
  ]);

  const valor = (sulco?.valor ?? {}) as { verde?: number; amarelo?: number; legal?: number };

  return {
    faixas: {
      verde: valor.verde ?? FAIXAS_SULCO_PADRAO.verde,
      amarelo: valor.amarelo ?? FAIXAS_SULCO_PADRAO.amarelo,
      legalMm: valor.legal ?? FAIXAS_SULCO_PADRAO.legalMm,
    },
    kmParaRodizio: Number(rodizio?.valor ?? 20_000),
  };
}

// ---------------------------------------------------------------- cadastro

export interface NovoPneu {
  unidadeId: string;
  numeroFogo: string;
  serie?: string | null;
  marca: string;
  modelo: string;
  medida: string;
  dot?: string | null;
  tipo: 'NOVO' | 'RECAPADO';
  custoAquisicao: string;
  sulcoInicialMm?: string | null;
  vidaUtilKm?: string | null;
}

export async function cadastrarPneu(ator: Ator, entrada: NovoPneu) {
  if (dinheiro(entrada.custoAquisicao).lessThanOrEqualTo(0)) {
    throw new ValidationError('Informe o custo de aquisicao do pneu.');
  }

  const pneu = await prisma.pneu.create({
    data: {
      id: novoId(),
      unidadeId: entrada.unidadeId,
      numeroFogo: entrada.numeroFogo.trim().toUpperCase(),
      serie: entrada.serie ?? null,
      marca: entrada.marca.trim(),
      modelo: entrada.modelo.trim(),
      medida: entrada.medida.trim(),
      dot: entrada.dot ?? null,
      tipo: entrada.tipo,
      custoAquisicao: paraBanco(entrada.custoAquisicao),
      // o custo acumulado ja nasce com a aquisicao: e a base do CPK
      custoAcumulado: paraBanco(entrada.custoAquisicao),
      sulcoInicialMm: entrada.sulcoInicialMm ?? null,
      sulcoAtualMm: entrada.sulcoInicialMm ?? null,
      vidaUtilKm: entrada.vidaUtilKm ?? null,
      status: 'EM_ESTOQUE',
      createdBy: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'pneus',
    entidadeId: pneu.id,
    acao: 'CADASTRAR',
    valorNovo: { numeroFogo: pneu.numeroFogo, marca: pneu.marca, modelo: pneu.modelo, custo: pneu.custoAcumulado.toString() },
  });

  return pneu;
}

// ---------------------------------------------------------------- ciclo de vida

export interface MovimentacaoDePneu {
  tipo: TipoMovPrisma;
  veiculoId?: string | null;
  posicaoId?: string | null;
  data?: Date;
  hodometro?: string | null;
  sulcoMm?: string | null;
  custo?: string | null;
  motivo?: string | null;
}

/**
 * Unico caminho para mudar o estado de um pneu (secao 7.4).
 *
 * Cada movimentacao fecha o periodo anterior: apura o km rodado desde a instalacao,
 * soma ao acumulado do pneu e recalcula o CPK. Sem isso, o CPK vira chute.
 */
export async function movimentarPneu(ator: Ator, pneuId: string, entrada: MovimentacaoDePneu) {
  const data = entrada.data ?? new Date();
  const custo = dinheiro(entrada.custo ?? '0');
  if (custo.isNegative()) throw new ValidationError('O custo da movimentacao nao pode ser negativo.');

  const resultado = await prisma.$transaction(async (tx) => {
    const pneu = await tx.pneu.findFirst({ where: { id: pneuId, deletedAt: null } });
    if (!pneu) throw new NotFoundError('Pneu');

    let status: StatusPneuPrisma;
    try {
      status = proximoStatus(pneu.status, entrada.tipo) as StatusPneuPrisma;
    } catch (erro) {
      throw new ConflictError(
        erro instanceof Error
          ? `${erro.message} Movimentacoes possiveis: ${transicoesValidasDoPneu(pneu.status).join(', ') || 'nenhuma'}.`
          : 'Movimentacao invalida.',
      );
    }

    // ------------------------------------------------ destino
    let veiculoId: string | null = pneu.veiculoId;
    let posicaoId: string | null = pneu.posicaoId;
    let hodometroInstalacao: Prisma.Decimal | null = pneu.hodometroInstalacao;

    if (EXIGEM_POSICAO.has(entrada.tipo)) {
      if (!entrada.veiculoId || !entrada.posicaoId) {
        throw new ValidationError('Informe o veiculo e a posicao do mapa de rodagem.');
      }
      if (entrada.hodometro == null) {
        throw new ValidationError('Informe o hodometro do veiculo na instalacao.');
      }

      const posicao = await tx.posicaoPneu.findFirst({
        where: { id: entrada.posicaoId, veiculoId: entrada.veiculoId },
      });
      if (!posicao) throw new ValidationError('Esta posicao nao pertence ao veiculo informado.');

      const ocupante = await tx.pneu.findFirst({
        where: { posicaoId: entrada.posicaoId, status: 'EM_USO', deletedAt: null, id: { not: pneuId } },
        select: { numeroFogo: true },
      });
      if (ocupante) {
        throw new ConflictError(`A posicao ja esta ocupada pelo pneu ${ocupante.numeroFogo}. Remova-o antes.`);
      }

      veiculoId = entrada.veiculoId;
      posicaoId = entrada.posicaoId;
    } else if (status !== 'EM_USO') {
      veiculoId = null;
      posicaoId = null;
    }

    // ------------------------------------------------ km do periodo encerrado
    let kmRodados: Decimal | null = null;
    let kmAcumulado = dinheiro(pneu.kmAcumulado.toString());

    const saiuDaPosicao = pneu.status === 'EM_USO' && pneu.hodometroInstalacao != null && entrada.hodometro != null;
    if (saiuDaPosicao) {
      try {
        kmRodados = kmDoPeriodo(pneu.hodometroInstalacao!.toString(), entrada.hodometro!);
      } catch (erro) {
        throw new ValidationError(erro instanceof Error ? erro.message : 'Hodometro invalido.');
      }
      kmAcumulado = kmAcumulado.plus(kmRodados);
    }

    hodometroInstalacao = EXIGEM_POSICAO.has(entrada.tipo)
      ? (entrada.hodometro as unknown as Prisma.Decimal)
      : status === 'EM_USO'
        ? pneu.hodometroInstalacao
        : null;

    // ------------------------------------------------ custo, recapagem e sulco
    const custoAcumulado = dinheiro(pneu.custoAcumulado.toString()).plus(custo);
    const recapagens = entrada.tipo === 'RETORNO_RECAPAGEM' ? pneu.recapagens + 1 : pneu.recapagens;
    const tipo = entrada.tipo === 'RETORNO_RECAPAGEM' ? 'RECAPADO' : pneu.tipo;
    const cpk = calcularCpk(custoAcumulado, kmAcumulado);

    const atualizado = await tx.pneu.update({
      where: { id: pneuId },
      data: {
        status,
        veiculoId,
        posicaoId,
        hodometroInstalacao,
        kmAcumulado: kmAcumulado.toFixed(1),
        custoAcumulado: paraBanco(custoAcumulado),
        cpk: cpk ? cpk.toFixed(6) : null,
        recapagens,
        tipo,
        ...(entrada.sulcoMm != null ? { sulcoAtualMm: entrada.sulcoMm } : {}),
        updatedBy: ator.usuarioId,
      },
    });

    const movimentacao = await tx.pneuMovimentacao.create({
      data: {
        id: novoId(),
        pneuId,
        tipo: entrada.tipo,
        veiculoId: entrada.veiculoId ?? pneu.veiculoId,
        posicaoId: entrada.posicaoId ?? pneu.posicaoId,
        data,
        hodometro: entrada.hodometro ?? null,
        kmRodados: kmRodados ? kmRodados.toFixed(1) : null,
        sulcoMm: entrada.sulcoMm ?? null,
        custo: paraBanco(custo),
        motivo: entrada.motivo?.trim() ?? null,
        usuarioId: ator.usuarioId,
      },
    });

    // a leitura do hodometro do pneu tambem atualiza o veiculo, quando for mais recente
    if (entrada.hodometro != null && veiculoId) {
      await tx.veiculo.updateMany({
        where: { id: veiculoId, hodometroAtual: { lt: entrada.hodometro } },
        data: { hodometroAtual: entrada.hodometro },
      });
    }

    return { pneu: atualizado, movimentacao };
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'pneus',
    entidadeId: pneuId,
    acao: entrada.tipo,
    valorNovo: {
      status: resultado.pneu.status,
      veiculoId: resultado.pneu.veiculoId,
      posicaoId: resultado.pneu.posicaoId,
      kmAcumulado: resultado.pneu.kmAcumulado.toString(),
      cpk: resultado.pneu.cpk?.toString() ?? null,
      custo: resultado.movimentacao.custo.toString(),
    },
  });

  return resultado;
}

// ---------------------------------------------------------------- inspecao

export interface NovaInspecao {
  data?: Date;
  sulcoMm: string;
  pressaoPsi?: string | null;
  avaria?: string | null;
  anexoId?: string | null;
}

/**
 * Inspecao com sulco e pressao (secao 7.4). Sulco abaixo do limite legal notifica
 * o gestor de frota na hora - pneu careca e risco, nao pendencia de relatorio.
 */
export async function registrarInspecao(ator: Ator, pneuId: string, entrada: NovaInspecao) {
  const pneu = await prisma.pneu.findFirst({ where: { id: pneuId, deletedAt: null } });
  if (!pneu) throw new NotFoundError('Pneu');

  const { faixas, kmParaRodizio } = await parametrosDePneu();

  const inspecao = await prisma.$transaction(async (tx) => {
    const criada = await tx.pneuInspecao.create({
      data: {
        id: novoId(),
        pneuId,
        data: entrada.data ?? new Date(),
        sulcoMm: entrada.sulcoMm,
        pressaoPsi: entrada.pressaoPsi ?? null,
        avaria: entrada.avaria ?? null,
        anexoId: entrada.anexoId ?? null,
        inspetorId: ator.usuarioId,
      },
    });

    await tx.pneu.update({
      where: { id: pneuId },
      data: { sulcoAtualMm: entrada.sulcoMm, updatedBy: ator.usuarioId },
    });

    return criada;
  });

  const avaliacao = avaliarPneu(
    {
      numeroFogo: pneu.numeroFogo,
      sulcoAtualMm: entrada.sulcoMm,
      kmAcumulado: pneu.kmAcumulado.toString(),
      vidaUtilKm: pneu.vidaUtilKm?.toString() ?? null,
      custoAcumulado: pneu.custoAcumulado.toString(),
    },
    { faixas, kmParaRodizio },
  );

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'pneu_inspecoes',
    entidadeId: inspecao.id,
    acao: 'INSPECIONAR',
    valorAnterior: { sulcoMm: pneu.sulcoAtualMm?.toString() ?? null },
    valorNovo: { sulcoMm: entrada.sulcoMm, alertas: avaliacao.alertas },
    severidade: avaliacao.bloqueiaCirculacao ? 'ALERTA' : 'INFO',
  });

  if (avaliacao.bloqueiaCirculacao) {
    await notificarPorPermissao('pneu:gerenciar', {
      titulo: `Pneu ${pneu.numeroFogo} abaixo do limite legal`,
      corpo:
        `Sulco medido: ${entrada.sulcoMm} mm (limite ${faixas.legalMm} mm).` +
        ` Retire o pneu de circulacao e registre a movimentacao.`,
      entidade: 'pneus',
      entidadeId: pneuId,
    });
  }

  return { inspecao, avaliacao };
}

// ---------------------------------------------------------------- consultas

/** Mapa de rodagem do veiculo: cada posicao com o pneu que a ocupa e o estado do sulco. */
export async function mapaDeRodagem(veiculoId: string) {
  const veiculo = await prisma.veiculo.findFirst({
    where: { id: veiculoId, deletedAt: null },
    include: {
      posicoesPneu: { orderBy: { ordem: 'asc' } },
      unidade: { select: { codigo: true, nome: true } },
    },
  });
  if (!veiculo) throw new NotFoundError('Veiculo');

  const [pneus, { faixas, kmParaRodizio }] = await Promise.all([
    prisma.pneu.findMany({ where: { veiculoId, status: 'EM_USO', deletedAt: null } }),
    parametrosDePneu(),
  ]);

  const porPosicao = new Map(pneus.filter((p) => p.posicaoId).map((p) => [p.posicaoId!, p]));
  const hodometro = dinheiro(veiculo.hodometroAtual.toString());

  const posicoes = veiculo.posicoesPneu.map((posicao) => {
    const pneu = porPosicao.get(posicao.id);
    if (!pneu) {
      return { posicao, pneu: null, avaliacao: null, estado: 'VAZIA' as const };
    }

    const kmNaPosicao = pneu.hodometroInstalacao
      ? hodometro.minus(dinheiro(pneu.hodometroInstalacao.toString())).toFixed(1)
      : null;

    const avaliacao = avaliarPneu(
      {
        numeroFogo: pneu.numeroFogo,
        sulcoAtualMm: pneu.sulcoAtualMm?.toString() ?? null,
        kmAcumulado: pneu.kmAcumulado.toString(),
        vidaUtilKm: pneu.vidaUtilKm?.toString() ?? null,
        custoAcumulado: pneu.custoAcumulado.toString(),
        kmNaPosicao,
      },
      { faixas, kmParaRodizio },
    );

    return {
      posicao,
      pneu: {
        id: pneu.id,
        numeroFogo: pneu.numeroFogo,
        marca: pneu.marca,
        modelo: pneu.modelo,
        medida: pneu.medida,
        tipo: pneu.tipo,
        recapagens: pneu.recapagens,
        sulcoAtualMm: pneu.sulcoAtualMm?.toString() ?? null,
        kmAcumulado: pneu.kmAcumulado.toString(),
        kmNaPosicao,
        cpk: pneu.cpk?.toString() ?? null,
      },
      avaliacao,
      estado: avaliacao.estado,
    };
  });

  return {
    veiculo: {
      id: veiculo.id,
      placa: veiculo.placa,
      frotaNumero: veiculo.frotaNumero,
      configEixos: veiculo.configEixos,
      hodometroAtual: veiculo.hodometroAtual.toString(),
      unidade: veiculo.unidade,
    },
    faixas,
    posicoes,
    resumo: {
      total: posicoes.length,
      ocupadas: posicoes.filter((p) => p.pneu).length,
      criticas: posicoes.filter((p) => p.avaliacao?.bloqueiaCirculacao).length,
      emAtencao: posicoes.filter((p) => p.estado === 'DOURADO').length,
    },
  };
}

/** Contagem para o painel CCO (secao 7.7): pneus em uso com sulco fora do verde. */
export async function contarPneusCriticos(unidades: string[] = []): Promise<number> {
  const { faixas } = await parametrosDePneu();
  const pneus = await prisma.pneu.findMany({
    where: {
      deletedAt: null,
      status: 'EM_USO',
      ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}),
    },
    select: { sulcoAtualMm: true },
  });

  return pneus.filter((p) => estadoDoSulco(p.sulcoAtualMm?.toString() ?? null, faixas) === 'VERMELHO').length;
}

/** CPK por marca e modelo - base para decisao de compra (secao 7.8). */
export async function cpkPorMarca(unidades: string[] = [], por: 'marca' | 'marcaModelo' = 'marcaModelo') {
  const pneus = await prisma.pneu.findMany({
    where: {
      deletedAt: null,
      ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}),
    },
    select: { marca: true, modelo: true, custoAcumulado: true, kmAcumulado: true },
  });

  return consolidarCpk(
    pneus.map((p) => ({
      marca: p.marca,
      modelo: p.modelo,
      custoAcumulado: p.custoAcumulado.toString(),
      kmAcumulado: p.kmAcumulado.toString(),
    })),
    por,
  );
}

export async function historicoDoPneu(pneuId: string) {
  const pneu = await prisma.pneu.findFirst({
    where: { id: pneuId, deletedAt: null },
    include: {
      movimentacoes: { orderBy: { data: 'desc' }, include: { veiculo: { select: { placa: true } } } },
      inspecoes: { orderBy: { data: 'desc' }, take: 20 },
      veiculo: { select: { placa: true, frotaNumero: true } },
      posicao: { select: { codigo: true } },
    },
  });
  if (!pneu) throw new NotFoundError('Pneu');

  const { faixas, kmParaRodizio } = await parametrosDePneu();

  return {
    pneu,
    avaliacao: avaliarPneu(
      {
        numeroFogo: pneu.numeroFogo,
        sulcoAtualMm: pneu.sulcoAtualMm?.toString() ?? null,
        kmAcumulado: pneu.kmAcumulado.toString(),
        vidaUtilKm: pneu.vidaUtilKm?.toString() ?? null,
        custoAcumulado: pneu.custoAcumulado.toString(),
      },
      { faixas, kmParaRodizio },
    ),
    movimentacoesPossiveis: transicoesValidasDoPneu(pneu.status),
  };
}

/** Regra de ouro 2: pneu nao se exclui - inativa-se com motivo e trilha. */
export async function inativarPneu(ator: Ator, pneuId: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo da inativacao para prosseguir.');

  const pneu = await prisma.pneu.findFirst({ where: { id: pneuId, deletedAt: null } });
  if (!pneu) throw new NotFoundError('Pneu');
  if (pneu.status === 'EM_USO') {
    throw new ConflictError('Remova o pneu do veiculo antes de inativa-lo.');
  }

  const inativado = await db.pneu.update({
    where: { id: pneuId },
    data: { inativadoEm: new Date(), inativadoPor: ator.usuarioId, motivoInativacao: texto, updatedBy: ator.usuarioId },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'pneus',
    entidadeId: pneuId,
    acao: 'INATIVAR',
    valorAnterior: { status: pneu.status },
    valorNovo: { motivo: texto },
    severidade: 'ALERTA',
  });

  return inativado;
}
