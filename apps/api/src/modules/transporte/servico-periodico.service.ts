import { db, novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { notificarPorPermissao } from '../../core/notifications/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { dinheiro, paraBanco } from '../../core/money.js';
import type { Ator } from '../compras/service.js';
import {
  INTERVALO_PADRAO,
  ROTULO_TIPO,
  basesPermitidas,
  medicaoDaExecucaoInvalida,
  planoAplicavel,
  posicaoPeriodica,
  type BaseMedicao,
  type PlanoPeriodico,
  type SituacaoPeriodica,
  type TipoServicoPeriodico,
} from './manutencao-periodica.js';
import { registrarLeitura, ritmoDosVeiculos } from './leitura.service.js';
import { dataPrevista, diasAteVencer } from './ritmo-de-uso.js';
import {
  LIMITE_DIAS_PADRAO,
  ORDEM_ITENS,
  PESO_SEVERIDADE,
  piorSeveridade,
  posicaoNaRegua,
  scoreDoAtivo,
  type Severidade,
} from './regua-manutencao.js';
import {
  HORIZONTE_PADRAO_DIAS,
  programacaoDaSemana,
  type Programacao,
} from './programacao-semana.js';

/**
 * Controle de oleo e servicos de rodagem (secao 7.10).
 *
 * Substitui a planilha de cinco abas: a conta e a mesma para todas, o que muda e o
 * intervalo e a unidade de medida — e isso agora e plano cadastrado, nao coluna oculta.
 *
 * O painel nao guarda estado: ele le a ultima execucao de cada ativo e compara com a
 * medicao corrente do cadastro (7.1). Assim a posicao nunca fica desatualizada por falta
 * de alguem "rodar a atualizacao" — que era o que fazia a planilha envelhecer.
 */

const requisicaoDe = (ator: Ator) => ({ ip: ator.ip ?? null, userAgent: ator.userAgent ?? null });

/** Tipos medidos em horas do equipamento de frio; o resto e km do veiculo. */
export const ehDoEquipamento = (tipo: TipoServicoPeriodico): boolean => tipo === 'OLEO_THERMO_KING';

// ------------------------------------------------------------------ planos

/**
 * Cria os planos que a planilha praticava, para a unidade que ainda nao os tem.
 *
 * Idempotente: roda no seed e a cada abertura do painel sem plano. Sem isto o painel
 * abriria vazio na primeira vez, e vazio parece "esta tudo em dia".
 */
export async function garantirPlanosPadrao(unidadeId: string, ator?: Ator) {
  const existentes = await prisma.planoServicoPeriodico.findMany({ where: { unidadeId, deletedAt: null } });
  // por tipo, e nao "tem algum": tipo novo (lubrificacao) precisa nascer em unidade que ja rodava
  const jaTem = new Set(existentes.map((p) => `${p.tipo}|${p.modelo ?? ''}`));

  const tipos = (Object.keys(INTERVALO_PADRAO) as TipoServicoPeriodico[]).filter((t) => !jaTem.has(`${t}|`));
  const comThermoKing = !jaTem.has('OLEO_THERMO_KING|THERMO KING');
  if (tipos.length === 0 && !comThermoKing) return existentes;

  await prisma.planoServicoPeriodico.createMany({
    data: [
      ...tipos.map((tipo) => ({
        id: novoId(),
        unidadeId,
        tipo,
        base: INTERVALO_PADRAO[tipo].base,
        intervalo: String(INTERVALO_PADRAO[tipo].intervalo),
        avisarCom: String(INTERVALO_PADRAO[tipo].avisarCom),
        modelo: null,
        createdBy: ator?.usuarioId ?? null,
      })),
      // o aparelho THERMO KING roda 2.000 h entre trocas; o CARRIER, 1.000 h (plano geral)
      ...(comThermoKing
        ? [
            {
              id: novoId(),
              unidadeId,
              tipo: 'OLEO_THERMO_KING' as TipoServicoPeriodico,
              base: 'HORIMETRO' as BaseMedicao,
              intervalo: '2000',
              avisarCom: '200',
              modelo: 'THERMO KING',
              createdBy: ator?.usuarioId ?? null,
            },
          ]
        : []),
    ],
    skipDuplicates: true,
  });

  return prisma.planoServicoPeriodico.findMany({ where: { unidadeId, deletedAt: null } });
}

export async function listarPlanos(unidades: string[] = []) {
  return prisma.planoServicoPeriodico.findMany({
    where: { deletedAt: null, ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}) },
    orderBy: [{ tipo: 'asc' }, { modelo: 'asc' }],
  });
}

