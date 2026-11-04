import type { FastifyPluginAsync } from 'fastify';
import { novoId, prisma } from '../../core/db.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { atorDe } from '../../core/rbac/ator.js';
import { filtroUnidade, unidadeDeEscrita } from '../../core/rbac/escopo.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { NotFoundError } from '../../core/errors/index.js';
import * as servico from './service.js';
import * as ficha from './ficha-largada.service.js';
import * as s from './schemas.js';
import { codigoDaRota } from './importacao-rotas.js';
import { gerarXlsx, nomeDoArquivo, type Coluna } from '../relatorios/exportacao.js';

/**
 * Portaria e controle de acesso (secao 14).
 *
 * Operar (registrar movimento) e gerenciar (cadastro e lista restritiva) sao permissoes
 * distintas de proposito: o porteiro registra o que passa pelo portao, mas nao decide
 * sozinho quem entra na lista restritiva.
 */
export const portariaRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------- pontos de acesso
  app.get('/pontos', { preHandler: [app.autenticar, app.exigirPermissao('portaria:consultar')] }, async (req) => {
    const itens = await prisma.pontoAcesso.findMany({
      where: {
        deletedAt: null,
        ativo: true,
        ...filtroUnidade(usuarioDe(req)),
      },
      orderBy: { codigo: 'asc' },
    });
    return { itens };
  });

  app.post(
    '/pontos',
    { preHandler: [app.autenticar, app.exigirPermissao('portaria:gerenciar')] },
    async (req, reply) => {
      const dados = s.novoPontoSchema.parse(req.body);
      const ator = atorDe(req);
      const unidadeId = unidadeDeEscrita(usuarioDe(req), dados.unidadeId);

      const ponto = await prisma.pontoAcesso.create({
        data: {
          id: novoId(),
          unidadeId,
          codigo: dados.codigo.trim().toUpperCase(),
          nome: dados.nome.trim(),
          createdBy: ator.usuarioId,
        },
      });

      await registrarAuditoria({
        usuarioId: ator.usuarioId,
        ip: ator.ip,
        userAgent: ator.userAgent,
        entidade: 'pontos_acesso',
        entidadeId: ponto.id,
        acao: 'CRIAR',
        valorNovo: { codigo: ponto.codigo },
      });

      return reply.status(201).send(ponto);
    },
  );

  // ---------------------------------------------------------------- cadastro de rotas
  /**
   * Rotas cadastradas. Listar exige apenas `portaria:consultar` porque a guarita precisa
   * ver a lista para escolher; criar e editar exigem `portaria:gerenciar`.
   */
  app.get('/rotas', { preHandler: [app.autenticar, app.exigirPermissao('portaria:consultar')] }, async (req) => {
    const { busca, limite, cursor, unidadeId, apenasAtivas } = s.listagemRotasSchema.parse(req.query);

    const itens = await prisma.rota.findMany({
      where: {
        deletedAt: null,
        ...filtroUnidade(usuarioDe(req), unidadeId),
        ...(apenasAtivas ? { ativo: true, inativadoEm: null } : {}),
        ...(busca
          ? {
              OR: [{ nome: { contains: busca, mode: 'insensitive' } }, { codigo: { contains: busca.toUpperCase() } }],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
      take: limite + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const temProxima = itens.length > limite;
    const pagina = temProxima ? itens.slice(0, limite) : itens;
    return {
      itens: pagina,
      proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null,
    };
  });

  app.post(
    '/rotas',
    { preHandler: [app.autenticar, app.exigirPermissao('portaria:gerenciar')] },
    async (req, reply) => {
      const dados = s.novaRotaSchema.parse(req.body);
      const ator = atorDe(req);
      const unidadeId = unidadeDeEscrita(usuarioDe(req), dados.unidadeId);
      const nome = dados.nome.trim().replace(/\s+/g, ' ');
      // sem codigo informado, o mesmo que a importacao da planilha usa: nome sem acento
      const codigo = dados.codigo?.trim().toUpperCase() || codigoDaRota(nome);

      const rota = await prisma.rota.create({
        data: {
          id: novoId(),
          unidadeId,
          codigo,
          nome,
          vendedores: dados.vendedores ?? null,
          diasPreVenda: dados.diasPreVenda ?? null,
          fechamento: dados.fechamento?.trim() || null,
          largada: dados.largada?.trim() || null,
          observacao: dados.observacao?.trim() || null,
          createdBy: ator.usuarioId,
        },
      });

      await registrarAuditoria({
        usuarioId: ator.usuarioId,
        ip: ator.ip,
        userAgent: ator.userAgent,
        entidade: 'rotas',
        entidadeId: rota.id,
        acao: 'CRIAR',
        valorNovo: { codigo: rota.codigo, nome: rota.nome },
      });

      return reply.status(201).send(rota);
    },
  );

  /**
   * Frota, motoristas e rotas para a guarita escolher no registro de saida.
   *
   * Existe para o porteiro nao precisar de `veiculo:gerenciar` so para achar uma placa:
   * o endpoint devolve o minimo (placa, frota, nome, rota) e nada mais. Rota inativa
   * nao aparece — o que saiu do roteiro nao volta pela guarita.
   */
  app.get('/frota', { preHandler: [app.autenticar, app.exigirPermissao('portaria:operar')] }, async (req) => {
    const usuario = usuarioDe(req);
    const [veiculos, motoristas, rotas] = await Promise.all([
      prisma.veiculo.findMany({
        where: {
          deletedAt: null,
          status: 'ATIVO',
          ...filtroUnidade(usuario),
        },
        select: {
          id: true,
          placa: true,
          frotaNumero: true,
          hodometroAtual: true,
        },
        orderBy: { placa: 'asc' },
      }),
      prisma.motorista.findMany({
        where: {
          deletedAt: null,
          status: 'ATIVO',
          ...filtroUnidade(usuario),
        },
        // o telefone vem junto para a guarita ver, antes de tentar, se a ficha tem para onde ir
        select: { id: true, nome: true, cnhVencimento: true, telefone: true },
        orderBy: { nome: 'asc' },
      }),
      prisma.rota.findMany({
        where: {
          deletedAt: null,
          ativo: true,
          inativadoEm: null,
          ...filtroUnidade(usuario),
        },
        select: {
          id: true,
          codigo: true,
          nome: true,
          fechamento: true,
          largada: true,
        },
        orderBy: { nome: 'asc' },
      }),
    ]);
    return { veiculos, motoristas, rotas };
  });

  // ---------------------------------------------------------------- pessoas externas
  // quem administra a lista restritiva precisa achar a pessoa sem operar a guarita
  app.get(
    '/pessoas',
    {
      preHandler: [app.autenticar, app.exigirQualquerPermissao('portaria:operar', 'portaria:gerenciar')],
    },
    async (req) => {
      const { cursor, limite, busca, tipo, apenasBloqueados } = s.listagemPessoasSchema.parse(req.query);

      const itens = await prisma.pessoaExterna.findMany({
        where: {
          deletedAt: null,
          ...(tipo ? { tipo } : {}),
          ...(apenasBloqueados ? { bloqueado: true } : {}),
          ...(busca
            ? {
                OR: [
                  { nome: { contains: busca, mode: 'insensitive' } },
                  {
                    documento: {
                      contains: busca.replace(/[^0-9A-Za-z]/g, '').toUpperCase(),
                    },
                  },
                  { empresa: { contains: busca, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { id: 'asc' },
        take: limite + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const temProxima = itens.length > limite;
      const pagina = temProxima ? itens.slice(0, limite) : itens;
      return {
        itens: pagina,
        proximoCursor: temProxima ? (pagina[pagina.length - 1]?.id ?? null) : null,
      };
    },
  );

  app.post('/pessoas', { preHandler: [app.autenticar, app.exigirPermissao('portaria:operar')] }, async (req, reply) => {
    const dados = s.novaPessoaSchema.parse(req.body);
    const pessoa = await servico.cadastrarPessoaExterna(atorDe(req), {
      ...dados,
      unidadeId: dados.unidadeId ?? usuarioDe(req).unidadeAtivaId ?? null,
    });
    return reply.status(201).send(pessoa);
  });

  app.get(
    '/pessoas/:id',
    {
      preHandler: [app.autenticar, app.exigirQualquerPermissao('portaria:operar', 'portaria:gerenciar')],
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const pessoa = await prisma.pessoaExterna.findFirst({
        where: { id, deletedAt: null },
        include: {
          acessos: {
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { pontoAcesso: { select: { codigo: true, nome: true } } },
          },
        },
      });
      if (!pessoa) throw new NotFoundError('Pessoa externa');
      return pessoa;
    },
  );

  app.post(
    '/pessoas/:id/bloquear',
    { preHandler: [app.autenticar, app.exigirPermissao('portaria:gerenciar')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const { motivo } = s.motivoSchema.parse(req.body);
      return servico.bloquearPessoa(atorDe(req), id, motivo);
    },
  );

  app.post(
    '/pessoas/:id/desbloquear',
    { preHandler: [app.autenticar, app.exigirPermissao('portaria:gerenciar')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const { motivo } = s.motivoSchema.parse(req.body);
      return servico.desbloquearPessoa(atorDe(req), id, motivo);
    },
  );

  // ---------------------------------------------------------------- movimento do portao
  /** Painel que fica aberto na guarita: quem esta dentro e quais caminhoes estao na rua. */
  app.get('/patio', { preHandler: [app.autenticar, app.exigirPermissao('portaria:consultar')] }, async (req) => {
    const filtros = s.patioSchema.parse(req.query);
    return servico.patioAgora(usuarioDe(req), {
      unidadeId: filtros.unidadeId ?? null,
      pontoAcessoId: filtros.pontoAcessoId ?? null,
    });
  });

  app.get('/acessos', { preHandler: [app.autenticar, app.exigirPermissao('portaria:consultar')] }, async (req) => {
    const f = s.listagemAcessosSchema.parse(req.query);
    return servico.listarAcessos(usuarioDe(req), {
      unidadeId: f.unidadeId ?? null,
      status: f.status ?? null,
      tipo: f.tipo ?? null,
      pontoAcessoId: f.pontoAcessoId ?? null,
      de: f.de ?? null,
      ate: f.ate ?? null,
      busca: f.busca ?? null,
      cursor: f.cursor ?? null,
      limite: f.limite,
    });
  });

  app.get('/acessos/:id', { preHandler: [app.autenticar, app.exigirPermissao('portaria:consultar')] }, async (req) => {
    const { id } = req.params as { id: string };
    return servico.historicoDoAcesso(usuarioDe(req), id);
  });

  app.post('/acessos', { preHandler: [app.autenticar, app.exigirPermissao('portaria:operar')] }, async (req, reply) => {
    const dados = s.novoAcessoSchema.parse(req.body);
    const acesso = await servico.registrarAcesso(atorDe(req), {
      ...dados,
      unidadeId: unidadeDeEscrita(usuarioDe(req), dados.unidadeId),
    });
    return reply.status(201).send(acesso);
  });

  /**
   * Ficha de largada em PDF (secao 14.7). O documento sai da casa com o motorista, entao
   * a trilha registra quem baixou - mesmo tratamento do pedido de compra (6.1.8).
   */
  app.get(
    '/acessos/:id/ficha-largada.pdf',
    { preHandler: [app.autenticar, app.exigirPermissao('portaria:consultar')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { nome, conteudo } = await ficha.fichaDoAcesso(usuarioDe(req), id);

      const ator = atorDe(req);
      await registrarAuditoria({
        usuarioId: ator.usuarioId,
        ip: ator.ip,
        userAgent: ator.userAgent,
        entidade: 'acessos_portaria',
        entidadeId: id,
        acao: 'EXPORTAR:PDF',
      });

      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${nome}"`)
        .send(conteudo);
    },
  );

  /**
   * Envia a ficha ao WhatsApp do motorista, no numero do cadastro.
   *
   * E `portaria:operar` e nao `portaria:consultar`: mandar mensagem em nome da casa e
   * ato de guarita, nao de quem so consulta o movimento. O envio audita sozinho, dentro
   * do servico, porque a mesma rotina roda tambem no registro automatico da largada.
   */
  app.post(
    '/acessos/:id/ficha-largada/whatsapp',
    { preHandler: [app.autenticar, app.exigirPermissao('portaria:operar')] },
    async (req) => {
      const { id } = req.params as { id: string };
      return ficha.enviarFichaPorWhatsapp(atorDe(req), id, filtroUnidade(usuarioDe(req)));
    },
  );

  app.post(
    '/acessos/:id/saida',
    { preHandler: [app.autenticar, app.exigirPermissao('portaria:operar')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const dados = s.saidaSchema.parse(req.body ?? {});
      return servico.registrarSaida(atorDe(req), id, dados);
    },
  );

  app.post(
    '/acessos/:id/chegada',
    { preHandler: [app.autenticar, app.exigirPermissao('portaria:operar')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const dados = s.chegadaSchema.parse(req.body ?? {});
      return servico.confirmarChegada(atorDe(req), id, dados);
    },
  );

  app.post(
    '/acessos/:id/encerrar',
    { preHandler: [app.autenticar, app.exigirPermissao('portaria:operar')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const { para, motivo } = s.encerrarSemEntradaSchema.parse(req.body);
      return servico.encerrarSemEntrada(atorDe(req), id, para, motivo);
    },
  );

  // ---------------------------------------------------------------- ocorrencias e indicadores
  app.get('/ocorrencias', { preHandler: [app.autenticar, app.exigirPermissao('portaria:consultar')] }, async (req) => {
    const f = s.listagemOcorrenciasSchema.parse(req.query);
    return servico.listarOcorrencias(usuarioDe(req), {
      unidadeId: f.unidadeId ?? null,
      gravidade: f.gravidade ?? null,
      limite: f.limite,
      cursor: f.cursor ?? null,
    });
  });

  app.post(
    '/ocorrencias',
    { preHandler: [app.autenticar, app.exigirPermissao('portaria:operar')] },
    async (req, reply) => {
      const dados = s.novaOcorrenciaSchema.parse(req.body);
      const ocorrencia = await servico.abrirOcorrencia(atorDe(req), {
        ...dados,
        unidadeId: unidadeDeEscrita(usuarioDe(req), dados.unidadeId),
      });
      return reply.status(201).send(ocorrencia);
    },
  );

  app.get('/indicadores', { preHandler: [app.autenticar, app.exigirPermissao('portaria:consultar')] }, async (req) => {
    const f = s.indicadoresSchema.parse(req.query);
    return servico.indicadores(usuarioDe(req), {
      unidadeId: f.unidadeId ?? null,
      dias: f.dias,
    });
  });

  // ---------------------------------------------------------------- relatorio por periodo

  /**
   * Movimento de veiculos no periodo, com placa, rota e motorista (secao 14.5).
   * `portaria:consultar` e nao `operar`: quem emite o relatorio e a gestao, e o
   * porteiro que registra nao precisa da leitura do periodo inteiro.
   */
  app.get(
    '/relatorio/movimentos',
    { preHandler: [app.autenticar, app.exigirPermissao('portaria:consultar')] },
    async (req) => {
      const f = s.relatorioMovimentosSchema.parse(req.query);
      return servico.relatorioDeMovimentos(usuarioDe(req), {
        ...f,
        de: f.de,
        ate: f.ate,
      });
    },
  );

  /**
   * Mesmo recorte, em XLSX com a marca e a memoria de calculo (secao 10.3).
   * A exportacao e auditada: arquivo de portaria sai da casa e responde por
   * quem estava onde, entao precisa constar quem levou.
   */
  app.get(
    '/relatorio/movimentos/exportar',
    { preHandler: [app.autenticar, app.exigirPermissao('portaria:consultar')] },
    async (req, reply) => {
      const f = s.relatorioMovimentosSchema.parse(req.query);
      const usuario = usuarioDe(req);
      const ator = atorDe(req);

      const relatorio = await servico.relatorioDeMovimentos(usuario, {
        ...f,
        de: f.de,
        ate: f.ate,
      });
      const arquivo = await gerarXlsx(montarPlanilhaDeMovimentos(relatorio, usuario.nome));

      await registrarAuditoria({
        usuarioId: ator.usuarioId,
        ip: ator.ip,
        userAgent: ator.userAgent,
        entidade: 'portaria',
        entidadeId: null,
        acao: 'EXPORTAR_RELATORIO',
        valorNovo: {
          periodo: relatorio.periodo,
          unidades: relatorio.unidades,
          linhas: relatorio.linhas.length,
          truncado: relatorio.truncado,
        },
      });

      const recorte = `${f.de.toISOString().slice(0, 10)}-a-${f.ate.toISOString().slice(0, 10)}`;

      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${nomeDoArquivo('portaria-movimentos', recorte)}.xlsx"`)
        .send(arquivo);
    },
  );
};

const COLUNAS_DO_MOVIMENTO: Coluna[] = [
  { cabecalho: 'Placa', chave: 'placa', largura: 12 },
  { cabecalho: 'Frota', chave: 'frotaNumero', largura: 10 },
  { cabecalho: 'Rota', chave: 'rota', largura: 28 },
  { cabecalho: 'Motorista', chave: 'motorista', largura: 30 },
  { cabecalho: 'Movimento', chave: 'movimento', largura: 16 },
  { cabecalho: 'Inicio', chave: 'inicio', largura: 18 },
  { cabecalho: 'Fim', chave: 'fim', largura: 18 },
  { cabecalho: 'Permanencia', chave: 'permanencia', largura: 14 },
  {
    cabecalho: 'Km da viagem',
    chave: 'kmViagem',
    largura: 14,
    formato: 'decimal',
  },
  { cabecalho: 'Ponto', chave: 'ponto', largura: 24 },
  { cabecalho: 'Situacao', chave: 'situacao', largura: 14 },
  { cabecalho: 'Motivo', chave: 'motivo', largura: 34 },
];

const horario = (data: Date | null): string =>
  data ? new Date(data).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }) : '';

/** "6h30" e legivel; "390 minutos" obriga quem le a fazer a conta. */
const duracao = (minutos: number | null): string => {
  if (minutos === null) return '';
  const horas = Math.floor(minutos / 60);
  return horas === 0 ? `${minutos}min` : `${horas}h${String(minutos % 60).padStart(2, '0')}`;
};

type RelatorioDeMovimentos = Awaited<ReturnType<typeof servico.relatorioDeMovimentos>>;

function montarPlanilhaDeMovimentos(relatorio: RelatorioDeMovimentos, geradoPor: string) {
  const { totais } = relatorio;

  return {
    titulo: 'Portaria - movimento de veiculos',
    subtitulo: 'Entrada e saida pelo portao, por periodo',
    recorte: {
      periodo: `${horario(relatorio.periodo.de)} a ${horario(relatorio.periodo.ate)}`,
      unidades: relatorio.unidades === 'TODAS' ? 'todas' : relatorio.unidades.join(', '),
      movimentos: String(totais.movimentos),
      encerrados: String(totais.encerrados),
      'em aberto': String(totais.emAberto),
      'permanencia media': duracao(totais.permanenciaMediaMinutos) || 'sem base',
      'km total': totais.kmTotal ?? 'sem base',
      ...(relatorio.truncado
        ? {
            atencao: `recorte truncado no teto de ${relatorio.tetoDeLinhas} linhas - divida o periodo`,
          }
        : {}),
    },
    colunas: COLUNAS_DO_MOVIMENTO,
    linhas: relatorio.linhas.map((l) => ({
      placa: l.placa ?? '',
      frotaNumero: l.frotaNumero ?? '',
      rota: l.rota ?? '',
      motorista: l.motorista ?? '',
      movimento: l.tipo === 'VEICULO_PROPRIO' ? 'Saida da frota' : 'Entrada de terceiro',
      inicio: horario(l.inicioEm),
      fim: horario(l.fimEm),
      permanencia: duracao(l.permanenciaMinutos),
      kmViagem: l.kmViagem ?? '',
      ponto: l.ponto,
      situacao: l.emAberto ? 'Em aberto' : l.status,
      motivo: l.motivo,
    })),
    memoriaDeCalculo: relatorio.memoriaDeCalculo,
    geradoPor,
  };
}
