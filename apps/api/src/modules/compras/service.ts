import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, StatusLote as StatusLotePrisma } from '@prisma/client';
import { db, novoId, prisma } from '../../core/db.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { notificar } from '../../core/notifications/index.js';
import { garantirSod } from '../../core/rbac/sod.enforce.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { centavos, dinheiro, paraBanco, somar } from '../../core/money.js';
import { validarTransicao, type StatusLote } from './state-machine.js';
import { aprovadorHabilitado, checarPropostasMinimas, decidirAlcada, type FaixaAlcada } from './alcada.js';
import { calcularSavings, ehEscolhaDivergente, montarRanking, type PropostaParaComparar } from './valor-presente.js';
import { somarHorasUteis } from './horas-uteis.js';
import { proximoNumero } from './numeracao.js';
import * as parametros from './parametros.js';

export interface Ator {
  usuarioId: string;
  ip?: string | null;
  userAgent?: string | null;
  /** unidade que o usuario declarou estar operacionalizando (secao 5.6) */
  unidadeId?: string | null;
  /** true para quem opera a rede inteira - Comprador e Administrador no seed */
  todasUnidades?: boolean;
  /** nomes dos perfis do usuario; a matriz de alcadas designa aprovador por perfil (secao 6.4) */
  perfis?: string[];
}

const requisicaoDe = (ator: Ator) => ({ ip: ator.ip ?? null, userAgent: ator.userAgent ?? null });

/**
 * Cancelar ou devolver registro de outra unidade responde 404 (secao 5.6):
 * quem nao alcanca o registro nao precisa saber que ele existe.
 */
function garantirUnidade(ator: Ator, unidadeId: string, recurso: string): void {
  if (!ator.todasUnidades && ator.unidadeId !== unidadeId) throw new NotFoundError(recurso);
}

// ------------------------------------------------------------------ solicitacao

export interface NovaSolicitacao {
  centroCustoId: string;
  /** material ou servico, escolhido por quem abre (secao 6.1.1) */
  tipo?: 'MATERIAL' | 'SERVICO';
  criticidade: 'P1' | 'P2' | 'P3' | 'P4';
  origemDemanda: string;
  dataLimite: Date;
  itens: Array<{
    itemId?: string | null;
    descricaoLivre?: string | null;
    quantidade: string;
    unidadeMedida: string;
    observacao?: string | null;
  }>;
}

export async function abrirSolicitacao(ator: Ator, entrada: NovaSolicitacao) {
  if (entrada.itens.length === 0) {
    throw new ValidationError('Informe ao menos um item na solicitacao.');
  }

  for (const item of entrada.itens) {
    if (!item.itemId && !item.descricaoLivre?.trim()) {
      throw new ValidationError('Cada item precisa vir do catalogo ou trazer uma descricao livre para homologacao.');
    }
    if (dinheiro(item.quantidade).lessThanOrEqualTo(0)) {
      throw new ValidationError('A quantidade precisa ser maior que zero.');
    }
  }

  // A unidade da solicitacao vem do centro de custo - e nao do que o cliente mandar.
  const centroCusto = await prisma.centroCusto.findFirst({
    where: { id: entrada.centroCustoId, deletedAt: null },
    select: { unidadeId: true },
  });
  if (!centroCusto) throw new NotFoundError('Centro de custo');
  if (ator.unidadeId && centroCusto.unidadeId !== ator.unidadeId) {
    throw new ValidationError('Este centro de custo pertence a outra unidade. Troque a unidade em operacao.');
  }

  const criada = await prisma.$transaction(async (tx) => {
    const numero = await proximoNumero(tx, 'SOL');
    const id = novoId();

    return tx.solicitacao.create({
      data: {
        id,
        numero,
        solicitanteId: ator.usuarioId,
        unidadeId: centroCusto.unidadeId,
        centroCustoId: entrada.centroCustoId,
        tipo: entrada.tipo ?? 'MATERIAL',
        criticidade: entrada.criticidade,
        origemDemanda: entrada.origemDemanda,
        dataLimite: entrada.dataLimite,
        status: 'ABERTA',
        createdBy: ator.usuarioId,
        itens: {
          create: entrada.itens.map((i) => ({
            id: novoId(),
            itemId: i.itemId ?? null,
            descricaoLivre: i.descricaoLivre ?? null,
            quantidade: i.quantidade,
            unidadeMedida: i.unidadeMedida,
            observacao: i.observacao ?? null,
          })),
        },
      },
      include: { itens: true },
    });
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'solicitacoes',
    entidadeId: criada.id,
    acao: 'ABRIR',
    valorNovo: { numero: criada.numero, tipo: criada.tipo, criticidade: criada.criticidade, itens: criada.itens.length },
  });

  return criada;
}