export interface PlanoInformado {
  unidadeId: string;
  tipo: TipoServicoPeriodico;
  modelo?: string | null;
  /** o que conta o vencimento; sem isto, mantem a base atual do plano */
  base?: BaseMedicao | null;
  intervalo: string;
  avisarCom: string;
  observacao?: string | null;
}

/**
 * Cria ou ajusta o plano de um tipo. Alterar o intervalo **nao reescreve o passado**:
 * as execucoes ja registradas guardam o intervalo aplicado na epoca.
 */
export async function salvarPlano(ator: Ator, entrada: PlanoInformado) {
  const intervalo = dinheiro(entrada.intervalo);
  if (intervalo.lessThanOrEqualTo(0)) throw new ValidationError('O intervalo precisa ser maior que zero.');
  if (dinheiro(entrada.avisarCom).isNegative()) throw new ValidationError('A antecedencia do aviso nao pode ser negativa.');
  if (dinheiro(entrada.avisarCom).greaterThan(intervalo)) {
    throw new ValidationError('A antecedencia do aviso nao pode ser maior que o proprio intervalo.');
  }

  const modelo = entrada.modelo?.trim().toUpperCase() || null;
  const existente = await prisma.planoServicoPeriodico.findFirst({
    where: { unidadeId: entrada.unidadeId, tipo: entrada.tipo, modelo, deletedAt: null },
  });

  /*
   * A base e escolha do gestor, e nao do tipo: a lubrificacao nasce em dias, mas a
   * operacao pode passar para quilometragem — ou levar qualquer outro servico para o
   * calendario. So o que nao cabe e barrado: horimetro e do aparelho de frio.
   */
  const base = entrada.base ?? existente?.base ?? INTERVALO_PADRAO[entrada.tipo].base;
  if (!basesPermitidas(entrada.tipo).includes(base)) {
    throw new ValidationError(
      `A base ${base} nao vale para ${ROTULO_TIPO[entrada.tipo]}. Use ${basesPermitidas(entrada.tipo).join(' ou ')}.`,
    );
  }

  const dados = {
    base,
    intervalo: paraBanco(entrada.intervalo),
    avisarCom: paraBanco(entrada.avisarCom),
    observacao: entrada.observacao?.trim() ?? null,
    ativo: true,
  };

  const plano = existente
    ? await db.planoServicoPeriodico.update({ where: { id: existente.id }, data: { ...dados, updatedBy: ator.usuarioId } })
    : await db.planoServicoPeriodico.create({
        data: {
          id: novoId(),
          unidadeId: entrada.unidadeId,
          tipo: entrada.tipo,
          modelo,
          ...dados,
          createdBy: ator.usuarioId,
        },
      });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'planos_servico_periodico',
    entidadeId: plano.id,
    acao: existente ? 'EDITAR' : 'CRIAR',
    valorAnterior: existente
      ? { base: existente.base, intervalo: existente.intervalo.toString(), avisarCom: existente.avisarCom.toString() }
      : undefined,
    valorNovo: { tipo: entrada.tipo, modelo, base, intervalo: entrada.intervalo, avisarCom: entrada.avisarCom },
    severidade: 'ALERTA',
  });

  return plano;
}

// ------------------------------------------------------------------ painel

export interface LinhaDoPainel {
  ativoId: string;
  identificacao: string;
  descricao: string;
  unidadeId: string;
  base: BaseMedicao;
  intervalo: string;
  medicaoDaUltima: string | null;
  executadoEm: string | null;
  medicaoAtual: string | null;
  /** medicao do proximo vencimento; null quando o plano vence por dias */
  proxima: string | null;
  /** data do proximo vencimento; preenchida so no plano por dias */
  proximaEm: string | null;
  aVencer: string;
  vencido: string;
  /** severidade da regua (ADR 0023): cinco faixas, sempre com rotulo textual na tela */
  severidade: Severidade;
  /** fracao do ciclo consumida, 0..1 — enche a barra */
  usado: number;
  /** por que este item esta neste status, quando nao e obvio pelo numero */
  motivo: string | null;
  /** leitura que nao fecha e precisa de olho humano */
  alerta: string | null;
  semHistorico: boolean;
}

