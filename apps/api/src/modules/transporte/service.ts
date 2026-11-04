import type { Prisma } from '@prisma/client';
import { db, novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { notificarPorPermissao } from '../../core/notifications/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { paraBanco } from '../../core/money.js';
import type { Ator } from '../compras/service.js';
import { apurarAbastecimento, consumoMedioHistorico } from './abastecimento.js';
import { montarPainelDocumentos, type DocumentoParaConferir } from './documentos.js';
import { contarPneusCriticos } from './pneus.service.js';
import {
  movimentarTanque,
  prepararAbastecimentoInterno,
  registrarEncerrante,
} from './tanque.service.js';
import { turnoDe } from './tanque.js';

const requisicaoDe = (ator: Ator) => ({ ip: ator.ip ?? null, userAgent: ator.userAgent ?? null });

async function parametrosAnomalia() {
  const [desvio, janelas] = await Promise.all([
    prisma.parametro.findUnique({ where: { chave: 'frota.desvio_consumo_percentual' } }),
    prisma.parametro.findUnique({ where: { chave: 'frota.janela_minima_abastecimento_horas' } }),
  ]);
  return {
    desvioTolerado: String(desvio?.valor ?? 0.15),
    janelaMinimaHoras: Number(janelas?.valor ?? 2),
  };
}

export interface NovoAbastecimentoEntrada {
  veiculoId: string;
  motoristaId: string;
  dataHora: Date;
  posto: string;
  postoInterno?: boolean;
  tipoCombustivel: string;
  litros: string;
  valorUnitario: string;
  hodometro: string;
  horimetro?: string | null;
  formaPagamento?: string | null;
  numeroCartao?: string | null;
  justificativa?: string | null;
  fotoPainelId?: string | null;
  fotoCupomId?: string | null;
  /** identidade da linha do arquivo importado; impede gravar o mesmo abastecimento duas vezes (F10) */
  chaveImportacao?: string | null;

  // ---- F11: abastecimento no tanque proprio (secao 7.9)
  /** tanque de onde sai o combustivel; ausente = posto externo, sem baixa de estoque */
  tanqueId?: string | null;
  bicoId?: string | null;
  produtoId?: string | null;
  encerranteInicial?: string | null;
  encerranteFinal?: string | null;
  obraLocal?: string | null;
  rota?: string | null;
  turno?: string | null;
  osId?: string | null;
}

/**
 * Registra abastecimento com calculo de consumo e deteccao de anomalias (secao 7.2).
 * Anomalia nao impede o registro - o dado tem que existir para ser analisado.
 * A unica excecao e hodometro retrocedido, que exige justificativa.
 */
export async function registrarAbastecimento(ator: Ator, entrada: NovoAbastecimentoEntrada) {
  const veiculo = await prisma.veiculo.findFirst({ where: { id: entrada.veiculoId, deletedAt: null } });
  if (!veiculo) throw new NotFoundError('Veiculo');
  if (veiculo.status === 'VENDIDO' || veiculo.status === 'INATIVO') {
    throw new ConflictError(`Veiculo ${veiculo.placa} esta ${veiculo.status.toLowerCase()} e nao pode abastecer.`);
  }

  const motorista = await prisma.motorista.findFirst({ where: { id: entrada.motoristaId, deletedAt: null } });
  if (!motorista) throw new NotFoundError('Motorista');

  const anterior = await prisma.abastecimento.findFirst({
    where: { veiculoId: entrada.veiculoId, deletedAt: null },
    orderBy: { dataHora: 'desc' },
    select: { dataHora: true, hodometro: true },
  });

  const historico = await prisma.abastecimento.findMany({
    where: { veiculoId: entrada.veiculoId, deletedAt: null, consumoKml: { not: null } },
    orderBy: { dataHora: 'desc' },
    take: 20,
    select: { consumoKml: true },
  });

  const media = consumoMedioHistorico(historico.map((h) => h.consumoKml?.toString() ?? null));
  const parametros = await parametrosAnomalia();

  /**
   * Abastecimento no tanque proprio (F11): confere saldo e encerrante antes de
   * gravar, e o custo do litro passa a ser o custo medio do tanque - nao um valor
   * digitado. Abastecimento em posto externo segue como antes, com preco de bomba.
   */
  const interno = entrada.tanqueId
    ? await prepararAbastecimentoInterno(ator, {
        tanqueId: entrada.tanqueId,
        bicoId: entrada.bicoId,
        encerranteInicial: entrada.encerranteInicial,
        encerranteFinal: entrada.encerranteFinal,
        litros: entrada.litros,
      })
    : null;

  if (interno?.conferencia && !interno.conferencia.confere) {
    throw new ValidationError(
      `${interno.conferencia.mensagem} Confira a leitura da bomba ou o volume informado.`,
    );
  }

  // no tanque proprio quem manda no preco e o custo medio do estoque
  const valorUnitario = interno ? interno.custoUnitario : entrada.valorUnitario;

  const apurado = apurarAbastecimento(
    {
      dataHora: entrada.dataHora,
      litros: entrada.litros,
      valorUnitario,
      hodometro: entrada.hodometro,
    },
    {
      capacidadeTanque: veiculo.capacidadeTanque?.toString() ?? null,
      consumoMedioHistorico: media?.toString() ?? null,
      anterior: anterior ? { dataHora: anterior.dataHora, hodometro: anterior.hodometro.toString() } : null,
    },
    parametros,
  );

  if (apurado.exigeJustificativa && (entrada.justificativa?.trim().length ?? 0) < 5) {
    throw new ValidationError(
      'Hodometro menor que o do ultimo abastecimento. Informe a justificativa para prosseguir.',
    );
  }

  const registro = await prisma.$transaction(async (tx) => {
    const criado = await tx.abastecimento.create({
      data: {
        id: novoId(),
        veiculoId: entrada.veiculoId,
        motoristaId: entrada.motoristaId,
        dataHora: entrada.dataHora,
        posto: entrada.posto,
        postoInterno: entrada.postoInterno ?? Boolean(entrada.tanqueId),
        tipoCombustivel: entrada.tipoCombustivel,
        litros: entrada.litros,
        valorUnitario,
        tanqueId: entrada.tanqueId ?? null,
        bicoId: entrada.bicoId ?? null,
        produtoId: entrada.produtoId ?? interno?.tanque.produtoId ?? null,
        encerranteInicial: entrada.encerranteInicial ?? null,
        encerranteFinal: entrada.encerranteFinal ?? null,
        obraLocal: entrada.obraLocal ?? null,
        rota: entrada.rota ?? null,
        // o turno sai do horario quando nao vem informado: e recorte de relatorio, nao digitacao
        turno: entrada.turno ?? turnoDe(entrada.dataHora),
        osId: entrada.osId ?? null,
        valorTotal: paraBanco(apurado.valorTotal),
        hodometro: entrada.hodometro,
        horimetro: entrada.horimetro ?? null,
        formaPagamento: entrada.formaPagamento ?? null,
        numeroCartao: entrada.numeroCartao ?? null,
        kmPercorridos: apurado.kmPercorridos?.toFixed(1) ?? null,
        consumoKml: apurado.consumoKml?.toFixed(3) ?? null,
        custoPorKm: apurado.custoPorKm?.toFixed(4) ?? null,
        desvioPercentual: apurado.desvioPercentual?.toFixed(4) ?? null,
        anomalia: apurado.anomalia,
        anomaliaTipos: apurado.tipos as unknown as Prisma.InputJsonValue,
        justificativa: entrada.justificativa?.trim() ?? null,
        chaveImportacao: entrada.chaveImportacao ?? null,
        fotoPainelId: entrada.fotoPainelId ?? null,
        fotoCupomId: entrada.fotoCupomId ?? null,
        createdBy: ator.usuarioId,
      },
    });

    // a saida do tanque acontece na mesma transacao do abastecimento:
    // registro gravado com tanque intacto seria litro sumindo do controle
    if (entrada.tanqueId) {
      await movimentarTanque(
        ator,
        entrada.tanqueId,
        {
          tipo: 'SAIDA_ABASTECIMENTO',
          litros: entrada.litros,
          abastecimentoId: criado.id,
          data: entrada.dataHora,
          motivo: `Abastecimento do veiculo ${veiculo.placa}`,
        },
        tx,
      );

      if (entrada.bicoId && entrada.encerranteFinal) {
        await registrarEncerrante(entrada.bicoId, entrada.encerranteFinal, tx);
      }
    }

    // o hodometro do veiculo so avanca; retrocesso justificado nao rebaixa o cadastro
    if (apurado.kmPercorridos !== null || veiculo.hodometroAtual.lessThan(entrada.hodometro)) {
      await tx.veiculo.update({
        where: { id: entrada.veiculoId },
        data: { hodometroAtual: entrada.hodometro },
      });
    }

    return criado;
  });

  if (apurado.anomalia) {
    await notificarPorPermissao('veiculo:gerenciar', {
      titulo: `Anomalia de abastecimento: ${veiculo.placa}`,
      corpo: apurado.mensagens.join('\n'),
      entidade: 'abastecimentos',
      entidadeId: registro.id,
    });
  }

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'abastecimentos',
    entidadeId: registro.id,
    acao: 'REGISTRAR',
    valorNovo: {
      placa: veiculo.placa,
      litros: entrada.litros,
      valorTotal: paraBanco(apurado.valorTotal),
      consumoKml: apurado.consumoKml?.toFixed(3) ?? null,
      anomalias: apurado.tipos,
    },
    severidade: apurado.anomalia ? 'ALERTA' : 'INFO',
  });

  return { registro, apurado };
}