/** Regra de ouro 2: nao se exclui - cancela-se com motivo e trilha preservada. */
export async function cancelarSolicitacao(ator: Ator, solicitacaoId: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo do cancelamento para prosseguir.');

  const atual = await prisma.solicitacao.findFirst({ where: { id: solicitacaoId, deletedAt: null } });
  if (!atual) throw new NotFoundError('Solicitacao');
  garantirUnidade(ator, atual.unidadeId, 'Solicitacao');
  if (atual.status === 'CANCELADA') throw new ConflictError('Esta solicitacao ja esta cancelada.');
  if (atual.status === 'ATENDIDA') throw new ConflictError('Solicitacao ja atendida nao pode ser cancelada.');

  const cancelada = await db.solicitacao.update({
    where: { id: solicitacaoId },
    data: {
      status: 'CANCELADA',
      motivoCancelamento: texto,
      canceladaPor: ator.usuarioId,
      canceladaEm: new Date(),
      updatedBy: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'solicitacoes',
    entidadeId: solicitacaoId,
    acao: 'CANCELAR',
    valorAnterior: { status: atual.status },
    valorNovo: { status: 'CANCELADA', motivo: texto },
    severidade: 'ALERTA',
  });

  return cancelada;
}

/** Triagem: devolver ao solicitante suspende o SLA (secao 6.5). */
export async function devolverSolicitacao(ator: Ator, solicitacaoId: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo da devolucao para prosseguir.');

  const atual = await prisma.solicitacao.findFirst({ where: { id: solicitacaoId, deletedAt: null } });
  if (!atual) throw new NotFoundError('Solicitacao');
  garantirUnidade(ator, atual.unidadeId, 'Solicitacao');
  if (atual.loteId) throw new ConflictError('Solicitacao ja agrupada em lote nao pode ser devolvida.');

  const devolvida = await db.solicitacao.update({
    where: { id: solicitacaoId },
    data: { status: 'DEVOLVIDA', motivoDevolucao: texto, updatedBy: ator.usuarioId },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'solicitacoes',
    entidadeId: solicitacaoId,
    acao: 'DEVOLVER',
    valorAnterior: { status: atual.status },
    valorNovo: { status: 'DEVOLVIDA', motivo: texto },
  });

  return devolvida;
}

// ------------------------------------------------------------------ lote

/**
 * Agrupa solicitacoes em lote. O SLA nasce aqui, em horas uteis, a partir da
 * criticidade mais alta do conjunto (secao 6.5).
 */
export async function criarLote(ator: Ator, solicitacaoIds: string[]) {
  if (solicitacaoIds.length === 0) throw new ValidationError('Selecione ao menos uma solicitacao.');

  const solicitacoes = await prisma.solicitacao.findMany({
    where: { id: { in: solicitacaoIds }, deletedAt: null },
    include: { itens: true },
  });

  if (solicitacoes.length !== solicitacaoIds.length) throw new NotFoundError('Solicitacao');

  for (const s of solicitacoes) {
    garantirUnidade(ator, s.unidadeId, 'Solicitacao');
    if (s.loteId) throw new ConflictError(`Solicitacao ${s.numero} ja pertence a um lote.`);
    if (s.status === 'CANCELADA') throw new ConflictError(`Solicitacao ${s.numero} esta cancelada.`);
  }

  // SoD: quem abriu a solicitacao nao pode cota-la
  await garantirSod(
    {
      usuarioId: ator.usuarioId,
      acao: 'COTAR',
      solicitantesIds: solicitacoes.map((s) => s.solicitanteId),
      entidade: 'lotes',
      entidadeId: 'novo',
    },
    requisicaoDe(ator),
  );

  // Lote nao mistura unidades: o pedido, a alcada e o rateio do custo sao por unidade (secao 5.6).
  const unidades = [...new Set(solicitacoes.map((s) => s.unidadeId))];
  if (unidades.length > 1) {
    throw new ValidationError('As solicitacoes sao de unidades diferentes. Monte um lote por unidade.');
  }
  const unidadeId = unidades[0]!;

  /*
   * Lote nao mistura material e servico.
   *
   * Nao e preciosismo de cadastro: o lote vira um pedido, e um pedido fecha com um
   * documento fiscal. Material sai em NF-e com chave de 44 digitos; servico sai em NFS-e
   * municipal, que nao tem chave. Misturar obrigaria dois documentos no mesmo pedido, e o
   * three-way match nao teria contra o que conferir.
   */
  const tipos = [...new Set(solicitacoes.map((s) => s.tipo))];
  if (tipos.length > 1) {
    throw new ValidationError(
      'Ha solicitacoes de material e de servico no mesmo lote. Cada um fecha com um documento fiscal diferente — monte um lote para cada.',
    );
  }
  const tipo = tipos[0]!;

  const ordem = { P1: 0, P2: 1, P3: 2, P4: 3 } as const;
  const criticidade = solicitacoes
    .map((s) => s.criticidade)
    .sort((a, b) => ordem[a] - ordem[b])[0]!;

  const [slaPorCriticidade, cal] = await Promise.all([
    parametros.slaHorasPorCriticidade(),
    parametros.calendario(),
  ]);
  const horas = slaPorCriticidade[criticidade] ?? 40;
  const slaVenceEm = somarHorasUteis(new Date(), horas, cal);

  const lote = await prisma.$transaction(async (tx) => {
    const numero = await proximoNumero(tx, 'LOTE');
    const id = novoId();

    const criado = await tx.lote.create({
      data: {
        id,
        numero,
        compradorId: ator.usuarioId,
        unidadeId,
        tipo,
        status: 'TRIAGEM',
        criticidade,
        slaVenceEm,
        createdBy: ator.usuarioId,
      },
    });

    await tx.solicitacao.updateMany({
      where: { id: { in: solicitacaoIds } },
      data: { loteId: id, status: 'EM_LOTE', updatedBy: ator.usuarioId },
    });

    return criado;
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'lotes',
    entidadeId: lote.id,
    acao: 'CRIAR',
    valorNovo: { numero: lote.numero, tipo, criticidade, solicitacoes: solicitacaoIds.length, slaHoras: horas },
  });

  return lote;
}

/**
 * Unico caminho para alterar `lotes.status`. Valida pela maquina de estados,
 * grava a transicao no historico e audita. Nunca `UPDATE status` direto (secao 13).
 */
export async function transicionarLote(
  ator: Ator,
  loteId: string,
  para: StatusLote,
  motivo?: string | null,
  tx?: Prisma.TransactionClient,
) {
  const cliente = tx ?? prisma;
  const lote = await cliente.lote.findFirst({ where: { id: loteId, deletedAt: null } });
  if (!lote) throw new NotFoundError('Lote');

  const transicao = validarTransicao(lote.status as StatusLote, para, motivo);

  const atualizado = await cliente.lote.update({
    where: { id: loteId },
    data: {
      status: para as StatusLotePrisma,
      updatedBy: ator.usuarioId,
      ...(para === 'CANCELADO' ? { motivoCancelamento: transicao.motivo } : {}),
    },
  });

  await cliente.loteTransicao.create({
    data: {
      id: novoId(),
      loteId,
      de: transicao.de as StatusLotePrisma,
      para: transicao.para as StatusLotePrisma,
      motivo: transicao.motivo,
      usuarioId: ator.usuarioId,
    },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'lotes',
    entidadeId: loteId,
    acao: `TRANSICAO:${transicao.de}->${transicao.para}`,
    valorAnterior: { status: transicao.de },
    valorNovo: { status: transicao.para, motivo: transicao.motivo },
  });

  return atualizado;
}

// ------------------------------------------------------------------ cotacao

export async function abrirCotacoes(ator: Ator, loteId: string, fornecedorIds: string[]) {
  if (fornecedorIds.length === 0) throw new ValidationError('Selecione ao menos um fornecedor.');

  const lote = await prisma.lote.findFirst({
    where: { id: loteId, deletedAt: null },
    include: { solicitacoes: true },
  });
  if (!lote) throw new NotFoundError('Lote');

  await garantirSod(
    {
      usuarioId: ator.usuarioId,
      acao: 'COTAR',
      solicitantesIds: lote.solicitacoes.map((s) => s.solicitanteId),
      compradorId: lote.compradorId,
      entidade: 'lotes',
      entidadeId: loteId,
    },
    requisicaoDe(ator),
  );

  const fornecedores = await prisma.fornecedor.findMany({
    where: { id: { in: fornecedorIds }, deletedAt: null },
  });
  if (fornecedores.length !== fornecedorIds.length) throw new NotFoundError('Fornecedor');

  const bloqueado = fornecedores.find((f) => f.status === 'BLOQUEADO');
  if (bloqueado) throw new ConflictError(`Fornecedor ${bloqueado.razaoSocial} esta bloqueado.`);

  const criadas = await prisma.$transaction(
    fornecedorIds.map((fornecedorId) =>
      prisma.cotacao.create({
        data: {
          id: novoId(),
          loteId,
          fornecedorId,
          enviadaEm: new Date(),
          tokenPublico: randomBytes(24).toString('base64url'),
        },
      }),
    ),
  );

  if (lote.status === 'TRIAGEM') await transicionarLote(ator, loteId, 'EM_COTACAO');

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'lotes',
    entidadeId: loteId,
    acao: 'ENVIAR_RFQ',
    valorNovo: { fornecedores: fornecedorIds.length },
  });

  return criadas;
}