/**
 * Painel de um tipo: uma linha por ativo, como a aba da planilha — mas calculada na hora.
 *
 * Vencido primeiro, e dentro do vencido o que passou mais. Quem abre a tela ve o que ja
 * e risco antes do que ainda da tempo.
 */
export async function painel(
  tipo: TipoServicoPeriodico,
  unidades: string[] = [],
  agora = new Date(),
): Promise<{ itens: LinhaDoPainel[]; resumo: Record<Severidade | 'total', number> }> {
  const filtroUnidades = unidades.length > 0 ? { unidadeId: { in: unidades } } : {};
  const planos = await prisma.planoServicoPeriodico.findMany({
    where: { deletedAt: null, ativo: true, tipo, ...filtroUnidades },
  });

  const ativos = ehDoEquipamento(tipo)
    ? (
        await prisma.equipamentoFrio.findMany({
          where: { deletedAt: null, status: 'ATIVO', ...filtroUnidades },
          include: { veiculo: { select: { placa: true } } },
          orderBy: { marca: 'asc' },
        })
      ).map((e) => ({
        id: e.id,
        unidadeId: e.unidadeId,
        identificacao: e.numeroSerie ?? `${e.marca}${e.modelo ? ` ${e.modelo}` : ''}`,
        descricao: [e.marca, e.modelo, e.veiculo ? `no ${e.veiculo.placa}` : null].filter(Boolean).join(' · '),
        modelo: [e.marca, e.modelo].filter(Boolean).join(' '),
        medicaoAtual: e.horimetro?.toString() ?? null,
      }))
    : (
        await prisma.veiculo.findMany({
          where: { deletedAt: null, status: { notIn: ['VENDIDO', 'INATIVO'] }, ...filtroUnidades },
          orderBy: { placa: 'asc' },
        })
      ).map((v) => ({
        id: v.id,
        unidadeId: v.unidadeId,
        identificacao: v.placa,
        descricao: [v.marca, v.modelo].filter(Boolean).join(' ') || v.frotaNumero,
        modelo: [v.marca, v.modelo].filter(Boolean).join(' '),
        medicaoAtual: v.hodometroAtual.toString(),
      }));

  if (ativos.length === 0) return { itens: [], resumo: contarPorSeveridade([]) };

  // ultima execucao de cada ativo, em uma consulta - o painel abre com a frota inteira
  const execucoes = await prisma.servicoPeriodico.findMany({
    where: {
      deletedAt: null,
      tipo,
      ...(ehDoEquipamento(tipo)
        ? { equipamentoFrioId: { in: ativos.map((a) => a.id) } }
        : { veiculoId: { in: ativos.map((a) => a.id) } }),
    },
    orderBy: { executadoEm: 'desc' },
  });

  const ultima = new Map<string, (typeof execucoes)[number]>();
  for (const e of execucoes) {
    const chave = (ehDoEquipamento(tipo) ? e.equipamentoFrioId : e.veiculoId) ?? '';
    if (!ultima.has(chave)) ultima.set(chave, e);
  }

  const itens = ativos.map((ativo) => {
    const execucao = ultima.get(ativo.id) ?? null;
    const plano = planoDoAtivo(planos, tipo, ativo.modelo);
    const naRegua = posicaoNaRegua({
      plano,
      medicaoDaUltima: execucao?.medicao?.toString() ?? null,
      medicaoAtual: ativo.medicaoAtual,
      dataDaUltima: execucao?.executadoEm ?? null,
      limiteDias: limiteDoPlano(planos, tipo, ativo.modelo),
      agora,
    });
    const posicao = naRegua.posicao;

    return {
      ativoId: ativo.id,
      identificacao: ativo.identificacao,
      descricao: ativo.descricao,
      unidadeId: ativo.unidadeId,
      base: plano.base,
      intervalo: dinheiro(plano.intervalo).toFixed(1),
      medicaoDaUltima: execucao?.medicao?.toString() ?? null,
      executadoEm: execucao?.executadoEm.toISOString() ?? null,
      medicaoAtual: ativo.medicaoAtual,
      proxima: posicao.proxima?.toFixed(1) ?? null,
      proximaEm: posicao.proximaEm?.toISOString() ?? null,
      aVencer: posicao.aVencer.toFixed(1),
      vencido: posicao.vencido.toFixed(1),
      severidade: naRegua.severidade,
      usado: naRegua.usado,
      motivo: naRegua.motivo,
      alerta: naRegua.alerta,
      semHistorico: posicao.semHistorico,
    };
  });

  // o pior primeiro, e dentro da faixa o que consumiu mais ciclo
  itens.sort((a, b) => PESO_SEVERIDADE[b.severidade] - PESO_SEVERIDADE[a.severidade] || b.usado - a.usado);

  return { itens, resumo: contarPorSeveridade(itens) };
}