/**
 * Documentos de veiculos e motoristas em uma lista unica, para o painel e para o job.
 * `unidades` vazio significa rede inteira - e o caso do job diario.
 */
export async function carregarDocumentos(unidades: string[] = []): Promise<DocumentoParaConferir[]> {
  const recorte = unidades.length > 0 ? { unidadeId: { in: unidades } } : {};

  const [docsVeiculo, motoristas] = await Promise.all([
    prisma.veiculoDocumento.findMany({
      where: { deletedAt: null, veiculo: { deletedAt: null, status: { not: 'VENDIDO' }, ...recorte } },
      include: { veiculo: { select: { placa: true } } },
    }),
    prisma.motorista.findMany({
      where: { deletedAt: null, status: { not: 'INATIVO' }, ...recorte },
      select: { id: true, nome: true, cnhVencimento: true, toxicologicoVencimento: true, asoVencimento: true },
    }),
  ]);

  const lista: DocumentoParaConferir[] = docsVeiculo.map((d) => ({
    id: d.id,
    tipo: d.tipo,
    origem: 'veiculo',
    origemId: d.veiculoId,
    identificacao: d.veiculo.placa,
    vencimento: d.vencimento,
  }));

  for (const m of motoristas) {
    lista.push({
      id: `${m.id}:cnh`, tipo: 'CNH', origem: 'motorista', origemId: m.id,
      identificacao: m.nome, vencimento: m.cnhVencimento,
    });
    if (m.toxicologicoVencimento) {
      lista.push({
        id: `${m.id}:toxicologico`, tipo: 'Exame toxicologico', origem: 'motorista', origemId: m.id,
        identificacao: m.nome, vencimento: m.toxicologicoVencimento,
      });
    }
    if (m.asoVencimento) {
      lista.push({
        id: `${m.id}:aso`, tipo: 'ASO', origem: 'motorista', origemId: m.id,
        identificacao: m.nome, vencimento: m.asoVencimento,
      });
    }
  }

  return lista;
}