export interface RespostaCotacao {
  condicaoPagamento: string;
  prazoDias: number;
  descontoAvista?: string | null;
  freteTipo: 'CIF' | 'FOB';
  freteValor?: string | null;
  prazoEntregaDias: number;
  itens: Array<{ solicitacaoItemId: string; precoUnitario: string; quantidade: string; marcaOfertada?: string | null }>;
}

export async function registrarResposta(ator: Ator, cotacaoId: string, resposta: RespostaCotacao) {
  const cotacao = await prisma.cotacao.findFirst({ where: { id: cotacaoId, deletedAt: null } });
  if (!cotacao) throw new NotFoundError('Cotacao');
  if (cotacao.recusada) throw new ConflictError('Esta cotacao foi recusada pelo fornecedor.');
  // Resposta e registro unico: sobrescrever apagaria os precos originais, e apagar
  // linha de negocio e proibido. Correcao de proposta exige nova rodada de cotacao.
  if (cotacao.respondidaEm) {
    throw new ConflictError('Esta cotacao ja foi respondida. Abra uma nova rodada para registrar outro preco.');
  }
  if (resposta.itens.length === 0) throw new ValidationError('Informe o preco de ao menos um item.');

  /**
   * Evidencia da proposta (secao 6.1.5). O POP tratou "cotacao por WhatsApp sem
   * registro" como fragilidade: preco digitado sem comprovante e a palavra do
   * comprador, e seis meses depois ninguem lembra da conversa.
   *
   * E parametrizavel porque cotacao por telefone existe: quem quiser aceitar
   * proposta sem anexo desliga em `compras.exigir_evidencia_cotacao`, e a decisao
   * fica registrada como parametro, nao como excecao informal.
   */
  if (await parametros.exigirEvidenciaCotacao()) {
    const evidencias = await prisma.anexo.count({
      where: { entidade: 'cotacoes', entidadeId: cotacaoId, deletedAt: null },
    });
    if (evidencias === 0) {
      throw new ValidationError(
        'Anexe a evidencia da cotacao antes de registrar os precos: print, e-mail ou PDF do orcamento do fornecedor.',
      );
    }
  }

  const valorItens = somar(resposta.itens.map((i) => dinheiro(i.precoUnitario).times(dinheiro(i.quantidade))));
  const valorTotal = centavos(valorItens.plus(dinheiro(resposta.freteValor ?? 0)).minus(dinheiro(resposta.descontoAvista ?? 0)));

  const atualizada = await prisma.$transaction(async (tx) => {
    await tx.cotacaoItem.createMany({
      data: resposta.itens.map((i) => ({
        id: novoId(),
        cotacaoId,
        solicitacaoItemId: i.solicitacaoItemId,
        precoUnitario: i.precoUnitario,
        quantidade: i.quantidade,
        marcaOfertada: i.marcaOfertada ?? null,
      })),
    });

    return tx.cotacao.update({
      where: { id: cotacaoId },
      data: {
        respondidaEm: new Date(),
        condicaoPagamento: resposta.condicaoPagamento,
        prazoDias: resposta.prazoDias,
        descontoAvista: resposta.descontoAvista ?? null,
        freteTipo: resposta.freteTipo,
        freteValor: resposta.freteValor ?? null,
        prazoEntregaDias: resposta.prazoEntregaDias,
        valorTotal: paraBanco(valorTotal),
      },
    });
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'cotacoes',
    entidadeId: cotacaoId,
    acao: 'RESPONDER',
    valorNovo: { valorTotal: paraBanco(valorTotal), prazoDias: resposta.prazoDias },
  });

  return atualizada;
}