/** O item que vence primeiro entre os que tem previsao; null quando nenhum tem. */
function menorPrevisao(itens: Array<{ venceEmDias: number | null }>): number | null {
  const previstos = itens.map((i) => i.venceEmDias).filter((d): d is number => d !== null);
  return previstos.length === 0 ? null : Math.min(...previstos);
}

/** Contagem por faixa, do jeito que o cartao de resumo da tela precisa. */
function contarPorSeveridade(itens: Array<{ severidade: Severidade }>): Record<Severidade | 'total', number> {
  return {
    VENCIDO: itens.filter((i) => i.severidade === 'VENCIDO').length,
    CRITICO: itens.filter((i) => i.severidade === 'CRITICO').length,
    ATENCAO: itens.filter((i) => i.severidade === 'ATENCAO').length,
    EM_DIA: itens.filter((i) => i.severidade === 'EM_DIA').length,
    SEM_BASE: itens.filter((i) => i.severidade === 'SEM_BASE').length,
    total: itens.length,
  };
}

/** Limite de calendario do plano do ativo; sem parametrizacao, vale o padrao do tipo. */
function limiteDoPlano(
  planos: Array<{ tipo: TipoServicoPeriodico; modelo: string | null; limiteDias?: number | null }>,
  tipo: TipoServicoPeriodico,
  modelo?: string | null,
): number | null {
  const escolhido = planoAplicavel(planos, tipo, modelo);
  return escolhido?.limiteDias ?? LIMITE_DIAS_PADRAO[tipo];
}

/** Plano do ativo, com o padrao da secao 7.10 quando a unidade ainda nao parametrizou. */
function planoDoAtivo(
  planos: Array<{ tipo: TipoServicoPeriodico; modelo: string | null; base: BaseMedicao; intervalo: unknown; avisarCom: unknown }>,
  tipo: TipoServicoPeriodico,
  modelo?: string | null,
): PlanoPeriodico {
  const escolhido = planoAplicavel(planos, tipo, modelo);
  if (!escolhido) {
    const padrao = INTERVALO_PADRAO[tipo];
    return { tipo, base: padrao.base, intervalo: String(padrao.intervalo), avisarCom: String(padrao.avisarCom) };
  }
  return {
    tipo,
    base: escolhido.base,
    intervalo: String(escolhido.intervalo),
    avisarCom: String(escolhido.avisarCom),
  };
}

// ------------------------------------------------------------------ execucao

export interface NovaExecucao {
  unidadeId: string;
  tipo: TipoServicoPeriodico;
  veiculoId?: string | null;
  equipamentoFrioId?: string | null;
  executadoEm?: Date | null;
  /** leitura do painel; opcional quando o plano vence por dias */
  medicao?: string | null;
  itemId?: string | null;
  quantidade?: string | null;
  custo?: string | null;
  oficina?: string | null;
  ordemServicoId?: string | null;
  observacao?: string | null;
}

/**
 * Registra a execucao e reabre o ciclo.
 *
 * Tres coisas acontecem juntas, e por isso vivem aqui: a execucao vira registro com o
 * intervalo congelado, o cadastro do ativo recebe a leitura (que so avanca, 7.1) e a
 * trilha guarda quem trocou o que, e com qual leitura.
 */