export async function painelDocumentos(unidades: string[] = [], agora = new Date()) {
  return montarPainelDocumentos(await carregarDocumentos(unidades), undefined, agora);
}

/**
 * Job diario: alerta consolidado de documentos vencendo (D-30/D-15/D-7) e vencidos.
 * Uma notificacao por varredura, como no alerta de estoque minimo.
 */
export async function alertarDocumentos(agora = new Date()) {
  const painel = await painelDocumentos([], agora);
  const criticos = painel.alertas.filter((a) => a.situacao !== 'REGULAR');
  if (criticos.length === 0) return { notificados: 0, criticos: 0 };

  const corpo = criticos.slice(0, 15).map((a) => a.mensagem).join('\n');
  const resto = criticos.length > 15 ? `\n... e mais ${criticos.length - 15} documentos.` : '';

  const notificados = await notificarPorPermissao('veiculo:gerenciar', {
    titulo: `${criticos.length} documentos exigem atencao`,
    corpo:
      `Vencidos: ${painel.vencidos} · Vencem hoje: ${painel.venceHoje} · Em alerta: ${painel.emAlerta}\n\n` +
      corpo + resto,
    entidade: 'frota',
    entidadeId: null,
  });

  return { notificados, criticos: criticos.length };
}

/**
 * Painel CCO (secao 7.7): status da frota, documentos e CNHs a vencer,
 * consumo do mes contra o mes anterior.
 */