export async function recusarCotacao(ator: Ator, cotacaoId: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 3) throw new ValidationError('Informe o motivo da recusa.');

  const atualizada = await db.cotacao.update({
    where: { id: cotacaoId },
    data: { recusada: true, motivoRecusa: texto, respondidaEm: new Date() },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'cotacoes',
    entidadeId: cotacaoId,
    acao: 'RECUSAR',
    valorNovo: { motivo: texto },
  });

  return atualizada;
}

// ------------------------------------------------------------------ mapa de cotacao

/**
 * Gera o mapa comparando por valor presente e congela a memoria de calculo,
 * para que o numero possa ser auditado depois (secao 10.3).
 */
export async function gerarMapa(ator: Ator, loteId: string, cotacaoEscolhidaId?: string | null, justificativa?: string | null) {
  const lote = await prisma.lote.findFirst({
    where: { id: loteId, deletedAt: null },
    include: {
      solicitacoes: true,
      cotacoes: { where: { deletedAt: null }, include: { fornecedor: true, itens: true } },
    },
  });
  if (!lote) throw new NotFoundError('Lote');

  const respondidas = lote.cotacoes.filter((c) => c.respondidaEm && !c.recusada);
  if (respondidas.length === 0) throw new ValidationError('Nenhuma cotacao respondida para comparar.');

  const taxa = await parametros.taxaMensalValorPresente();

  const propostas: PropostaParaComparar[] = respondidas.map((c) => ({
    cotacaoId: c.id,
    fornecedorNome: c.fornecedor.razaoSocial,
    valorItens: somar(c.itens.map((i) => dinheiro(i.precoUnitario).times(dinheiro(i.quantidade)))),
    freteValor: c.freteValor?.toString() ?? null,
    descontoAvista: c.descontoAvista?.toString() ?? null,
    prazoDias: c.prazoDias ?? 0,
    prazoEntregaDias: c.prazoEntregaDias,
  }));

  const ranking = montarRanking(propostas, taxa);
  const recomendada = ranking[0]!;
  const escolhida = cotacaoEscolhidaId ?? recomendada.cotacaoId;

  if (!ranking.some((p) => p.cotacaoId === escolhida)) {
    throw new ValidationError('A cotacao escolhida nao esta entre as propostas comparadas.');
  }

  const divergente = ehEscolhaDivergente(ranking, escolhida);
  const seguiuRecomendacao = escolhida === recomendada.cotacaoId;

  /**
   * Regra de ouro 3: escolha divergente do menor preco exige justificativa registrada.
   *
   * Quando a escolha E a recomendacao automatica, quem divergiu do menor preco foi o
   * criterio de valor presente que o proprio spec manda usar (secao 6.1.6) - a justificativa
   * e a memoria de calculo, gravada abaixo, e o sistema a redige. Quando o comprador
   * sobrepoe a recomendacao, a decisao e humana e o texto tambem precisa ser.
   * Nos dois casos a divergencia e marcada e sobe um nivel de alcada.
   */
  let textoJustificativa = justificativa?.trim() ?? null;

  if (divergente && !seguiuRecomendacao && (textoJustificativa?.length ?? 0) < 10) {
    throw new ValidationError(
      'Escolha divergente do menor preco exige justificativa registrada com ao menos 10 caracteres.',
    );
  }

  if (divergente && seguiuRecomendacao && !textoJustificativa) {
    const menorFace = ranking.reduce((min, p) => (p.valorLiquido.lessThan(min.valorLiquido) ? p : min));
    textoJustificativa =
      `Recomendacao automatica por valor presente: ${recomendada.fornecedorNome} apresenta VP de ` +
      `R$ ${recomendada.valorPresente.toFixed(2)} em ${recomendada.prazoDias} dias, contra VP de ` +
      `R$ ${menorFace.valorPresente.toFixed(2)} do menor preco de face (${menorFace.fornecedorNome}, ` +
      `R$ ${menorFace.valorLiquido.toFixed(2)} em ${menorFace.prazoDias} dias). Taxa mensal aplicada: ${taxa}.`;
  }

  const valorEscolhido = ranking.find((p) => p.cotacaoId === escolhida)!.valorLiquido;
  const savings = calcularSavings(ranking, escolhida);

  const memoriaCalculo = {
    taxaMensal: String(taxa),
    formula: 'VP = valor_liquido / (1 + taxa_mensal) ^ (prazo_dias / 30)',
    geradoEm: new Date().toISOString(),
    propostas: ranking.map((p) => ({
      cotacaoId: p.cotacaoId,
      fornecedor: p.fornecedorNome,
      valorLiquido: p.valorLiquido.toFixed(2),
      prazoDias: p.prazoDias,
      valorPresente: p.valorPresente.toFixed(2),
      posicao: p.posicao,
      diferencaPercentual: p.diferencaPercentual.toFixed(4),
    })),
  };

  const mapa = await prisma.$transaction(async (tx) => {
    for (const p of ranking) {
      await tx.cotacao.update({ where: { id: p.cotacaoId }, data: { valorPresente: p.valorPresente.toFixed(2) } });
    }

    const criado = await tx.mapaCotacao.create({
      data: {
        id: novoId(),
        loteId,
        cotacaoRecomendadaId: recomendada.cotacaoId,
        cotacaoEscolhidaId: escolhida,
        taxaMensal: String(taxa),
        divergenteMenorPreco: divergente,
        justificativa: textoJustificativa,
        memoriaCalculo: memoriaCalculo as unknown as Prisma.InputJsonValue,
        createdBy: ator.usuarioId,
      },
    });

    await tx.lote.update({
      where: { id: loteId },
      data: { valorEstimado: paraBanco(valorEscolhido), savings: paraBanco(savings), updatedBy: ator.usuarioId },
    });

    return criado;
  });

  if (lote.status === 'EM_COTACAO') await transicionarLote(ator, loteId, 'MAPA_PRONTO');

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'mapas_cotacao',
    entidadeId: mapa.id,
    acao: 'GERAR',
    valorNovo: {
      recomendada: recomendada.cotacaoId,
      escolhida,
      divergente,
      justificativa: textoJustificativa,
      savings: savings.toFixed(2),
    },
    severidade: divergente ? 'ALERTA' : 'INFO',
  });

  return { mapa, ranking, divergente, savings };
}

