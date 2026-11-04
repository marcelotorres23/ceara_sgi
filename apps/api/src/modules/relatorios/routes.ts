import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../core/db.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { resolverUnidadesDoRelatorio } from '../../core/rbac/unidades.js';
import * as frota from './frota.service.js';
import * as bi from './bi.service.js';
import * as savings from './savings.service.js';
import { gerarXlsx, nomeDoArquivo, type Coluna } from './exportacao.js';
import { atorDe } from '../../core/rbac/ator.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { ValidationError } from '../../core/errors/index.js';
import { indicadoresDeManutencao } from '../transporte/manutencao.service.js';
import { cpkPorMarca } from '../transporte/pneus.service.js';

/**
 * Relatorios (secao 10). Todo relatorio aceita recorte por unidade e devolve,
 * junto do numero, as unidades consideradas e a memoria de calculo.
 */

const consulta = z.object({
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
  unidadeId: z.string().optional(),
});

const mesCorrente = (ate?: Date) => {
  const fim = ate ?? new Date();
  return { de: new Date(fim.getFullYear(), fim.getMonth(), 1), ate: fim };
};

const consultaBi = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Informe a competencia no formato AAAA-MM.').optional(),
  unidadeId: z.string().optional(),
});

const competenciaCorrente = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);