export async function painelCco(unidades: string[] = [], agora = new Date()) {
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const inicioMesAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);

  // recorte por unidade: direto no veiculo, ou pela relacao quando a tabela nao tem unidade propria
  const recorte = unidades.length > 0 ? { unidadeId: { in: unidades } } : {};
  const recorteVeiculo = unidades.length > 0 ? { veiculo: { unidadeId: { in: unidades } } } : {};

  const [veiculos, documentos, mesAtual, mesAnterior, anomaliasAbertas, pneusCriticos] = await Promise.all([
    prisma.veiculo.groupBy({ by: ['status'], where: { deletedAt: null, ...recorte }, _count: true }),
    painelDocumentos(unidades, agora),
    prisma.abastecimento.aggregate({
      where: { deletedAt: null, ...recorteVeiculo, dataHora: { gte: inicioMes } },
      _sum: { valorTotal: true, litros: true, kmPercorridos: true },
      _count: true,
    }),
    prisma.abastecimento.aggregate({
      where: { deletedAt: null, ...recorteVeiculo, dataHora: { gte: inicioMesAnterior, lt: inicioMes } },
      _sum: { valorTotal: true, litros: true, kmPercorridos: true },
    }),
    prisma.abastecimento.count({
      where: { deletedAt: null, ...recorteVeiculo, anomalia: true, dataHora: { gte: inicioMes } },
    }),
    contarPneusCriticos(unidades),
  ]);

  const consumo = (soma: { kmPercorridos: unknown; litros: unknown }): string | null => {
    const km = Number(soma.kmPercorridos ?? 0);
    const litros = Number(soma.litros ?? 0);
    return litros > 0 ? (km / litros).toFixed(3) : null;
  };

  return {
    frota: Object.fromEntries(veiculos.map((v) => [v.status, v._count])),
    documentos: {
      vencidos: documentos.vencidos,
      venceHoje: documentos.venceHoje,
      emAlerta: documentos.emAlerta,
      // o painel lista so o que exige acao
      lista: documentos.alertas.filter((a) => a.situacao !== 'REGULAR').slice(0, 20),
    },
    abastecimento: {
      mesAtual: {
        registros: mesAtual._count,
        valorTotal: (mesAtual._sum.valorTotal ?? 0).toString(),
        litros: (mesAtual._sum.litros ?? 0).toString(),
        consumoMedioKml: consumo(mesAtual._sum),
      },
      mesAnterior: {
        valorTotal: (mesAnterior._sum.valorTotal ?? 0).toString(),
        litros: (mesAnterior._sum.litros ?? 0).toString(),
        consumoMedioKml: consumo(mesAnterior._sum),
      },
      anomaliasNoMes: anomaliasAbertas,
    },
    /*
     * O contador de "veiculos sem checklist hoje" saiu com o modulo (ADR 0024). Nao foi
     * substituido por um numero parecido: quem responde "o que precisa entrar no box" agora
     * e o patio do plano de manutencao, com a regua de severidade e a fila por score.
     */
    pendentes: { pneusCriticos },
  };
}