// ------------------------------------------------------------------ alcada e aprovacao

async function faixasDoBanco(): Promise<FaixaAlcada[]> {
  const alcadas = await prisma.alcada.findMany({
    where: { ativo: true },
    include: { perfilAprovador: true },
    orderBy: { nivel: 'asc' },
  });
  return alcadas.map((a) => ({
    nivel: a.nivel,
    valorMin: a.valorMin.toString(),
    valorMax: a.valorMax?.toString() ?? null,
    perfilAprovador: a.perfilAprovador.nome,
    propostasMinimas: a.propostasMinimas,
    slaHoras: a.slaHoras,
  }));
}

/** Submete o lote a aprovacao: enquadra a alcada e confere o minimo de propostas. */
export async function submeterAprovacao(ator: Ator, loteId: string) {
  const lote = await prisma.lote.findFirst({
    where: { id: loteId, deletedAt: null },
    include: {
      cotacoes: { where: { deletedAt: null } },
      mapas: { orderBy: { geradoEm: 'desc' }, take: 1 },
    },
  });
  if (!lote) throw new NotFoundError('Lote');

  const mapa = lote.mapas[0];
  if (!mapa) throw new ValidationError('Gere o mapa de cotacao antes de submeter a aprovacao.');
  if (!lote.valorEstimado) throw new ValidationError('Lote sem valor apurado.');

  const faixas = await faixasDoBanco();
  const decisao = decidirAlcada(faixas, lote.valorEstimado.toString(), {
    escolhaDivergente: mapa.divergenteMenorPreco,
  });

  const respondidas = lote.cotacoes.filter((c) => c.respondidaEm && !c.recusada).length;
  const checagem = checarPropostasMinimas(decisao, respondidas);
  if (!checagem.suficiente) throw new ValidationError(checagem.mensagem!);

  await db.lote.update({ where: { id: loteId }, data: { nivelAlcada: decisao.nivel, updatedBy: ator.usuarioId } });
  await transicionarLote(ator, loteId, 'AGUARDANDO_APROVACAO');

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'lotes',
    entidadeId: loteId,
    acao: 'SUBMETER_APROVACAO',
    valorNovo: {
      nivel: decisao.nivel,
      nivelOriginal: decisao.nivelOriginal,
      elevadoPorDivergencia: decisao.elevadoPorDivergencia,
      aprovador: decisao.perfilAprovador,
      propostas: respondidas,
    },
  });

  return decisao;
}