export async function registrarExecucao(ator: Ator, entrada: NovaExecucao) {
  const doEquipamento = ehDoEquipamento(entrada.tipo);
  if (doEquipamento && !entrada.equipamentoFrioId) {
    throw new ValidationError('Informe o equipamento de frio: o Thermo King tem horimetro proprio.');
  }
  if (!doEquipamento && !entrada.veiculoId) {
    throw new ValidationError('Informe o veiculo.');
  }

  const veiculo = entrada.veiculoId
    ? await prisma.veiculo.findFirst({ where: { id: entrada.veiculoId, deletedAt: null } })
    : null;
  if (entrada.veiculoId && !veiculo) throw new NotFoundError('Veiculo');

  const equipamento = entrada.equipamentoFrioId
    ? await prisma.equipamentoFrio.findFirst({ where: { id: entrada.equipamentoFrioId, deletedAt: null } })
    : null;
  if (entrada.equipamentoFrioId && !equipamento) throw new NotFoundError('Equipamento de frio');

  const modelo = doEquipamento
    ? [equipamento?.marca, equipamento?.modelo].filter(Boolean).join(' ')
    : [veiculo?.marca, veiculo?.modelo].filter(Boolean).join(' ');

  const planos = await prisma.planoServicoPeriodico.findMany({
    where: { unidadeId: entrada.unidadeId, tipo: entrada.tipo, ativo: true, deletedAt: null },
  });
  const plano = planoAplicavel(planos, entrada.tipo, modelo);
  const regra = planoDoAtivo(planos, entrada.tipo, modelo);

  const anterior = await prisma.servicoPeriodico.findFirst({
    where: {
      deletedAt: null,
      tipo: entrada.tipo,
      ...(doEquipamento ? { equipamentoFrioId: entrada.equipamentoFrioId } : { veiculoId: entrada.veiculoId }),
    },
    orderBy: { executadoEm: 'desc' },
  });

  /*
   * Plano por dias nao exige leitura: quem engraxa o chassi anota o dia, e nao o painel.
   * Mesmo assim, a leitura corrente do ativo entra no registro quando existe — e o que
   * permite a operacao voltar o plano para quilometragem depois sem perder o historico.
   */
  const porDias = regra.base === 'DIAS';
  const medicaoCorrente = doEquipamento ? (equipamento?.horimetro?.toString() ?? null) : (veiculo?.hodometroAtual.toString() ?? null);
  const medicao = entrada.medicao ?? (porDias ? medicaoCorrente : null);

  if (!porDias && medicao === null) {
    throw new ValidationError('Informe a leitura do painel: este plano vence por medicao.');
  }

  if (medicao !== null) {
    const recusa = medicaoDaExecucaoInvalida(medicao, anterior?.medicao?.toString() ?? null);
    if (recusa) throw new ConflictError(recusa);
  }

  const intervalo = dinheiro(regra.intervalo);
  const executadoEm = entrada.executadoEm ?? new Date();
  const proxima = porDias || medicao === null ? null : dinheiro(medicao).plus(intervalo).toDecimalPlaces(1);
  // no plano por dias o vencimento e data, e nao numero: a proxima sai do calendario
  const proximaEm = porDias ? new Date(executadoEm.getTime() + Number(intervalo) * 86_400_000) : null;

  const execucao = await prisma.servicoPeriodico.create({
    data: {
      id: novoId(),
      unidadeId: entrada.unidadeId,
      tipo: entrada.tipo,
      base: regra.base,
      veiculoId: doEquipamento ? null : (entrada.veiculoId ?? null),
      equipamentoFrioId: doEquipamento ? (entrada.equipamentoFrioId ?? null) : null,
      planoId: plano?.id ?? null,
      executadoEm,
      medicao: medicao === null ? null : paraBanco(medicao),
      intervalo: paraBanco(intervalo.toFixed(1)),
      /*
       * `proxima` e coluna de medicao. No plano por dias nao ha medicao de vencimento -
       * guardamos a leitura da execucao para o registro nao ficar sem referencia numerica,
       * e quem manda no vencimento e a data (`executado_em` + intervalo).
       */
      proxima: proxima === null ? (medicao === null ? 0 : paraBanco(medicao)) : paraBanco(proxima.toFixed(1)),
      itemId: entrada.itemId ?? null,
      quantidade: entrada.quantidade ? paraBanco(entrada.quantidade) : null,
      custo: entrada.custo ? paraBanco(entrada.custo) : null,
      oficina: entrada.oficina?.trim() ?? null,
      ordemServicoId: entrada.ordemServicoId ?? null,
      observacao: entrada.observacao?.trim() ?? null,
      createdBy: ator.usuarioId,
    },
  });

  /*
   * A leitura da execucao entra no historico de medidor e so avanca o cadastro (ADR 0023).
   * O registro guarda de onde veio: oficina, e nao automacao — e isso pesa menos no km/dia.
   */
  if (medicao !== null) {
    await registrarLeitura(ator, {
      unidadeId: entrada.unidadeId,
      tipo: doEquipamento ? 'HORIMETRO_FRIO' : 'ODOMETRO',
      valor: medicao,
      origem: 'EXECUCAO_OFICINA',
      medidoEm: executadoEm,
      veiculoId: doEquipamento ? null : (entrada.veiculoId ?? null),
      equipamentoFrioId: doEquipamento ? (entrada.equipamentoFrioId ?? null) : null,
      servicoPeriodicoId: execucao.id,
    });
  }

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'servicos_periodicos',
    entidadeId: execucao.id,
    acao: 'REGISTRAR',
    valorNovo: {
      tipo: entrada.tipo,
      ativo: veiculo?.placa ?? equipamento?.numeroSerie ?? equipamento?.marca ?? null,
      medicao,
      proxima: proxima?.toFixed(1) ?? null,
      proximaEm: proximaEm?.toISOString() ?? null,
      intervalo: intervalo.toFixed(1),
    },
  });

  return {
    execucao,
    proxima: proxima?.toFixed(1) ?? null,
    proximaEm: proximaEm?.toISOString() ?? null,
    intervalo: intervalo.toFixed(1),
  };
}

