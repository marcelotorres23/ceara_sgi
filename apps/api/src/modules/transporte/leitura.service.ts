import type { OrigemLeitura, TipoMedidor } from '@prisma/client';
import { db, novoId, prisma } from '../../core/db.js';
import { paraBanco } from '../../core/money.js';
import type { Ator } from '../compras/service.js';
import { alertaDeHodometro, deveAvancarCadastro } from './hodometro.js';
import { JANELA_PADRAO_DIAS, diasSemLeitura, ritmoPorDia } from './ritmo-de-uso.js';

/**
 * Historico de medidor (ADR 0023, decisao 6).
 *
 * **Toda** alteracao de hodometro ou horimetro passa por aqui. Antes, cinco lugares
 * mexiam no numero do jeito deles — portaria, checklist, execucao de servico, oficina e
 * abastecimento — e nenhum deixava rastro de onde o valor tinha vindo. Painel alimentado
 * por numero sem procedencia e opiniao com aparencia de dado.
 *
 * A leitura entra sempre; o **cadastro do ativo so avanca**. Leitura menor vira historico
 * com suspeita, nao correcao — quem decide se foi troca de painel, reset de aparelho ou
 * digito errado e quem esta no patio.
 */

/**
 * Origens digitadas, sem fato operacional por tras.
 *
 * Pesam menos na media de km/dia: leitura presa a um abastecimento ou a uma passagem na
 * portaria tem hora, lugar e responsavel; numero digitado a parte tem so o numero, e e
 * onde o digito trocado aparece.
 */
const ORIGENS_MANUAIS: ReadonlySet<OrigemLeitura> = new Set<OrigemLeitura>([
  'DIGITACAO',
  'IMPORTACAO_LEGADO',
]);

export interface NovaLeitura {
  unidadeId: string;
  tipo: TipoMedidor;
  valor: string;
  origem: OrigemLeitura;
  medidoEm?: Date | null;
  veiculoId?: string | null;
  equipamentoFrioId?: string | null;
  abastecimentoId?: string | null;
  servicoPeriodicoId?: string | null;
  acessoPortariaId?: string | null;
  observacao?: string | null;
  /** salto acima disto exige confirmacao; sem informar, vale o padrao da regra */
  saltoMaximo?: number;
}

export interface LeituraRegistrada {
  id: string;
  avancouAtivo: boolean;
  suspeita: 'REGRESSAO' | 'SALTO' | null;
  /** texto pronto para a tela, quando a leitura nao fecha com o cadastro */
  alerta: string | null;
}

/**
 * Grava a leitura e acerta o cadastro do ativo.
 *
 * Devolve o alerta quando a leitura nao fecha, para quem chamou decidir o que fazer com
 * ele — a portaria abre ocorrencia, o checklist notifica a manutencao, a oficina mostra
 * na ficha. A regra e a mesma; o que muda e quem precisa ser avisado.
 */
export async function registrarLeitura(ator: Ator, entrada: NovaLeitura): Promise<LeituraRegistrada> {
  const doEquipamento = entrada.tipo === 'HORIMETRO_FRIO';

  const veiculo = entrada.veiculoId
    ? await prisma.veiculo.findFirst({
        where: { id: entrada.veiculoId, deletedAt: null },
        select: { id: true, placa: true, hodometroAtual: true, horimetroAtual: true },
      })
    : null;

  const equipamento = entrada.equipamentoFrioId
    ? await prisma.equipamentoFrio.findFirst({
        where: { id: entrada.equipamentoFrioId, deletedAt: null },
        select: { id: true, numeroSerie: true, marca: true, horimetro: true },
      })
    : null;

  const registrado = doEquipamento
    ? (equipamento?.horimetro?.toString() ?? null)
    : entrada.tipo === 'HORIMETRO_VEICULO'
      ? (veiculo?.horimetroAtual?.toString() ?? null)
      : (veiculo?.hodometroAtual.toString() ?? null);

  const alerta = alertaDeHodometro({
    registrado,
    informado: entrada.valor,
    origem: 'checklist',
    placa: veiculo?.placa ?? equipamento?.numeroSerie ?? equipamento?.marca ?? null,
    saltoMaximoKm: entrada.saltoMaximo,
  });

  const suspeita = alerta?.tipo === 'HODOMETRO_RETROCEDEU' ? 'REGRESSAO' : alerta?.tipo === 'HODOMETRO_SALTOU' ? 'SALTO' : null;
  const avanca = deveAvancarCadastro(registrado, entrada.valor);

  const leitura = await prisma.leitura.create({
    data: {
      id: novoId(),
      unidadeId: entrada.unidadeId,
      tipo: entrada.tipo,
      valor: paraBanco(entrada.valor),
      medidoEm: entrada.medidoEm ?? new Date(),
      origem: entrada.origem,
      veiculoId: doEquipamento ? null : (entrada.veiculoId ?? null),
      equipamentoFrioId: doEquipamento ? (entrada.equipamentoFrioId ?? null) : null,
      abastecimentoId: entrada.abastecimentoId ?? null,
      servicoPeriodicoId: entrada.servicoPeriodicoId ?? null,
      acessoPortariaId: entrada.acessoPortariaId ?? null,
      suspeita,
      observacao: entrada.observacao?.trim() ?? null,
      avancouAtivo: avanca,
      createdBy: ator.usuarioId,
    },
  });

  if (avanca) {
    if (doEquipamento && equipamento) {
      await db.equipamentoFrio.update({
        where: { id: equipamento.id },
        data: { horimetro: paraBanco(entrada.valor), updatedBy: ator.usuarioId },
      });
    } else if (veiculo) {
      await db.veiculo.update({
        where: { id: veiculo.id },
        data:
          entrada.tipo === 'HORIMETRO_VEICULO'
            ? { horimetroAtual: paraBanco(entrada.valor), updatedBy: ator.usuarioId }
            : { hodometroAtual: paraBanco(entrada.valor), updatedBy: ator.usuarioId },
      });
    }
  }

  return { id: leitura.id, avancouAtivo: avanca, suspeita, alerta: alerta?.mensagem ?? null };
}