export interface DecisaoDeAprovacao {
  decisao: 'APROVADO' | 'APROVADO_COM_RESSALVA' | 'DEVOLVIDO' | 'REPROVADO';
  ressalva?: string | null;
  motivo?: string | null;
}

/**
 * Aprovacao eletronica com identificacao, data/hora, IP e hash (secao 6.1.7).
 * A SoD e avaliada aqui: comprador nao aprova o proprio lote, salvo autoaprovacao de faixa 1.
 */
export async function decidirAprovacao(ator: Ator, loteId: string, entrada: DecisaoDeAprovacao) {
  const lote = await prisma.lote.findFirst({
    where: { id: loteId, deletedAt: null },
    include: { solicitacoes: true },
  });
  if (!lote) throw new NotFoundError('Lote');
  if (lote.status !== 'AGUARDANDO_APROVACAO') {
    throw new ConflictError('Este lote nao esta aguardando aprovacao.');
  }
  if (entrada.decisao === 'REPROVADO' && (entrada.motivo?.trim().length ?? 0) < 5) {
    throw new ValidationError('Informe o motivo da reprovacao para prosseguir.');
  }

  /*
   * A faixa manda em quem decide (secao 6.4).
   *
   * `lote:aprovar` diz que a pessoa aprova alguma coisa; a matriz diz o que. Sem esta
   * checagem a Gerencia, cujo teto e a faixa 3, decidia um lote de R$ 51.000 que a matriz
   * manda para a Diretoria — e a matriz virava sugestao.
   */
  const habilitacao = aprovadorHabilitado(await faixasDoBanco(), lote.nivelAlcada ?? 0, ator.perfis ?? []);
  if (!habilitacao.pode) throw new ForbiddenError(habilitacao.motivo ?? 'Seu perfil nao aprova esta faixa.');

  const resultadoSod = await garantirSod(
    {
      usuarioId: ator.usuarioId,
      acao: 'APROVAR',
      solicitantesIds: lote.solicitacoes.map((s) => s.solicitanteId),
      compradorId: lote.compradorId,
      nivelAlcada: lote.nivelAlcada,
      entidade: 'lotes',
      entidadeId: loteId,
    },
    requisicaoDe(ator),
  );

  const decididoEm = new Date();
  const conteudo = {
    loteId,
    aprovadorId: ator.usuarioId,
    nivel: lote.nivelAlcada ?? 0,
    decisao: entrada.decisao,
    decididoEm: decididoEm.toISOString(),
  };
  const hash = createHash('sha256').update(JSON.stringify(conteudo)).digest('hex');

  const aprovacao = await prisma.aprovacao.create({
    data: {
      id: novoId(),
      loteId,
      aprovadorId: ator.usuarioId,
      nivel: lote.nivelAlcada ?? 0,
      decisao: entrada.decisao,
      ressalva: entrada.ressalva?.trim() ?? null,
      motivo: entrada.motivo?.trim() ?? null,
      autoaprovacao: Boolean(resultadoSod.marcarAutoaprovacao),
      decididoEm,
      ip: ator.ip ?? null,
      hash,
    },
  });

  const destino: Record<DecisaoDeAprovacao['decisao'], StatusLote> = {
    APROVADO: 'APROVADO',
    APROVADO_COM_RESSALVA: 'APROVADO',
    DEVOLVIDO: 'EM_RENEGOCIACAO',
    REPROVADO: 'REPROVADO',
  };

  const motivoTransicao =
    entrada.decisao === 'APROVADO' || entrada.decisao === 'APROVADO_COM_RESSALVA'
      ? null
      : entrada.motivo ?? 'Devolvido para renegociacao';

  await transicionarLote(ator, loteId, destino[entrada.decisao], motivoTransicao);

  if (destino[entrada.decisao] === 'APROVADO') {
    await db.lote.update({
      where: { id: loteId },
      data: { aprovadorId: ator.usuarioId, aprovadoEm: decididoEm, updatedBy: ator.usuarioId },
    });
  }

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'aprovacoes',
    entidadeId: aprovacao.id,
    acao: `DECIDIR:${entrada.decisao}`,
    valorNovo: {
      loteId,
      nivel: aprovacao.nivel,
      autoaprovacao: aprovacao.autoaprovacao,
      ressalva: aprovacao.ressalva,
      motivo: aprovacao.motivo,
      hash,
    },
  });

  return aprovacao;
}

