import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { novoId, prisma } from '../../core/db.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { atorDe } from '../../core/rbac/ator.js';
import { filtroUnidade, escopoDe } from '../../core/rbac/escopo.js';
import { ForbiddenError, NotFoundError } from '../../core/errors/index.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { cobrarFornecedor } from '../../core/notifications/index.js';
import * as servico from './service.js';
import * as evidencias from './evidencias.service.js';
import * as aprovacao from './aprovacao.service.js';
import * as pedidoPdf from './pedido-pdf.service.js';
import * as notaFiscal from './nota-fiscal.service.js';
import * as recebimento_ from './recebimento.service.js';
import * as s from './schemas.js';
import { montarPainel } from './kanban.service.js';
import { arrastoNoBoard, transicoesValidas, type StatusLote } from './state-machine.js';

/**
 * Autoriza o movimento do card pelo destino.
 *
 * A permissao nao pode ser resolvida no `preHandler` porque depende do corpo da requisicao:
 * so lendo `para` se sabe se o movimento e "mandar cotar" ou "aprovar". Por isso a checagem
 * mora aqui e roda antes da maquina de estados.
 *
 * A negativa e auditada como qualquer outra, com severidade de alerta: tentar aprovar
 * arrastando e exatamente o que a trilha precisa registrar.
 */
async function garantirArrasto(req: FastifyRequest, para: StatusLote): Promise<void> {
  const decisao = arrastoNoBoard(para);
  const usuario = usuarioDe(req);
  const permitido = decisao.permitido && usuario.permissoes.includes(decisao.exige);
  if (permitido) return;

  await registrarAuditoria({
    usuarioId: usuario.sub,
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
    entidade: 'autorizacao',
    entidadeId: null,
    acao: `NEGADO:${req.method} ${req.url}`,
    valorNovo: decisao.permitido ? { destino: para, exigida: decisao.exige } : { destino: para, motivo: decisao.motivo },
    severidade: 'ALERTA',
  });

  throw new ForbiddenError(decisao.permitido ? 'Seu perfil nao permite esta acao.' : decisao.motivo);
}

/** Paginacao por cursor, filtros e ordenacao sempre no servidor (secao 13). */
function paginar<T extends { id: string }>(itens: T[], limite: number) {
  const temProxima = itens.length > limite;
  const pagina = temProxima ? itens.slice(0, limite) : itens;
  return { itens: pagina, proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null };
}