export async function justificarAnomalia(ator: Ator, abastecimentoId: string, justificativa: string) {
  const texto = justificativa?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe a justificativa com ao menos 5 caracteres.');

  const abastecimento = await prisma.abastecimento.findFirst({
    where: { id: abastecimentoId, deletedAt: null },
  });
  if (!abastecimento) throw new NotFoundError('Abastecimento');
  if (!abastecimento.anomalia) throw new ConflictError('Este abastecimento nao tem anomalia a justificar.');

  const atualizado = await db.abastecimento.update({
    where: { id: abastecimentoId },
    data: { justificativa: texto },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'abastecimentos',
    entidadeId: abastecimentoId,
    acao: 'JUSTIFICAR_ANOMALIA',
    valorNovo: { justificativa: texto, anomalias: abastecimento.anomaliaTipos },
  });

  return atualizado;
}

/**
 * Agenda do dia (secao 7.2): abastecimentos lancados na data de referencia, para o
 * gestor de frota conferir e confirmar. `dataRef` e a data local do pedido, nao UTC -
 * o dia do gestor comeca as 00h dele, nao as 00h de Greenwich.
 */
export async function listarAgendaDoDia(dataRef: Date, unidades: string[] = []) {
  const inicio = new Date(dataRef);
  inicio.setHours(0, 0, 0, 0);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 1);

  const itens = await prisma.abastecimento.findMany({
    where: {
      deletedAt: null,
      dataHora: { gte: inicio, lt: fim },
      ...(unidades.length > 0 ? { veiculo: { unidadeId: { in: unidades } } } : {}),
    },
    include: {
      veiculo: { select: { placa: true, frotaNumero: true } },
      motorista: { select: { nome: true } },
    },
    orderBy: { dataHora: 'asc' },
  });

  return {
    data: inicio.toISOString().slice(0, 10),
    total: itens.length,
    confirmados: itens.filter((i) => i.confirmado).length,
    itens,
  };
}

/**
 * Confirma (ou desfaz a confirmacao de) um abastecimento na agenda do dia.
 * Idempotente de proposito: marcar duas vezes o mesmo estado nao e erro, e o checkbox
 * da tela precisa poder ligar e desligar sem um caminho de excecao para cada sentido.
 */
export async function confirmarAbastecimento(ator: Ator, abastecimentoId: string, confirmado: boolean) {
  const abastecimento = await prisma.abastecimento.findFirst({
    where: { id: abastecimentoId, deletedAt: null },
  });
  if (!abastecimento) throw new NotFoundError('Abastecimento');

  const atualizado = await db.abastecimento.update({
    where: { id: abastecimentoId },
    data: confirmado
      ? { confirmado: true, confirmadoEm: new Date(), confirmadoPor: ator.usuarioId }
      : { confirmado: false, confirmadoEm: null, confirmadoPor: null },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'abastecimentos',
    entidadeId: abastecimentoId,
    acao: confirmado ? 'CONFIRMAR_ABASTECIMENTO' : 'DESCONFIRMAR_ABASTECIMENTO',
    valorAnterior: { confirmado: abastecimento.confirmado },
    valorNovo: { confirmado },
  });

  return atualizado;
}