// ------------------------------------------------------------------ pedido

/** Emite o pedido a partir da cotacao escolhida no mapa. Alimenta OTIF pela data prometida. */
export async function emitirPedido(ator: Ator, loteId: string, dataPrometida: Date) {
  const lote = await prisma.lote.findFirst({
    where: { id: loteId, deletedAt: null },
    include: {
      mapas: { orderBy: { geradoEm: 'desc' }, take: 1 },
      solicitacoes: true,
    },
  });
  if (!lote) throw new NotFoundError('Lote');
  if (lote.status !== 'APROVADO') throw new ConflictError('Pedido so pode ser emitido para lote aprovado.');

  const mapa = lote.mapas[0];
  if (!mapa?.cotacaoEscolhidaId) throw new ValidationError('Lote sem cotacao escolhida.');

  const cotacao = await prisma.cotacao.findUnique({
    where: { id: mapa.cotacaoEscolhidaId },
    include: { itens: { include: { solicitacaoItem: { include: { item: true } } } }, fornecedor: true },
  });
  if (!cotacao) throw new NotFoundError('Cotacao escolhida');

  const valorTotal = centavos(
    somar(cotacao.itens.map((i) => dinheiro(i.precoUnitario).times(dinheiro(i.quantidade))))
      .plus(dinheiro(cotacao.freteValor?.toString() ?? 0))
      .minus(dinheiro(cotacao.descontoAvista?.toString() ?? 0)),
  );

  const pedido = await prisma.$transaction(async (tx) => {
    const numero = await proximoNumero(tx, 'PC');
    return tx.pedido.create({
      data: {
        id: novoId(),
        numero,
        loteId,
        fornecedorId: cotacao.fornecedorId,
        valorTotal: paraBanco(valorTotal),
        condicaoPagamento: cotacao.condicaoPagamento,
        dataPrometida,
        dataPrometidaOriginal: dataPrometida,
        status: 'EMITIDO',
        createdBy: ator.usuarioId,
        itens: {
          create: cotacao.itens.map((i) => ({
            id: novoId(),
            itemId: i.solicitacaoItem.itemId,
            descricao: i.solicitacaoItem.item?.descricao ?? i.solicitacaoItem.descricaoLivre ?? 'Item sem catalogo',
            quantidade: i.quantidade,
            precoUnitario: i.precoUnitario,
          })),
        },
      },
      include: { itens: true },
    });
  });

  await transicionarLote(ator, loteId, 'PEDIDO_EMITIDO');
  await db.lote.update({ where: { id: loteId }, data: { valorFechado: paraBanco(valorTotal) } });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'pedidos',
    entidadeId: pedido.id,
    acao: 'EMITIR',
    valorNovo: {
      numero: pedido.numero,
      fornecedor: cotacao.fornecedor.razaoSocial,
      valorTotal: paraBanco(valorTotal),
      dataPrometida: dataPrometida.toISOString(),
    },
  });

  return pedido;
}