// ------------------------------------------------------------------ patio da oficina

export interface ItemDoPatio {
  tipo: TipoServicoPeriodico;
  rotulo: string;
  base: BaseMedicao;
  severidade: Severidade;
  usado: number;
  aVencer: string;
  vencido: string;
  proxima: string | null;
  proximaEm: string | null;
  executadoEm: string | null;
  motivo: string | null;
  alerta: string | null;
  /** dias ate vencer, do ritmo do proprio veiculo; null quando nao ha base para prever */
  venceEmDias: number | null;
  /** data prevista, para programar peca e box */
  previstoPara: string | null;
}

export interface VeiculoNoPatio {
  veiculoId: string;
  placa: string;
  frotaNumero: string;
  descricao: string;
  unidadeId: string;
  hodometro: string;
  /** km/dia da media movel de 30 dias; null quando nao ha leitura suficiente */
  kmPorDia: string | null;
  /** ha quantos dias o veiculo nao da sinal de leitura */
  diasSemLeitura: number | null;
  /** aparelho de frio instalado, quando ha: o item de frio e dele, e nao do caminhao */
  equipamento: { id: string; identificacao: string; horimetro: string | null } | null;
  itens: ItemDoPatio[];
  /** o item que vence primeiro pelo ritmo do veiculo: e ele que marca a entrada no box */
  venceEmDias: number | null;
  /** (vencidos x 100) + (criticos x 10) + peso(pior) — ordena a fila do box (ADR 0023) */
  score: number;
  pior: Severidade;
  vencidos: number;
  criticos: number;
}

/**
 * Patio: uma linha por veiculo, com os cinco itens do plano lado a lado (ADR 0023).
 *
 * E a tela que a oficina usa de manha. O ganho nao esta em saber que um item venceu — isso
 * o painel por tipo ja dizia —, e sim em ver **os itens que a mesma parada resolve**. Por
 * isso a ordem e o score, e nao o alfabeto: caminhao com tres itens vencidos sobe na fila
 * porque uma viagem ao box resolve os tres.
 *
 * O item de frio sai do aparelho instalado no caminhao, com o horimetro dele. Veiculo sem
 * aparelho simplesmente nao tem essa coluna — e nao um item vazio que ninguem sabe ler.
 */
