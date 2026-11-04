import { db, novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { notificarPorPermissao } from '../../core/notifications/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { paraBanco } from '../../core/money.js';
import type { Ator } from '../compras/service.js';
import {
  VIDA_UTIL_MESES_PADRAO,
  kmComABateria,
  pontoDeTroca,
  tensaoInvalida,
  type PontoDeTroca,
} from './bateria.js';

/**
 * Controle de baterias (secao 7.11).
 *
 * A bateria e ativo que anda entre veiculos e envelhece parada. O servico guarda tres
 * coisas que o papel perdia: onde ela esta, ha quanto tempo, e como ela vem medindo.
 */

const requisicaoDe = (ator: Ator) => ({ ip: ator.ip ?? null, userAgent: ator.userAgent ?? null });

export interface NovaBateria {
  unidadeId: string;
  identificacao: string;
  marca?: string | null;
  modelo?: string | null;
  numeroSerie?: string | null;
  amperagem?: number | null;
  tensaoNominal?: string | null;
  dataCompra?: Date | null;
  custo?: string | null;
  garantiaMeses?: number | null;
  vidaUtilMeses?: number | null;
  observacao?: string | null;
}

export async function cadastrar(ator: Ator, entrada: NovaBateria) {
  const identificacao = entrada.identificacao.trim().toUpperCase();
  if (identificacao.length < 2) throw new ValidationError('Informe a identificacao escrita na carcaca da bateria.');

  const repetida = await prisma.bateria.findFirst({
    where: { unidadeId: entrada.unidadeId, identificacao, deletedAt: null },
  });
  if (repetida) throw new ConflictError(`Ja existe uma bateria ${identificacao} nesta unidade.`);

  const bateria = await prisma.bateria.create({
    data: {
      id: novoId(),
      unidadeId: entrada.unidadeId,
      identificacao,
      marca: entrada.marca?.trim() ?? null,
      modelo: entrada.modelo?.trim() ?? null,
      numeroSerie: entrada.numeroSerie?.trim() ?? null,
      amperagem: entrada.amperagem ?? null,
      tensaoNominal: entrada.tensaoNominal ? paraBanco(entrada.tensaoNominal) : null,
      dataCompra: entrada.dataCompra ?? null,
      custo: entrada.custo ? paraBanco(entrada.custo) : null,
      garantiaMeses: entrada.garantiaMeses ?? null,
      vidaUtilMeses: entrada.vidaUtilMeses ?? null,
      observacao: entrada.observacao?.trim() ?? null,
      createdBy: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'baterias',
    entidadeId: bateria.id,
    acao: 'CRIAR',
    valorNovo: { identificacao, marca: bateria.marca, amperagem: bateria.amperagem },
  });

  return bateria;
}

export interface Instalacao {
  veiculoId: string;
  posicao?: number | null;
  instaladaEm?: Date | null;
  hodometro?: string | null;
}

/**
 * Instala a bateria no veiculo.
 *
 * Bateria ja instalada em outro veiculo nao migra calada: e preciso retirar antes, para o
 * historico dizer quanto tempo ela serviu em cada um. Sucata nao volta a operar.
 */
export async function instalar(ator: Ator, bateriaId: string, entrada: Instalacao) {
  const bateria = await prisma.bateria.findFirst({ where: { id: bateriaId, deletedAt: null } });
  if (!bateria) throw new NotFoundError('Bateria');
  if (bateria.status === 'SUCATA') throw new ConflictError('Bateria sucateada nao volta a operar.');
  if (bateria.status === 'EM_USO') {
    throw new ConflictError('Esta bateria ja esta instalada. Retire-a do veiculo atual antes de instalar em outro.');
  }

  const veiculo = await prisma.veiculo.findFirst({ where: { id: entrada.veiculoId, deletedAt: null } });
  if (!veiculo) throw new NotFoundError('Veiculo');

  const instalada = await db.bateria.update({
    where: { id: bateriaId },
    data: {
      status: 'EM_USO',
      veiculoId: veiculo.id,
      posicao: entrada.posicao ?? null,
      instaladaEm: entrada.instaladaEm ?? new Date(),
      // sem leitura informada vale a do cadastro do veiculo (secao 7.1)
      hodometroInstalacao: paraBanco(entrada.hodometro ?? veiculo.hodometroAtual.toString()),
      retiradaEm: null,
      motivoRetirada: null,
      updatedBy: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'baterias',
    entidadeId: bateriaId,
    acao: 'INSTALAR',
    valorAnterior: { status: bateria.status, veiculoId: bateria.veiculoId },
    valorNovo: { status: 'EM_USO', veiculo: veiculo.placa, posicao: entrada.posicao ?? null },
  });

  return instalada;
}

export interface Retirada {
  motivo: string;
  destino: 'EM_ESTOQUE' | 'EM_ANALISE_GARANTIA' | 'SUCATA';
  retiradaEm?: Date | null;
}

/** Retira a bateria do veiculo. O destino diz o que aconteceu com ela — e nada se apaga. */
export async function retirar(ator: Ator, bateriaId: string, entrada: Retirada) {
  const motivo = entrada.motivo?.trim() ?? '';
  if (motivo.length < 5) throw new ValidationError('Descreva o motivo da retirada com ao menos 5 caracteres.');

  const bateria = await prisma.bateria.findFirst({ where: { id: bateriaId, deletedAt: null } });
  if (!bateria) throw new NotFoundError('Bateria');
  if (bateria.status !== 'EM_USO') throw new ConflictError('Esta bateria nao esta instalada em nenhum veiculo.');

  const retirada = await db.bateria.update({
    where: { id: bateriaId },
    data: {
      status: entrada.destino,
      veiculoId: null,
      posicao: null,
      instaladaEm: null,
      retiradaEm: entrada.retiradaEm ?? new Date(),
      motivoRetirada: motivo,
      updatedBy: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'baterias',
    entidadeId: bateriaId,
    acao: 'RETIRAR',
    valorAnterior: { status: 'EM_USO', veiculoId: bateria.veiculoId },
    valorNovo: { status: entrada.destino, motivo },
    severidade: 'ALERTA',
  });

  return retirada;
}

export interface NovaMedicao {
  tensaoV: string;
  medidoEm?: Date | null;
  densidade?: string | null;
  aposRodar?: boolean;
  hodometro?: string | null;
  observacao?: string | null;
}

/**
 * Registra a medicao e avisa quando ela indica ponto de troca.
 *
 * Medicao feita logo apos rodar entra marcada: com o alternador tendo acabado de carregar,
 * qualquer bateria mede bem, e o ponto de troca ignora essa leitura em vez de se enganar
 * com ela.
 */
export async function medir(ator: Ator, bateriaId: string, entrada: NovaMedicao) {
  const recusa = tensaoInvalida(entrada.tensaoV);
  if (recusa) throw new ValidationError(recusa);

  const bateria = await prisma.bateria.findFirst({
    where: { id: bateriaId, deletedAt: null },
    include: { veiculo: { select: { placa: true } } },
  });
  if (!bateria) throw new NotFoundError('Bateria');

  const medicao = await prisma.medicaoBateria.create({
    data: {
      id: novoId(),
      bateriaId,
      medidoEm: entrada.medidoEm ?? new Date(),
      tensaoV: paraBanco(entrada.tensaoV),
      densidade: entrada.densidade ? paraBanco(entrada.densidade) : null,
      aposRodar: entrada.aposRodar ?? false,
      hodometro: entrada.hodometro ? paraBanco(entrada.hodometro) : null,
      observacao: entrada.observacao?.trim() ?? null,
      createdBy: ator.usuarioId,
    },
  });

  const posicao = await avaliar(bateriaId);

  if (posicao.situacao === 'TROCAR') {
    await notificarPorPermissao('bateria:gerenciar', {
      titulo: `Bateria ${bateria.identificacao} no ponto de troca`,
      corpo:
        `${bateria.veiculo ? `Veiculo ${bateria.veiculo.placa}. ` : 'Em estoque. '}` +
        posicao.mensagens.join('\n'),
      entidade: 'baterias',
      entidadeId: bateriaId,
    });
  }

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'baterias',
    entidadeId: bateriaId,
    acao: 'MEDIR',
    valorNovo: {
      tensaoV: entrada.tensaoV,
      aposRodar: entrada.aposRodar ?? false,
      situacao: posicao.situacao,
    },
  });

  return { medicao, posicao };
}

/**
 * Posicao de uma bateria: le a ultima medicao **em repouso** e aplica a regra do ponto de
 * troca. Medicao apos rodar fica no historico, mas nao decide nada.
 */
export async function avaliar(bateriaId: string, agora = new Date()): Promise<PontoDeTroca> {
  const bateria = await prisma.bateria.findFirst({
    where: { id: bateriaId, deletedAt: null },
    include: { medicoes: { where: { deletedAt: null, aposRodar: false }, orderBy: { medidoEm: 'desc' }, take: 1 } },
  });
  if (!bateria) throw new NotFoundError('Bateria');

  const ultima = bateria.medicoes[0] ?? null;
  return pontoDeTroca({
    instaladaEm: bateria.instaladaEm,
    vidaUtilMeses: bateria.vidaUtilMeses,
    tensaoV: ultima?.tensaoV.toString() ?? null,
    medidaEm: ultima?.medidoEm ?? null,
    dataCompra: bateria.dataCompra,
    garantiaMeses: bateria.garantiaMeses,
    agora,
  });
}

const ORDEM = { TROCAR: 0, ATENCAO: 1, SEM_MEDICAO: 2, EM_DIA: 3 } as const;

/**
 * Painel de baterias: uma linha por bateria, com o ponto de troca calculado na hora.
 *
 * Quem esta no ponto de troca aparece primeiro, e a bateria sem medicao vem antes da que
 * esta em dia — o que nao se mede e o que costuma parar o caminhao.
 */
export async function painel(unidades: string[] = [], incluirSucata = false, agora = new Date()) {
  const baterias = await prisma.bateria.findMany({
    where: {
      deletedAt: null,
      ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}),
      ...(incluirSucata ? {} : { status: { not: 'SUCATA' } }),
    },
    include: {
      veiculo: { select: { id: true, placa: true, frotaNumero: true, hodometroAtual: true } },
      medicoes: { where: { deletedAt: null, aposRodar: false }, orderBy: { medidoEm: 'desc' }, take: 1 },
    },
    orderBy: { identificacao: 'asc' },
  });

  const itens = baterias.map((b) => {
    const ultima = b.medicoes[0] ?? null;
    const posicao = pontoDeTroca({
      instaladaEm: b.instaladaEm,
      vidaUtilMeses: b.vidaUtilMeses,
      tensaoV: ultima?.tensaoV.toString() ?? null,
      medidaEm: ultima?.medidoEm ?? null,
      dataCompra: b.dataCompra,
      garantiaMeses: b.garantiaMeses,
      agora,
    });

    return {
      id: b.id,
      identificacao: b.identificacao,
      descricao: [b.marca, b.modelo, b.amperagem ? `${b.amperagem} Ah` : null].filter(Boolean).join(' · '),
      status: b.status,
      unidadeId: b.unidadeId,
      veiculo: b.veiculo ? { id: b.veiculo.id, placa: b.veiculo.placa, frotaNumero: b.veiculo.frotaNumero } : null,
      instaladaEm: b.instaladaEm?.toISOString() ?? null,
      vidaUtilMeses: b.vidaUtilMeses ?? VIDA_UTIL_MESES_PADRAO,
      tensaoV: ultima?.tensaoV.toString() ?? null,
      medidaEm: ultima?.medidoEm.toISOString() ?? null,
      kmComABateria:
        kmComABateria(b.hodometroInstalacao?.toString() ?? null, b.veiculo?.hodometroAtual.toString() ?? null)?.toString() ??
        null,
      situacao: posicao.situacao,
      motivos: posicao.motivos,
      mensagens: posicao.mensagens,
      mesesEmUso: posicao.mesesEmUso,
      mesesRestantes: posicao.mesesRestantes,
      estadoDaTensao: posicao.estadoDaTensao,
      naGarantia: posicao.naGarantia,
      garantiaAte: posicao.garantiaAte?.toISOString() ?? null,
    };
  });

  itens.sort((a, b) => ORDEM[a.situacao] - ORDEM[b.situacao] || a.identificacao.localeCompare(b.identificacao));

  return {
    itens,
    resumo: {
      TROCAR: itens.filter((i) => i.situacao === 'TROCAR').length,
      ATENCAO: itens.filter((i) => i.situacao === 'ATENCAO').length,
      SEM_MEDICAO: itens.filter((i) => i.situacao === 'SEM_MEDICAO').length,
      EM_DIA: itens.filter((i) => i.situacao === 'EM_DIA').length,
      emUso: itens.filter((i) => i.status === 'EM_USO').length,
      emEstoque: itens.filter((i) => i.status === 'EM_ESTOQUE').length,
      naGarantiaNoPonto: itens.filter((i) => i.naGarantia && i.situacao === 'TROCAR').length,
      total: itens.length,
    },
  };
}

/** Historico de medicoes: e a queda ao longo do tempo que antecipa a troca. */
export async function historico(bateriaId: string, limite = 30) {
  return prisma.medicaoBateria.findMany({
    where: { bateriaId, deletedAt: null },
    orderBy: { medidoEm: 'desc' },
    take: limite,
  });
}