export const relatoriosRoutes: FastifyPluginAsync = async (app) => {
  /** Unidades que o usuario pode usar como filtro nas telas de relatorio. */
  app.get('/unidades', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:operacional')] }, async (req) => {
    const { consultadas } = await resolverUnidadesDoRelatorio(usuarioDe(req));
    const itens = await prisma.unidade.findMany({
      where: {
        ativo: true,
        deletedAt: null,
        ...(consultadas === 'TODAS' ? {} : { id: { in: consultadas } }),
      },
      select: { id: true, codigo: true, nome: true, cidade: true, uf: true },
      orderBy: { codigo: 'asc' },
    });
    return { itens, todasAsUnidades: consultadas === 'TODAS' };
  });

  // ---------------------------------------------------------------- BI (secao 10)

  /** Painel executivo da Diretoria (secao 10.1). */
  app.get('/executivo', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:executivo')] }, async (req) => {
    const { competencia, unidadeId } = consultaBi.parse(req.query);
    const { consultadas, recorte: unidades } = await resolverUnidadesDoRelatorio(usuarioDe(req), unidadeId);
    return bi.painelExecutivo(unidades, competencia ?? competenciaCorrente());
  });

  /** Spend analysis por categoria e fornecedor (secao 10.2). */
  app.get('/compras/spend', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:gerencial')] }, async (req) => {
    const { competencia, unidadeId } = consultaBi.parse(req.query);
    const { consultadas, recorte: unidades } = await resolverUnidadesDoRelatorio(usuarioDe(req), unidadeId);
    return {
      unidades: consultadas,
      ...(await bi.spendAnalysis(unidades, competencia ?? competenciaCorrente())),
    };
  });

  /** Os KPIs do POP na competencia, e a evolucao de 12 meses (secao 6.6). */
  app.get('/compras/kpis', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:gerencial')] }, async (req) => {
    const { competencia, unidadeId } = consultaBi.parse(req.query);
    const { consultadas, recorte: unidades } = await resolverUnidadesDoRelatorio(usuarioDe(req), unidadeId);
    const alvo = competencia ?? competenciaCorrente();

    return {
      unidades: consultadas,
      competencia: alvo,
      kpis: await bi.kpisDeCompras(unidades, alvo),
      evolucao: await bi.evolucaoDeCompras(unidades, alvo),
    };
  });

  /** Scorecard de fornecedores: OTIF, divergencia e pendencias (secao 6.1.12). */
  app.get('/compras/fornecedores', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:gerencial')] }, async (req) => {
    const { competencia, unidadeId } = consultaBi.parse(req.query);
    const { consultadas, recorte: unidades } = await resolverUnidadesDoRelatorio(usuarioDe(req), unidadeId);
    return {
      unidades: consultadas,
      ...(await bi.scorecardFornecedores(unidades, competencia ?? competenciaCorrente())),
    };
  });

  /**
   * Savings por comprador e por lote (secao 10.2).
   *
   * `relatorio:operacional` e nao `gerencial`: o proprio comprador precisa ver o
   * nivel em que esta trabalhando, nao so quem o avalia.
   */
  app.get('/compras/savings', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:operacional')] }, async (req) => {
    const { competencia, unidadeId } = consultaBi.parse(req.query);
    const { consultadas, recorte: unidades } = await resolverUnidadesDoRelatorio(usuarioDe(req), unidadeId);
    const alvo = competencia ?? competenciaCorrente();

    return {
      unidades: consultadas,
      ...(await savings.savingsPorComprador(unidades, alvo)),
      lotes: await savings.savingsPorLote(unidades, alvo),
    };
  });

  /** Posicao valorizada e curva ABC (secao 8.5). */
  app.get('/almoxarifado/posicao', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:operacional')] }, async (req) => {
    const { unidadeId } = consultaBi.parse(req.query);
    const { consultadas, recorte: unidades } = await resolverUnidadesDoRelatorio(usuarioDe(req), unidadeId);
    return { unidades: consultadas, ...(await bi.posicaoDeEstoque(unidades)) };
  });

  /**
   * Atualizacao manual das views. O job ja roda de hora em hora; esta rota existe
   * para quando alguem precisa do numero agora, logo apos um lancamento.
   */
  app.post('/atualizar', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:gerencial')] }, async (req) => {
    const ator = atorDe(req);
    const resultados = await bi.atualizarViews();

    await registrarAuditoria({
      usuarioId: ator.usuarioId, ip: ator.ip, userAgent: ator.userAgent,
      entidade: 'relatorios', entidadeId: null, acao: 'ATUALIZAR_VIEWS',
      valorNovo: { views: resultados },
    });

    return { atualizadas: resultados, atualizadasEm: await bi.atualizadasEm() };
  });

  // ---------------------------------------------------------------- exportacao XLSX

  app.get('/exportar/:relatorio', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:operacional')] }, async (req, reply) => {
    const { relatorio } = req.params as { relatorio: string };
    const { competencia, unidadeId } = consultaBi.parse(req.query);

    const usuario = usuarioDe(req);
    const { consultadas, recorte: unidades } = await resolverUnidadesDoRelatorio(usuario, unidadeId);
    const alvo = competencia ?? competenciaCorrente();
    const planilha = await montarPlanilha(relatorio, unidades, alvo, usuario.nome, consultadas);

    const arquivo = await gerarXlsx(planilha);

    await registrarAuditoria({
      usuarioId: usuario.sub,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
      entidade: 'relatorios',
      entidadeId: null,
      acao: 'EXPORTAR',
      valorNovo: { relatorio, competencia: alvo, unidades: consultadas, linhas: planilha.linhas.length },
    });

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${nomeDoArquivo(relatorio, alvo)}.xlsx"`)
      .send(arquivo);
  });

  app.get('/frota/custo-por-veiculo', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:operacional')] }, async (req) => {
    const { de, ate, unidadeId } = consulta.parse(req.query);
    const { consultadas, recorte: unidades } = await resolverUnidadesDoRelatorio(usuarioDe(req), unidadeId);
    const periodo = de ? { de, ate: ate ?? new Date() } : mesCorrente(ate);

    return {
      unidades: consultadas,
      periodo,
      ...(await frota.custoPorVeiculo(unidades, periodo)),
    };
  });

  app.get('/frota/consumo-por-motorista', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:operacional')] }, async (req) => {
    const { de, ate, unidadeId } = consulta.parse(req.query);
    const { consultadas, recorte: unidades } = await resolverUnidadesDoRelatorio(usuarioDe(req), unidadeId);
    const periodo = de ? { de, ate: ate ?? new Date() } : mesCorrente(ate);

    return {
      unidades: consultadas,
      periodo,
      itens: await frota.consumoPorMotorista(unidades, periodo),
      memoriaDeCalculo: {
        consumo: 'km percorridos / litros abastecidos, apurados abastecimento a abastecimento',
        ordenacao: 'pior consumo primeiro - e o que exige conversa com o motorista',
      },
    };
  });

  app.get('/frota/manutencao', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:operacional')] }, async (req) => {
    const { de, ate, unidadeId } = consulta.parse(req.query);
    const { consultadas, recorte: unidades } = await resolverUnidadesDoRelatorio(usuarioDe(req), unidadeId);
    const periodo = de ? { de, ate: ate ?? new Date() } : mesCorrente(ate);

    return {
      unidades: consultadas,
      ...(await indicadoresDeManutencao(unidades, periodo)),
    };
  });

  app.get('/frota/pneus', { preHandler: [app.autenticar, app.exigirPermissao('relatorio:operacional')] }, async (req) => {
    const { unidadeId } = consulta.parse(req.query);
    const { consultadas, recorte: unidades } = await resolverUnidadesDoRelatorio(usuarioDe(req), unidadeId);
    const recorte = unidades;

    return {
      unidades: consultadas,
      cpk: await cpkPorMarca(recorte, 'marcaModelo'),
      vidaUtil: await frota.vidaUtilDePneus(recorte),
      memoriaDeCalculo: {
        cpk: 'CPK = (aquisicao + recapagens + reparos) / km rodados, somando custos e km antes de dividir',
        vidaUtil: 'km medio dos pneus ja sucateados ou enviados a recapagem - pneu em uso ainda nao fechou ciclo',
      },
    };
  });
};