export const comprasRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------- painel kanban
  app.get('/painel', { preHandler: [app.autenticar, app.exigirPermissao('lote:consultar')] }, async (req) => {
    const filtros = s.painelSchema.parse(req.query);
    const usuario = usuarioDe(req);
    const escopo = escopoDe(usuario);
    return montarPainel(
      { sub: usuario.sub, perfis: usuario.perfis },
      // quem ve todas as unidades enxerga o board inteiro; os demais, so a unidade ativa
      { ...filtros, unidades: escopo.todas ? [] : escopo.ativa ? [escopo.ativa] : escopo.permitidas },
    );
  });

  /**
   * Drop no board.
   *
   * `lote:consultar` abre o painel; nao move nada nele. Cada destino cobra a mesma
   * permissao que a tela do lote cobraria, e os destinos que tem ato proprio — aprovar,
   * reprovar, emitir pedido, receber, lancar NF — sao recusados aqui com o caminho certo
   * na mensagem. Antes desta checagem, arrastar era um atalho que pulava a alcada, a SoD
   * e a propria permissao de aprovar.
   */
  app.post('/painel/mover', { preHandler: [app.autenticar, app.exigirPermissao('lote:consultar')] }, async (req) => {
    const { loteId, para, motivo } = s.moverCardSchema.parse(req.body);
    await garantirArrasto(req, para as StatusLote);
    const lote = await servico.transicionarLote(atorDe(req), loteId, para as StatusLote, motivo);
    return { id: lote.id, status: lote.status };
  });

  app.post('/lotes/:id/nota', { preHandler: [app.autenticar, app.exigirPermissao('lote:consultar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { texto } = s.notaSchema.parse(req.body);
    const nota = await servico.adicionarNota(atorDe(req), id, texto);
    return reply.status(201).send(nota);
  });

  app.get('/lotes/:id/notas', { preHandler: [app.autenticar, app.exigirPermissao('lote:consultar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const itens = await prisma.loteNota.findMany({
      where: { loteId: id },
      include: { usuario: { select: { nome: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { itens };
  });

  app.post('/lotes/:id/reatribuir', { preHandler: [app.autenticar, app.exigirPermissao('lote:reatribuir')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { compradorId, motivo } = s.reatribuirSchema.parse(req.body);
    return servico.reatribuirLote(atorDe(req), id, compradorId, motivo);
  });

  app.post('/lotes/:id/cobrar', { preHandler: [app.autenticar, app.exigirPermissao('cotacao:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    return cobrarFornecedor(atorDe(req), id);
  });

  // ---------------------------------------------------------------- catalogo
  app.get('/itens', { preHandler: [app.autenticar, app.exigirPermissao('solicitacao:consultar')] }, async (req) => {
    const { cursor, limite, busca } = s.listagemSchema.parse(req.query);
    const itens = await prisma.item.findMany({
      where: {
        deletedAt: null,
        ...(busca ? { OR: [{ descricao: { contains: busca, mode: 'insensitive' } }, { codigo: { contains: busca, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return paginar(itens, limite);
  });

  app.post('/itens', { preHandler: [app.autenticar, app.exigirPermissao('item:gerenciar')] }, async (req, reply) => {
    const dados = s.novoItemSchema.parse(req.body);
    const ator = atorDe(req);
    // Item novo entra por fila de homologacao, nunca ja homologado (secao 6.1.1)
    const item = await prisma.item.create({
      data: { id: novoId(), ...dados, statusHomologacao: 'EM_ANALISE', createdBy: ator.usuarioId },
    });
    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'itens', entidadeId: item.id, acao: 'CRIAR', valorNovo: { codigo: item.codigo },
    });
    return reply.status(201).send(item);
  });

  app.post('/itens/:id/homologar', { preHandler: [app.autenticar, app.exigirPermissao('item:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const ator = atorDe(req);
    const item = await prisma.item.update({
      where: { id },
      data: { statusHomologacao: 'HOMOLOGADO', updatedBy: ator.usuarioId },
    });
    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'itens', entidadeId: id, acao: 'HOMOLOGAR',
    });
    return item;
  });

  // ---------------------------------------------------------------- fornecedores
  app.get('/fornecedores', { preHandler: [app.autenticar, app.exigirPermissao('solicitacao:consultar')] }, async (req) => {
    const { cursor, limite, busca, status } = s.listagemSchema.parse(req.query);
    const itens = await prisma.fornecedor.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status: status as never } : {}),
        ...(busca ? { razaoSocial: { contains: busca, mode: 'insensitive' } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return paginar(itens, limite);
  });

  app.post('/fornecedores', { preHandler: [app.autenticar, app.exigirPermissao('fornecedor:gerenciar')] }, async (req, reply) => {
    const dados = s.novoFornecedorSchema.parse(req.body);
    const ator = atorDe(req);
    const fornecedor = await prisma.fornecedor.create({
      data: { id: novoId(), ...dados, status: 'EM_ANALISE', createdBy: ator.usuarioId },
    });
    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'fornecedores', entidadeId: fornecedor.id, acao: 'CRIAR', valorNovo: { cnpj: fornecedor.cnpj },
    });
    return reply.status(201).send(fornecedor);
  });

  app.post('/fornecedores/:id/homologar', { preHandler: [app.autenticar, app.exigirPermissao('fornecedor:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const ator = atorDe(req);
    const validade = new Date();
    validade.setFullYear(validade.getFullYear() + 1);
    const fornecedor = await prisma.fornecedor.update({
      where: { id },
      data: { status: 'HOMOLOGADO', homologadoEm: new Date(), homologacaoValidaAte: validade, updatedBy: ator.usuarioId },
    });
    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'fornecedores', entidadeId: id, acao: 'HOMOLOGAR',
      valorNovo: { validaAte: validade.toISOString() },
    });
    return fornecedor;
  });

  // ---------------------------------------------------------------- solicitacoes
  app.post('/solicitacoes', { preHandler: [app.autenticar, app.exigirPermissao('solicitacao:criar')] }, async (req, reply) => {
    const dados = s.novaSolicitacaoSchema.parse(req.body);
    const criada = await servico.abrirSolicitacao(atorDe(req), {
      ...dados,
      itens: dados.itens.map((i) => ({ ...i, itemId: i.itemId ?? null, descricaoLivre: i.descricaoLivre ?? null, observacao: i.observacao ?? null })),
    });
    return reply.status(201).send(criada);
  });

  app.get('/solicitacoes', { preHandler: [app.autenticar, app.exigirPermissao('solicitacao:consultar')] }, async (req) => {
    const { cursor, limite, status, criticidade, apenasMeus, unidadeId } = s.listagemSchema.parse(req.query);
    const usuario = usuarioDe(req);
    const itens = await prisma.solicitacao.findMany({
      where: {
        deletedAt: null,
        ...filtroUnidade(usuario, unidadeId),
        ...(status ? { status: status as never } : {}),
        ...(criticidade ? { criticidade } : {}),
        ...(apenasMeus ? { solicitanteId: usuario.sub } : {}),
      },
      include: { itens: true, centroCusto: { select: { codigo: true, nome: true } } },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return paginar(itens, limite);
  });

  app.get('/solicitacoes/:id', { preHandler: [app.autenticar, app.exigirPermissao('solicitacao:consultar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const solicitacao = await prisma.solicitacao.findFirst({
      where: { id, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      include: { itens: { include: { item: true } }, centroCusto: true, solicitante: { select: { nome: true } }, lote: true },
    });
    if (!solicitacao) throw new NotFoundError('Solicitacao');
    return solicitacao;
  });

  app.post('/solicitacoes/:id/cancelar', { preHandler: [app.autenticar, app.exigirPermissao('solicitacao:cancelar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { motivo } = s.motivoSchema.parse(req.body);
    return servico.cancelarSolicitacao(atorDe(req), id, motivo);
  });

  app.post('/solicitacoes/:id/devolver', { preHandler: [app.autenticar, app.exigirPermissao('solicitacao:triar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { motivo } = s.motivoSchema.parse(req.body);
    return servico.devolverSolicitacao(atorDe(req), id, motivo);
  });

  // ---------------------------------------------------------------- lotes
  app.post('/lotes', { preHandler: [app.autenticar, app.exigirPermissao('lote:criar')] }, async (req, reply) => {
    const { solicitacaoIds } = s.novoLoteSchema.parse(req.body);
    const lote = await servico.criarLote(atorDe(req), solicitacaoIds);
    return reply.status(201).send(lote);
  });

  app.get('/lotes', { preHandler: [app.autenticar, app.exigirPermissao('lote:consultar')] }, async (req) => {
    const { cursor, limite, status, criticidade, apenasMeus, unidadeId } = s.listagemSchema.parse(req.query);
    const usuario = usuarioDe(req);
    const itens = await prisma.lote.findMany({
      where: {
        deletedAt: null,
        ...filtroUnidade(usuario, unidadeId),
        ...(status ? { status: status as never } : {}),
        ...(criticidade ? { criticidade } : {}),
        ...(apenasMeus ? { compradorId: usuario.sub } : {}),
      },
      include: {
        solicitacoes: { select: { id: true, numero: true } },
        comprador: { select: { nome: true } },
        _count: { select: { cotacoes: true } },
      },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return paginar(itens, limite);
  });

  app.get('/lotes/:id', { preHandler: [app.autenticar, app.exigirPermissao('lote:consultar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const lote = await prisma.lote.findFirst({
      where: { id, deletedAt: null, ...filtroUnidade(usuarioDe(req)) },
      include: {
        solicitacoes: { include: { itens: true } },
        cotacoes: { include: { fornecedor: { select: { razaoSocial: true } }, itens: true } },
        mapas: { orderBy: { geradoEm: 'desc' } },
        aprovacoes: { include: { aprovador: { select: { nome: true } } } },
        pedidos: {
          include: {
            itens: true,
            // a etapa fiscal vive na tela do lote: sem os recebimentos ela nao tem o que mostrar
            recebimentos: {
              where: { deletedAt: null },
              include: { almoxarife: { select: { nome: true } }, titulos: { where: { deletedAt: null } } },
              orderBy: { recebidoEm: 'asc' },
            },
          },
        },
        transicoes: { orderBy: { createdAt: 'asc' } },
        comprador: { select: { nome: true } },
      },
    });
    if (!lote) throw new NotFoundError('Lote');
    return {
      ...lote,
      transicoesPossiveis: transicoesValidas(lote.status as StatusLote),
      // permissao + faixa + SoD, para a tela habilitar o botao em vez de deixar falhar no clique
      aprovacaoDisponivel: await aprovacao.situacaoDaAprovacao(lote, usuarioDe(req)),
      // quantas evidencias cada cotacao tem: a tela mostra sem uma chamada por cotacao
      evidenciasPorCotacao: await evidencias.contarEvidenciasDoLote(lote.id),
    };
  });

  /** Mesma porta do drop no board, pela tela do lote — logo, mesma checagem. */
  app.post('/lotes/:id/transicao', { preHandler: [app.autenticar, app.exigirPermissao('lote:consultar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { para, motivo } = s.transicaoSchema.parse(req.body);
    await garantirArrasto(req, para as StatusLote);
    return servico.transicionarLote(atorDe(req), id, para as StatusLote, motivo);
  });

  // ---------------------------------------------------------------- cotacoes
  app.post('/lotes/:id/cotacoes', { preHandler: [app.autenticar, app.exigirPermissao('cotacao:gerenciar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { fornecedorIds } = s.abrirCotacoesSchema.parse(req.body);
    const criadas = await servico.abrirCotacoes(atorDe(req), id, fornecedorIds);
    return reply.status(201).send({ itens: criadas });
  });

  app.post('/cotacoes/:id/resposta', { preHandler: [app.autenticar, app.exigirPermissao('cotacao:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const dados = s.respostaCotacaoSchema.parse(req.body);
    return servico.registrarResposta(atorDe(req), id, {
      ...dados,
      descontoAvista: dados.descontoAvista ?? null,
      freteValor: dados.freteValor ?? null,
      itens: dados.itens.map((i) => ({ ...i, marcaOfertada: i.marcaOfertada ?? null })),
    });
  });

  /**
   * Evidencia da cotacao (secao 6.1.5): print, e-mail ou PDF do orcamento.
   *
   * Conteudo em base64 no corpo, como na foto do checklist: o cliente ja tem o
   * arquivo em memoria e evita-se dependencia de multipart so para isto.
   */
  app.post('/cotacoes/:id/evidencias', {
    preHandler: [app.autenticar, app.exigirPermissao('cotacao:gerenciar')],
    // orcamento em PDF passa folgado dos 100 KB padrao do Fastify
    bodyLimit: 12 * 1024 * 1024,
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dados = s.evidenciaCotacaoSchema.parse(req.body);

    const r = await evidencias.anexarEvidencia(atorDe(req), id, {
      conteudo: Buffer.from(dados.conteudoBase64, 'base64'),
      mime: dados.mime,
      nome: dados.nome,
      descricao: dados.descricao ?? null,
    });

    return reply.status(r.duplicada ? 200 : 201).send(r);
  });

  app.get('/cotacoes/:id/evidencias', { preHandler: [app.autenticar, app.exigirPermissao('lote:consultar')] }, async (req) => ({
    itens: await evidencias.evidenciasDaCotacao(atorDe(req), (req.params as { id: string }).id),
  }));

  app.post('/evidencias/:id/remover', { preHandler: [app.autenticar, app.exigirPermissao('cotacao:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { motivo } = s.motivoSchema.parse(req.body);
    return evidencias.removerEvidencia(atorDe(req), id, motivo);
  });

  app.post('/cotacoes/:id/recusa', { preHandler: [app.autenticar, app.exigirPermissao('cotacao:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { motivo } = s.motivoSchema.parse(req.body);
    return servico.recusarCotacao(atorDe(req), id, motivo);
  });

  // ---------------------------------------------------------------- mapa
  app.post('/lotes/:id/mapa', { preHandler: [app.autenticar, app.exigirPermissao('mapa:gerar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { cotacaoEscolhidaId, justificativa } = s.gerarMapaSchema.parse(req.body ?? {});
    const { mapa, ranking, divergente, savings } = await servico.gerarMapa(atorDe(req), id, cotacaoEscolhidaId, justificativa);
    return reply.status(201).send({
      mapa,
      divergenteMenorPreco: divergente,
      savings: savings.toFixed(2),
      ranking: ranking.map((p) => ({
        cotacaoId: p.cotacaoId,
        fornecedor: p.fornecedorNome,
        valorLiquido: p.valorLiquido.toFixed(2),
        prazoDias: p.prazoDias,
        valorPresente: p.valorPresente.toFixed(2),
        posicao: p.posicao,
        diferencaPercentual: p.diferencaPercentual.toFixed(4),
      })),
    });
  });

  // ---------------------------------------------------------------- aprovacao
  app.post('/lotes/:id/submeter', { preHandler: [app.autenticar, app.exigirPermissao('mapa:gerar')] }, async (req) => {
    const { id } = req.params as { id: string };
    return servico.submeterAprovacao(atorDe(req), id);
  });

  /**
   * Mesa do aprovador: a fila do que espera decisao, ja com o centro de custo
   * e a placa que cada lote vai onerar (secao 6.1.7).
   */
  app.get('/aprovacoes/fila', { preHandler: [app.autenticar, app.exigirPermissao('lote:aprovar')] }, async (req) => {
    const filtros = s.filaAprovacaoSchema.parse(req.query);
    return aprovacao.filaDeAprovacao(usuarioDe(req), {
      unidadeId: filtros.unidadeId ?? null,
      centroCustoId: filtros.centroCustoId ?? null,
      cursor: filtros.cursor ?? null,
      limite: filtros.limite,
    });
  });

  /** Historico de compras da placa que o lote vai onerar - o contexto da decisao. */
  app.get('/centros-custo/:id/historico', { preHandler: [app.autenticar, app.exigirPermissao('lote:consultar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const filtros = s.historicoCentroCustoSchema.parse(req.query);
    return aprovacao.historicoDoCentroCusto(usuarioDe(req), id, {
      meses: filtros.meses,
      unidadeId: filtros.unidadeId ?? null,
    });
  });

  app.post('/lotes/:id/aprovacao', { preHandler: [app.autenticar, app.exigirPermissao('lote:aprovar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dados = s.decisaoAprovacaoSchema.parse(req.body);
    const aprovacao = await servico.decidirAprovacao(atorDe(req), id, dados);
    return reply.status(201).send(aprovacao);
  });

  // ---------------------------------------------------------------- pedido
  app.post('/lotes/:id/pedido', { preHandler: [app.autenticar, app.exigirPermissao('pedido:emitir')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { dataPrometida } = s.emitirPedidoSchema.parse(req.body);
    const pedido = await servico.emitirPedido(atorDe(req), id, dataPrometida);
    return reply.status(201).send(pedido);
  });

  /**
   * Pedido de compra em PDF (secao 6.1.8).
   *
   * O fornecedor nao entra no sistema: o que chega nele e este anexo. O documento carrega a
   * prova da aprovacao — quem aprovou, quando, em que faixa e o hash da assinatura — para o
   * recebimento e a entrada fiscal conferirem contra o mesmo papel.
   */
  app.get('/pedidos/:id/pdf', { preHandler: [app.autenticar, app.exigirPermissao('pedido:consultar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { nome, conteudo } = await pedidoPdf.pdfDoPedido(usuarioDe(req), id);

    // documento que sai da casa e evidencia: quem baixou e quando fica na trilha
    const ator = atorDe(req);
    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'pedidos', entidadeId: id, acao: 'EXPORTAR:PDF',
    });

    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${nome}"`)
      .send(conteudo);
  });

  app.get('/pedidos', { preHandler: [app.autenticar, app.exigirPermissao('pedido:consultar')] }, async (req) => {
    const { cursor, limite, status } = s.listagemSchema.parse(req.query);
    const itens = await prisma.pedido.findMany({
      where: { deletedAt: null, ...(status ? { status: status as never } : {}) },
      include: { fornecedor: { select: { razaoSocial: true } }, itens: true, lote: { select: { numero: true } } },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return paginar(itens, limite);
  });

  app.post('/pedidos/:id/reprogramar', { preHandler: [app.autenticar, app.exigirPermissao('pedido:emitir')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { dataPrometida, motivo } = s.reprogramarPedidoSchema.parse(req.body);
    return servico.reprogramarPedido(atorDe(req), id, dataPrometida, motivo);
  });

  // ---------------------------------------------------------------- recebimento (three-way match)
  app.post('/pedidos/:id/recebimento', { preHandler: [app.autenticar, app.exigirPermissao('recebimento:registrar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dados = s.recebimentoSchema.parse(req.body);
    const { recebimento, match } = await recebimento_.registrarRecebimento(atorDe(req), id, {
      ...dados,
      itens: dados.itens.map((i) => ({
        ...i,
        precoNotaFiscal: i.precoNotaFiscal ?? null,
        divergenciaManual: i.divergenciaManual ?? null,
        observacao: i.observacao ?? null,
        anexoId: i.anexoId ?? null,
      })),
    });

    return reply.status(201).send({
      recebimento,
      conferencia: {
        status: match.status,
        threeWayOk: match.threeWayOk,
        entregaPendente: match.entregaPendente,
        valorConferido: match.valorConferido.toFixed(2),
        valorLiberado: match.valorLiberado.toFixed(2),
        valorRetido: match.valorRetido.toFixed(2),
        divergencias: match.divergencias,
        bloqueiaEntradaFiscal: match.bloqueiaEntradaFiscal,
        motivoBloqueio: match.motivoBloqueio,
        itens: match.itens.map((i) => ({
          pedidoItemId: i.pedidoItemId,
          descricao: i.descricao,
          quantidadeRecebida: i.quantidadeRecebida.toString(),
          quantidadePendente: i.quantidadePendente.toString(),
          variacaoPrecoPercentual: i.variacaoPreco.times(100).toFixed(2),
          conforme: i.conforme,
          tipoDivergencia: i.tipoDivergencia,
          pagamentoRetido: i.pagamentoRetido,
          valorLiberado: i.valorLiberado.toFixed(2),
          valorRetido: i.valorRetido.toFixed(2),
        })),
      },
    });
  });

  app.get('/recebimentos', { preHandler: [app.autenticar, app.exigirPermissao('pedido:consultar')] }, async (req) => {
    const { cursor, limite, status } = s.listagemSchema.parse(req.query);
    const itens = await prisma.recebimento.findMany({
      where: { deletedAt: null, ...(status ? { status: status as never } : {}) },
      include: {
        itens: true,
        almoxarife: { select: { nome: true } },
        pedido: { select: { numero: true, fornecedor: { select: { razaoSocial: true } } } },
        titulos: { where: { deletedAt: null } },
      },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return paginar(itens, limite);
  });

  // ---------------------------------------------------------------- entrada fiscal e titulos
  app.post('/recebimentos/:id/entrada-fiscal', { preHandler: [app.autenticar, app.exigirPermissao('nota_fiscal:lancar')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dados = s.entradaFiscalSchema.parse(req.body);
    const { titulo, prazo, encerrado } = await recebimento_.lancarEntradaFiscal(atorDe(req), id, {
      vencimento: dados.vencimento,
      condicao: dados.condicao ?? null,
      nfNumero: dados.nfNumero ?? null,
      nfChave: dados.nfChave ?? null,
    });
    // `encerrado` diz se o processo fechou aqui, ou o que ainda falta para fechar
    return reply.status(201).send({ titulo, prazoFisicoFiscal: prazo, encerrado });
  });

  /**
   * Arquivo da nota fiscal do recebimento (secao 6.1.11).
   *
   * O numero e a chave ja ficavam gravados; o documento, nao. Quem precisa dele depois — o
   * fiscal, o financeiro numa divergencia, o auditor meses adiante — ia procurar no e-mail
   * de alguem. Aceita DANFE em PDF, XML da NF-e, a NFS-e do servico e a foto da nota em
   * papel, que ainda chega assim do fornecedor pequeno.
   */
  app.post('/recebimentos/:id/nota-fiscal/anexos', {
    preHandler: [app.autenticar, app.exigirPermissao('nota_fiscal:lancar')],
    // DANFE em PDF e XML passam folgado dos 100 KB padrao do Fastify
    bodyLimit: 12 * 1024 * 1024,
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dados = s.notaFiscalAnexoSchema.parse(req.body);

    const r = await notaFiscal.anexarNotaFiscal(atorDe(req), id, {
      conteudo: Buffer.from(dados.conteudoBase64, 'base64'),
      mime: dados.mime,
      nome: dados.nome,
      descricao: dados.descricao ?? null,
    });

    return reply.status(r.duplicada ? 200 : 201).send(r);
  });

  // quem confere o pagamento precisa ver a nota; `pedido:consultar` cobre fiscal e almoxarife
  app.get('/recebimentos/:id/nota-fiscal/anexos', { preHandler: [app.autenticar, app.exigirPermissao('pedido:consultar')] }, async (req) => ({
    itens: await notaFiscal.notasDoRecebimento(atorDe(req), (req.params as { id: string }).id),
  }));

  app.post('/nota-fiscal/anexos/:id/remover', { preHandler: [app.autenticar, app.exigirPermissao('nota_fiscal:lancar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { motivo } = s.motivoSchema.parse(req.body);
    return notaFiscal.removerNotaFiscal(atorDe(req), id, motivo);
  });

  app.get('/titulos', { preHandler: [app.autenticar, app.exigirPermissao('titulo:gerenciar')] }, async (req) => {
    const { cursor, limite, status } = s.listagemSchema.parse(req.query);
    const itens = await prisma.titulo.findMany({
      where: { deletedAt: null, ...(status ? { status: status as never } : {}) },
      include: {
        fornecedor: { select: { razaoSocial: true } },
        recebimento: { select: { nfNumero: true, pedido: { select: { numero: true } } } },
      },
      orderBy: { id: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return paginar(itens, limite);
  });

  app.post('/titulos/:id/bloquear', { preHandler: [app.autenticar, app.exigirPermissao('titulo:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { motivo } = s.motivoSchema.parse(req.body);
    return recebimento_.bloquearTitulo(atorDe(req), id, motivo);
  });

  app.post('/titulos/:id/liberar', { preHandler: [app.autenticar, app.exigirPermissao('titulo:gerenciar')] }, async (req) => {
    const { id } = req.params as { id: string };
    const { motivo } = s.motivoSchema.parse(req.body);
    return recebimento_.liberarTitulo(atorDe(req), id, motivo);
  });

  // ---------------------------------------------------------------- encerramento
  app.post('/lotes/:id/encerrar', { preHandler: [app.autenticar, app.exigirPermissao('lote:consultar')] }, async (req) => {
    const { id } = req.params as { id: string };
    return recebimento_.encerrarLote(atorDe(req), id);
  });
};