/** Repactuacao mantem o atraso original no historico (secao 6.1.9). */
export async function reprogramarPedido(ator: Ator, pedidoId: string, novaData: Date, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo da reprogramacao para prosseguir.');

  const pedido = await prisma.pedido.findFirst({ where: { id: pedidoId, deletedAt: null } });
  if (!pedido) throw new NotFoundError('Pedido');

  const atualizado = await db.pedido.update({
    where: { id: pedidoId },
    data: { dataPrometida: novaData, dataReprogramada: novaData, motivoReprogramacao: texto },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'pedidos',
    entidadeId: pedidoId,
    acao: 'REPROGRAMAR',
    valorAnterior: {
      dataPrometida: pedido.dataPrometida.toISOString(),
      dataPrometidaOriginal: pedido.dataPrometidaOriginal.toISOString(),
    },
    valorNovo: { dataPrometida: novaData.toISOString(), motivo: texto },
    severidade: 'ALERTA',
  });

  return atualizado;
}

// ------------------------------------------------------------------ acoes rapidas do card

/** Nota rapida no card do Kanban. Nao se apaga - e registro de acompanhamento. */
export async function adicionarNota(ator: Ator, loteId: string, texto: string) {
  const conteudo = texto?.trim() ?? '';
  if (conteudo.length < 3) throw new ValidationError('Escreva a nota com ao menos 3 caracteres.');

  const lote = await prisma.lote.findFirst({ where: { id: loteId, deletedAt: null } });
  if (!lote) throw new NotFoundError('Lote');

  const nota = await prisma.loteNota.create({
    data: { id: novoId(), loteId, usuarioId: ator.usuarioId, texto: conteudo },
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'lotes',
    entidadeId: loteId,
    acao: 'ADICIONAR_NOTA',
    valorNovo: { notaId: nota.id },
  });

  return nota;
}

/** Reatribuir carteira: exige motivo e notifica quem recebe o lote. */
export async function reatribuirLote(ator: Ator, loteId: string, novoCompradorId: string, motivo: string) {
  const texto = motivo?.trim() ?? '';
  if (texto.length < 5) throw new ValidationError('Informe o motivo da reatribuicao para prosseguir.');

  const lote = await prisma.lote.findFirst({ where: { id: loteId, deletedAt: null } });
  if (!lote) throw new NotFoundError('Lote');
  if (lote.compradorId === novoCompradorId) {
    throw new ConflictError('O lote ja pertence a este comprador.');
  }

  const destino = await prisma.usuario.findFirst({
    where: { id: novoCompradorId, ativo: true, deletedAt: null },
  });
  if (!destino) throw new NotFoundError('Comprador');

  const atualizado = await db.lote.update({
    where: { id: loteId },
    data: { compradorId: novoCompradorId, updatedBy: ator.usuarioId },
  });

  await notificar({
    usuarioId: novoCompradorId,
    titulo: `Lote ${lote.numero} atribuido a voce`,
    corpo: `Motivo da reatribuicao: ${texto}`,
    entidade: 'lotes',
    entidadeId: loteId,
  });

  await registrarAuditoria({
    usuarioId: ator.usuarioId,
    ...requisicaoDe(ator),
    entidade: 'lotes',
    entidadeId: loteId,
    acao: 'REATRIBUIR',
    valorAnterior: { compradorId: lote.compradorId },
    valorNovo: { compradorId: novoCompradorId, motivo: texto },
    severidade: 'ALERTA',
  });

  return atualizado;
}