export async function painelDoPatio(unidades: string[] = [], agora = new Date()) {
  const filtroUnidades = unidades.length > 0 ? { unidadeId: { in: unidades } } : {};

  const [veiculos, planos] = await Promise.all([
    prisma.veiculo.findMany({
      where: { deletedAt: null, status: { notIn: ['VENDIDO', 'INATIVO'] }, ...filtroUnidades },
      include: {
        equipamentosFrio: {
          where: { deletedAt: null, status: 'ATIVO' },
          select: { id: true, marca: true, modelo: true, numeroSerie: true, horimetro: true },
          take: 1,
        },
      },
      orderBy: { placa: 'asc' },
    }),
    prisma.planoServicoPeriodico.findMany({ where: { deletedAt: null, ativo: true, ...filtroUnidades } }),
  ]);

  if (veiculos.length === 0) {
    return { itens: [], resumo: { ...contarPorSeveridade([]), veiculos: 0, comVencido: 0 } };
  }

  const equipamentoIds = veiculos.flatMap((v) => v.equipamentosFrio.map((e) => e.id));

  // ritmo da frota inteira numa consulta so: e o que transforma "faltam 1.200 km" em dias
  const ritmos = await ritmoDosVeiculos(veiculos.map((v) => v.id), 30, agora);

  // uma consulta para toda a frota: o patio abre com 88 veiculos x 5 itens
  const execucoes = await prisma.servicoPeriodico.findMany({
    where: {
      deletedAt: null,
      OR: [{ veiculoId: { in: veiculos.map((v) => v.id) } }, { equipamentoFrioId: { in: equipamentoIds } }],
    },
    orderBy: { executadoEm: 'desc' },
  });

  const ultima = new Map<string, (typeof execucoes)[number]>();
  for (const e of execucoes) {
    const ativo = e.equipamentoFrioId ?? e.veiculoId ?? '';
    const chave = `${ativo}|${e.tipo}`;
    if (!ultima.has(chave)) ultima.set(chave, e);
  }

  const linhas: VeiculoNoPatio[] = veiculos.map((v) => {
    const equipamento = v.equipamentosFrio[0] ?? null;
    const modeloVeiculo = [v.marca, v.modelo].filter(Boolean).join(' ');
    const modeloEquip = equipamento ? [equipamento.marca, equipamento.modelo].filter(Boolean).join(' ') : '';

    const ritmo = ritmos.get(v.id) ?? null;

    const itens = ORDEM_ITENS.filter((tipo) => (ehDoEquipamento(tipo) ? equipamento !== null : true)).map((tipo) => {
      const doEquipamento = ehDoEquipamento(tipo);
      const ativoId = doEquipamento ? equipamento!.id : v.id;
      const execucao = ultima.get(`${ativoId}|${tipo}`) ?? null;
      const modelo = doEquipamento ? modeloEquip : modeloVeiculo;
      const plano = planoDoAtivo(planos, tipo, modelo);

      const naRegua = posicaoNaRegua({
        plano,
        medicaoDaUltima: execucao?.medicao?.toString() ?? null,
        medicaoAtual: doEquipamento ? (equipamento!.horimetro?.toString() ?? null) : v.hodometroAtual.toString(),
        dataDaUltima: execucao?.executadoEm ?? null,
        limiteDias: limiteDoPlano(planos, tipo, modelo),
        agora,
      });

      /*
       * Previsao so para o que se mede em km do veiculo: horimetro de aparelho tem ritmo
       * proprio (horas de compressor, e nao de estrada) e o plano por dias ja e calendario.
       */
      const venceEmDias =
        plano.base === 'HODOMETRO' && naRegua.severidade !== 'SEM_BASE'
          ? diasAteVencer(naRegua.posicao.aVencer.toFixed(1), ritmo?.porDia ?? null)
          : null;

      return {
        tipo,
        rotulo: ROTULO_TIPO[tipo],
        base: plano.base,
        severidade: naRegua.severidade,
        venceEmDias,
        previstoPara: dataPrevista(venceEmDias, agora)?.toISOString() ?? null,
        usado: naRegua.usado,
        aVencer: naRegua.posicao.aVencer.toFixed(1),
        vencido: naRegua.posicao.vencido.toFixed(1),
        proxima: naRegua.posicao.proxima?.toFixed(1) ?? null,
        proximaEm: naRegua.posicao.proximaEm?.toISOString() ?? null,
        executadoEm: execucao?.executadoEm.toISOString() ?? null,
        motivo: naRegua.motivo,
        alerta: naRegua.alerta,
      };
    });

    return {
      veiculoId: v.id,
      placa: v.placa,
      frotaNumero: v.frotaNumero,
      descricao: modeloVeiculo || v.frotaNumero,
      unidadeId: v.unidadeId,
      hodometro: v.hodometroAtual.toString(),
      kmPorDia: ritmo?.porDia ?? null,
      diasSemLeitura: ritmo?.diasSemLeitura ?? null,
      equipamento: equipamento
        ? {
            id: equipamento.id,
            identificacao: equipamento.numeroSerie ?? modeloEquip,
            horimetro: equipamento.horimetro?.toString() ?? null,
          }
        : null,
      itens,
      // o primeiro a vencer manda na data de entrada: nao adianta programar pelo mais folgado
      venceEmDias: menorPrevisao(itens),
      score: scoreDoAtivo(itens),
      pior: piorSeveridade(itens),
      vencidos: itens.filter((i) => i.severidade === 'VENCIDO').length,
      criticos: itens.filter((i) => i.severidade === 'CRITICO').length,
    };
  });

  // fila do box: score primeiro, placa so para desempatar e a lista nao dancar entre aberturas
  linhas.sort((a, b) => b.score - a.score || a.placa.localeCompare(b.placa));

  return {
    itens: linhas,
    resumo: {
      ...contarPorSeveridade(linhas.flatMap((l) => l.itens)),
      veiculos: linhas.length,
      comVencido: linhas.filter((l) => l.vencidos > 0).length,
    },
  };
}