/**
 * Monta a planilha de cada relatorio exportavel. Um lugar so: acrescentar relatorio
 * aqui e o unico passo para ele ganhar exportacao com a marca e memoria de calculo.
 */
async function montarPlanilha(
  relatorio: string,
  unidades: string[],
  competencia: string,
  geradoPor: string,
  consultadas: string[] | 'TODAS',
) {
  const recorteLegivel = {
    unidades: consultadas === 'TODAS' ? 'todas as unidades' : consultadas.join(', '),
    competencia,
  };

  const colunas = (...definicoes: Coluna[]): Coluna[] => definicoes;

  switch (relatorio) {
    case 'spend': {
      const dados = await bi.spendAnalysis(unidades, competencia);
      return {
        titulo: 'Spend analysis',
        subtitulo: 'Gasto por categoria e concentracao de fornecedores',
        recorte: recorteLegivel,
        geradoPor,
        colunas: colunas(
          { cabecalho: 'Categoria', chave: 'categoria', largura: 34, formato: 'texto' },
          { cabecalho: 'Valor', chave: 'valor', formato: 'dinheiro', largura: 18 },
          { cabecalho: 'Participacao', chave: 'participacao', formato: 'percentual' },
        ),
        linhas: dados.porCategoria,
        memoriaDeCalculo: dados.memoriaDeCalculo,
      };
    }

    case 'savings': {
      const dados = await savings.savingsPorLote(unidades, competencia);
      const consolidado = await savings.savingsPorComprador(unidades, competencia);
      return {
        titulo: 'Savings por lote',
        subtitulo: 'Base, valor fechado e economia apurada no mapa de cotacao',
        recorte: recorteLegivel,
        geradoPor,
        colunas: colunas(
          { cabecalho: 'Lote', chave: 'numero', formato: 'texto' },
          { cabecalho: 'Comprador', chave: 'comprador', largura: 28, formato: 'texto' },
          { cabecalho: 'Propostas', chave: 'propostasRespondidas', formato: 'inteiro' },
          { cabecalho: 'Base (maior proposta)', chave: 'base', formato: 'dinheiro', largura: 20 },
          { cabecalho: 'Fechado', chave: 'fechado', formato: 'dinheiro', largura: 18 },
          { cabecalho: 'Savings', chave: 'savings', formato: 'dinheiro', largura: 18 },
          { cabecalho: 'Percentual', chave: 'percentual', formato: 'percentual' },
          { cabecalho: 'Justificativa', chave: 'justificativa', largura: 60, formato: 'texto' },
        ),
        linhas: dados,
        memoriaDeCalculo: consolidado.memoriaDeCalculo,
      };
    }

    case 'fornecedores': {
      const dados = await bi.scorecardFornecedores(unidades, competencia);
      return {
        titulo: 'Scorecard de fornecedores',
        subtitulo: 'OTIF, divergencia e pendencias acumuladas',
        recorte: recorteLegivel,
        geradoPor,
        colunas: colunas(
          { cabecalho: 'Fornecedor', chave: 'fornecedor', largura: 40, formato: 'texto' },
          { cabecalho: 'Pedidos', chave: 'pedidos', formato: 'inteiro' },
          { cabecalho: 'Entregues', chave: 'entregues', formato: 'inteiro' },
          { cabecalho: 'OTIF', chave: 'otifPercentual', formato: 'percentual' },
          { cabecalho: 'Divergencia', chave: 'indiceDivergencia', formato: 'percentual' },
          { cabecalho: 'Pendentes', chave: 'pendentes', formato: 'inteiro' },
        ),
        linhas: dados.itens,
        memoriaDeCalculo: dados.memoriaDeCalculo,
      };
    }

    case 'estoque': {
      const dados = await bi.posicaoDeEstoque(unidades);
      return {
        titulo: 'Posicao de estoque valorizada',
        subtitulo: 'Saldo, custo medio e curva ABC',
        recorte: { unidades: recorteLegivel.unidades },
        geradoPor,
        colunas: colunas(
          { cabecalho: 'Codigo', chave: 'codigo', formato: 'texto' },
          { cabecalho: 'Item', chave: 'descricao', largura: 42, formato: 'texto' },
          { cabecalho: 'Almoxarifado', chave: 'almoxarifado', formato: 'texto' },
          { cabecalho: 'Quantidade', chave: 'quantidade', formato: 'decimal' },
          { cabecalho: 'Custo medio', chave: 'custoMedio', formato: 'dinheiro' },
          { cabecalho: 'Valor', chave: 'valor', formato: 'dinheiro', largura: 18 },
          { cabecalho: 'Dias sem giro', chave: 'diasSemGiro', formato: 'inteiro' },
        ),
        linhas: dados.posicao,
        memoriaDeCalculo: dados.memoriaDeCalculo,
      };
    }

    case 'curva-abc': {
      const dados = await bi.posicaoDeEstoque(unidades);
      return {
        titulo: 'Curva ABC de estoque',
        subtitulo: 'Itens ordenados por valor imobilizado',
        recorte: { unidades: recorteLegivel.unidades },
        geradoPor,
        colunas: colunas(
          { cabecalho: 'Curva', chave: 'curva', formato: 'texto', largura: 10 },
          { cabecalho: 'Codigo', chave: 'codigo', formato: 'texto' },
          { cabecalho: 'Item', chave: 'descricao', largura: 42, formato: 'texto' },
          { cabecalho: 'Valor', chave: 'valorFormatado', formato: 'dinheiro', largura: 18 },
          { cabecalho: 'Participacao', chave: 'participacao', formato: 'percentual' },
          { cabecalho: 'Acumulado', chave: 'acumulado', formato: 'percentual' },
        ),
        linhas: dados.curva.itens,
        memoriaDeCalculo: dados.memoriaDeCalculo,
      };
    }

    case 'custo-frota': {
      const fim = new Date(`${competencia}-01T00:00:00Z`);
      fim.setUTCMonth(fim.getUTCMonth() + 1);
      const dados = await frota.custoPorVeiculo(unidades, {
        de: new Date(`${competencia}-01T00:00:00Z`),
        ate: fim,
      });
      return {
        titulo: 'Custo por veiculo',
        subtitulo: 'Combustivel, manutencao e pneus no periodo',
        recorte: recorteLegivel,
        geradoPor,
        colunas: colunas(
          { cabecalho: 'Frota', chave: 'frotaNumero', formato: 'texto' },
          { cabecalho: 'Placa', chave: 'placa', formato: 'texto' },
          { cabecalho: 'Unidade', chave: 'unidade', formato: 'texto' },
          { cabecalho: 'Combustivel', chave: 'combustivel', formato: 'dinheiro' },
          { cabecalho: 'Manutencao', chave: 'manutencao', formato: 'dinheiro' },
          { cabecalho: 'Pneus', chave: 'pneus', formato: 'dinheiro' },
          { cabecalho: 'Custo total', chave: 'custoTotal', formato: 'dinheiro', largura: 18 },
          { cabecalho: 'Km rodados', chave: 'kmRodados', formato: 'decimal' },
          { cabecalho: 'Custo por km', chave: 'custoPorKm', formato: 'dinheiro' },
        ),
        linhas: dados.itens,
        memoriaDeCalculo: dados.memoriaDeCalculo,
      };
    }

    default:
      throw new ValidationError(
        `Relatorio "${relatorio}" nao tem exportacao. Disponiveis: spend, savings, fornecedores, estoque, curva-abc, custo-frota.`,
      );
  }
}