/**
 * Confirma uma leitura suspeita.
 *
 * Confirmar nao reescreve o passado: a leitura continua marcada como suspeita, com quem
 * confirmou e quando. O que muda e que ela deixa de pedir atencao na tela — e, quando a
 * confirmacao aceita um medidor que voltou, o cadastro passa a valer aquele numero, porque
 * ai existe gente respondendo pela troca de painel.
 */
export async function confirmarLeitura(ator: Ator, leituraId: string, aceitarNoCadastro: boolean) {
  const leitura = await prisma.leitura.findFirst({ where: { id: leituraId, deletedAt: null } });
  if (!leitura) return null;

  const confirmada = await prisma.leitura.update({
    where: { id: leituraId },
    data: { confirmadaPor: ator.usuarioId, confirmadaEm: new Date(), avancouAtivo: aceitarNoCadastro || leitura.avancouAtivo },
  });

  if (aceitarNoCadastro) {
    if (leitura.equipamentoFrioId) {
      await db.equipamentoFrio.update({
        where: { id: leitura.equipamentoFrioId },
        data: { horimetro: leitura.valor, updatedBy: ator.usuarioId },
      });
    } else if (leitura.veiculoId) {
      await db.veiculo.update({
        where: { id: leitura.veiculoId },
        data:
          leitura.tipo === 'HORIMETRO_VEICULO'
            ? { horimetroAtual: leitura.valor, updatedBy: ator.usuarioId }
            : { hodometroAtual: leitura.valor, updatedBy: ator.usuarioId },
      });
    }
  }

  return confirmada;
}

export interface RitmoDoAtivo {
  /** km ou horas por dia; null quando nao ha base para afirmar */
  porDia: string | null;
  leituras: number;
  ultimaEm: string | null;
  diasSemLeitura: number | null;
}

/**
 * Ritmo de um ativo a partir do historico de leituras.
 *
 * Le a janela inteira de uma vez: o painel do patio pede isso para a frota toda, e uma
 * consulta por veiculo derrubaria a tela.
 */
export async function ritmoDosVeiculos(
  veiculoIds: string[],
  janelaDias = JANELA_PADRAO_DIAS,
  agora = new Date(),
): Promise<Map<string, RitmoDoAtivo>> {
  const ritmos = new Map<string, RitmoDoAtivo>();
  if (veiculoIds.length === 0) return ritmos;

  const desde = new Date(agora.getTime() - janelaDias * 86_400_000);
  const leituras = await prisma.leitura.findMany({
    where: {
      deletedAt: null,
      tipo: 'ODOMETRO',
      veiculoId: { in: veiculoIds },
      medidoEm: { gte: desde, lte: agora },
    },
    select: { veiculoId: true, valor: true, medidoEm: true, origem: true },
    orderBy: { medidoEm: 'asc' },
  });

  const porVeiculo = new Map<string, Array<{ valor: string; medidoEm: Date; manual: boolean }>>();
  for (const l of leituras) {
    if (!l.veiculoId) continue;
    const lista = porVeiculo.get(l.veiculoId) ?? [];
    lista.push({ valor: l.valor.toString(), medidoEm: l.medidoEm, manual: ORIGENS_MANUAIS.has(l.origem) });
    porVeiculo.set(l.veiculoId, lista);
  }

  for (const id of veiculoIds) {
    const lista = porVeiculo.get(id) ?? [];
    const ultima = lista.length > 0 ? lista[lista.length - 1]!.medidoEm : null;
    const ritmo = ritmoPorDia(lista, janelaDias, agora);

    ritmos.set(id, {
      porDia: ritmo?.toFixed(1) ?? null,
      leituras: lista.length,
      ultimaEm: ultima?.toISOString() ?? null,
      diasSemLeitura: diasSemLeitura(ultima, agora),
    });
  }

  return ritmos;
}

/** Leituras que pedem olho humano: medidor que voltou ou saltou, ainda sem confirmacao. */
export async function leiturasSuspeitas(unidades: string[] = [], limite = 50) {
  return prisma.leitura.findMany({
    where: {
      deletedAt: null,
      suspeita: { not: null },
      confirmadaEm: null,
      ...(unidades.length > 0 ? { unidadeId: { in: unidades } } : {}),
    },
    include: {
      veiculo: { select: { placa: true, hodometroAtual: true } },
      equipamentoFrio: { select: { numeroSerie: true, marca: true, horimetro: true } },
    },
    orderBy: { medidoEm: 'desc' },
    take: limite,
  });
}