/** Historico de um ativo em um tipo: o que a planilha perdia a cada troca. */
export async function historicoDoAtivo(tipo: TipoServicoPeriodico, ativoId: string, limite = 20) {
  return prisma.servicoPeriodico.findMany({
    where: {
      deletedAt: null,
      tipo,
      ...(ehDoEquipamento(tipo) ? { equipamentoFrioId: ativoId } : { veiculoId: ativoId }),
    },
    include: { item: { select: { codigo: true, descricao: true } } },
    orderBy: { executadoEm: 'desc' },
    take: limite,
  });
}

/**
 * Avisa a manutencao sobre o que venceu. Roda no fechamento do dia (job), nao no request:
 * relatorio pesado em request sincrono e o que a secao 13 proibe.
 */
export async function notificarVencidos(unidades: string[] = []): Promise<number> {
  const tipos = Object.keys(INTERVALO_PADRAO) as TipoServicoPeriodico[];
  let avisados = 0;

  for (const tipo of tipos) {
    const { itens } = await painel(tipo, unidades);
    // o aviso cobre vencido e critico: quem esta a 90% do ciclo ja precisa entrar na semana
    const vencidos = itens.filter((i) => i.severidade === 'VENCIDO' || i.severidade === 'CRITICO');
    if (vencidos.length === 0) continue;

    await notificarPorPermissao('preventiva:consultar', {
      titulo: `${ROTULO_TIPO[tipo]}: ${vencidos.length} ativo(s) vencido(s) ou criticos`,
      corpo: vencidos
        .slice(0, 10)
        .map((v) =>
          v.severidade === 'VENCIDO'
            ? `${v.identificacao}: ${v.motivo ?? `${v.vencido} ${v.base === 'HORIMETRO' ? 'h' : 'km'} alem do previsto`}`
            : `${v.identificacao}: ${Math.round(v.usado * 100)}% do ciclo consumido`,
        )
        .join('\n'),
      entidade: 'servicos_periodicos',
      entidadeId: tipo,
    });
    avisados += vencidos.length;
  }

  return avisados;
}

/**
 * Programacao da semana: quem entra no box, e o que se faz nele (ADR 0023, passo 3).
 *
 * Sai do mesmo patio que a oficina ve de manha — nao ha segunda conta de vencimento aqui, e nem
 * poderia haver: duas contas sobre a mesma placa dariam duas verdades, que e exatamente o que o
 * ADR recusou. A camada de programacao so decide **quando** e **junto com o que**.
 */
export async function programacao(
  unidades: string[] = [],
  horizonteDias = HORIZONTE_PADRAO_DIAS,
  agora = new Date(),
): Promise<Programacao> {
  const { itens } = await painelDoPatio(unidades, agora);
  return programacaoDaSemana(itens, horizonteDias);
}
