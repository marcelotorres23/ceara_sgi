import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../core/db.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { atorDe } from '../../core/rbac/ator.js';
import { unidadeDeEscrita, unidadesConsultadas } from '../../core/rbac/escopo.js';
import { NotFoundError } from '../../core/errors/index.js';
import * as servico from './servico-periodico.service.js';
import { INTERVALO_PADRAO, ROTULO_TIPO, basesPermitidas } from './manutencao-periodica.js';
import { registrarAuditoria } from '../../core/audit/index.js';
import { ROTULO_SEVERIDADE } from './regua-manutencao.js';
import { HORIZONTE_PADRAO_DIAS, ROTULO_FAIXA } from './programacao-semana.js';

const tipoSchema = z.enum([
  'LUBRIFICACAO',
  'OLEO_MOTOR',
  'OLEO_DIFERENCIAL',
  'OLEO_CAIXA_MARCHA',
  'OLEO_THERMO_KING',
  'ALINHAMENTO',
  'BALANCEAMENTO',
]);

const decimal = (campo: string, casas = 1) =>
  z.string().regex(new RegExp(`^\\d+(\\.\\d{1,${casas}})?$`), `${campo} deve ser um numero positivo.`);

const recorte = (consultadas: string[] | 'TODAS'): string[] => (consultadas === 'TODAS' ? [] : consultadas);

/**
 * Horizonte da programacao.
 *
 * O padrao e a semana, que e o ciclo de quem monta a fila do box. O teto de 60 dias existe para a
 * conversa com compras: peca de eixo e de embreagem nao chega no dia seguinte, e o comprador
 * precisa enxergar mais longe que o encarregado.
 */
const filtrosDaProgramacao = z.object({
  unidadeId: z.string().optional(),
  horizonteDias: z.coerce.number().int().min(1).max(60).default(HORIZONTE_PADRAO_DIAS),
});

/**
 * Controle de oleo e servicos de rodagem (secao 7.10).
 *
 * Consultar e um direito de quem cuida da frota; registrar troca e ato de manutencao; e
 * mexer no intervalo do plano e decisao de engenharia — tres permissoes distintas.
 */
export const servicoPeriodicoRoutes: FastifyPluginAsync = async (app) => {
  /** Tipos e seus intervalos padrao: a tela monta as abas a partir daqui. */
  app.get('/tipos', { preHandler: [app.autenticar, app.exigirPermissao('preventiva:consultar')] }, async () => ({
    itens: (Object.keys(INTERVALO_PADRAO) as Array<keyof typeof INTERVALO_PADRAO>).map((tipo) => ({
      tipo,
      rotulo: ROTULO_TIPO[tipo],
      base: INTERVALO_PADRAO[tipo].base,
      basesPermitidas: basesPermitidas(tipo),
      intervaloPadrao: String(INTERVALO_PADRAO[tipo].intervalo),
    })),
  }));

  app.get('/painel', { preHandler: [app.autenticar, app.exigirPermissao('preventiva:consultar')] }, async (req) => {
    const { tipo, unidadeId } = z.object({ tipo: tipoSchema, unidadeId: z.string().optional() }).parse(req.query);
    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);

    // primeira abertura da unidade nao pode mostrar tudo em dia por falta de plano
    const daEscrita = unidadeDeEscrita(usuarioDe(req), unidadeId ?? null);
    await servico.garantirPlanosPadrao(daEscrita, atorDe(req));

    return { tipo, ...(await servico.painel(tipo, recorte(consultadas))) };
  });

  /**
   * Patio da oficina (ADR 0023): uma linha por veiculo, com os itens do plano lado a lado,
   * ordenada pelo score — porque a mesma parada resolve varios servicos.
   */
  app.get('/patio', { preHandler: [app.autenticar, app.exigirPermissao('preventiva:consultar')] }, async (req) => {
    const { unidadeId } = z.object({ unidadeId: z.string().optional() }).parse(req.query);
    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);

    // primeira abertura da unidade nao pode mostrar tudo em dia por falta de plano
    await servico.garantirPlanosPadrao(unidadeDeEscrita(usuarioDe(req), unidadeId ?? null), atorDe(req));

    return servico.painelDoPatio(recorte(consultadas));
  });

  /**
   * Programacao da semana (ADR 0023): quem entra no box, em que ordem, e o que se faz em cada um.
   *
   * O patio responde quem esta pior; esta rota responde a pergunta que vem depois dela e que e a
   * que monta o dia da oficina — inclusive quem **nao** pode ser programado por falta de leitura.
   */
  app.get('/programacao', { preHandler: [app.autenticar, app.exigirPermissao('preventiva:consultar')] }, async (req) => {
    const { unidadeId, horizonteDias } = filtrosDaProgramacao.parse(req.query);
    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);

    // primeira abertura da unidade nao pode mostrar tudo em dia por falta de plano
    await servico.garantirPlanosPadrao(unidadeDeEscrita(usuarioDe(req), unidadeId ?? null), atorDe(req));

    return servico.programacao(recorte(consultadas), horizonteDias);
  });

  /** A mesma programacao em CSV: e o papel que vai para o quadro do box e para o comprador de peca. */
  app.get('/programacao.csv', { preHandler: [app.autenticar, app.exigirPermissao('preventiva:consultar')] }, async (req, reply) => {
    const { unidadeId, horizonteDias } = filtrosDaProgramacao.parse(req.query);
    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    await servico.garantirPlanosPadrao(unidadeDeEscrita(usuarioDe(req), unidadeId ?? null), atorDe(req));

    const { itens, semLeitura, horizonteDias: horizonte } = await servico.programacao(
      recorte(consultadas),
      horizonteDias,
    );

    const cabecalho = [
      'faixa', 'ordem', 'placa', 'frota', 'veiculo', 'hodometro', 'km_por_dia',
      'servico', 'severidade', 'encaixe', 'ciclo_usado_pct', 'a_vencer', 'vencido',
      'vence_em_dias', 'motivo',
    ];

    // uma linha por servico: e assim que o papel vira lista de peca a separar
    const corpo = itens.flatMap((v, i) =>
      v.servicos.map((s) =>
        [
          ROTULO_FAIXA[v.faixa],
          i + 1,
          v.placa,
          v.frotaNumero,
          v.descricao,
          v.hodometro,
          v.kmPorDia ?? '',
          s.rotulo,
          ROTULO_SEVERIDADE[s.severidade],
          s.encaixe ? 'sim' : 'nao',
          Math.round(s.usado * 100),
          s.aVencer,
          s.vencido,
          s.venceEmDias ?? '',
          s.motivo ?? v.motivo,
        ]
          // ponto e virgula e o separador que o Excel em pt-BR entende sem pedir importacao
          .map((campo) => `"${String(campo).replaceAll('"', '""')}"`)
          .join(';'),
      ),
    );

    /*
     * Quem nao pode ser programado vai no mesmo papel, e nao num anexo: o encarregado que leva a
     * lista para o patio e quem consegue ler aquele hodometro no mesmo passeio.
     */
    const pendentes = semLeitura.map((s) =>
      [
        'Sem leitura', '', s.placa, s.frotaNumero, s.descricao, s.hodometro, '',
        '', '', '', '', '', '', '', s.motivo,
      ]
        .map((campo) => `"${String(campo).replaceAll('"', '""')}"`)
        .join(';'),
    );

    await registrarAuditoria({
      usuarioId: atorDe(req).usuarioId,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
      entidade: 'servicos_periodicos',
      entidadeId: null,
      acao: 'EXPORTAR',
      valorNovo: { veiculos: itens.length, servicos: corpo.length, semLeitura: pendentes.length, horizonte },
    });

    // BOM na frente: sem ele o Excel abre acento quebrado
    const csv = '﻿' + [cabecalho.join(';'), ...corpo, ...pendentes].join('\r\n');

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="programacao-oficina-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(csv);
  });

  app.get('/planos', { preHandler: [app.autenticar, app.exigirPermissao('preventiva:consultar')] }, async (req) => {
    const { unidadeId } = z.object({ unidadeId: z.string().optional() }).parse(req.query);
    const consultadas = unidadesConsultadas(usuarioDe(req), unidadeId);
    return { itens: await servico.listarPlanos(recorte(consultadas)) };
  });

  app.put('/planos', { preHandler: [app.autenticar, app.exigirPermissao('preventiva:parametrizar')] }, async (req) => {
    const dados = z
      .object({
        unidadeId: z.string().nullish(),
        tipo: tipoSchema,
        modelo: z.string().nullish(),
        // o gestor troca km por dias no proprio plano (secao 7.10)
        base: z.enum(['HODOMETRO', 'HORIMETRO', 'DIAS']).nullish(),
        intervalo: decimal('Intervalo'),
        avisarCom: decimal('Antecedencia do aviso'),
        observacao: z.string().nullish(),
      })
      .parse(req.body);

    return servico.salvarPlano(atorDe(req), {
      ...dados,
      unidadeId: unidadeDeEscrita(usuarioDe(req), dados.unidadeId ?? null),
    });
  });

  app.post('/execucoes', { preHandler: [app.autenticar, app.exigirPermissao('preventiva:registrar')] }, async (req, reply) => {
    const dados = z
      .object({
        unidadeId: z.string().nullish(),
        tipo: tipoSchema,
        veiculoId: z.string().nullish(),
        equipamentoFrioId: z.string().nullish(),
        executadoEm: z.coerce.date().nullish(),
        // no plano por dias a leitura e opcional: quem engraxa anota o dia, nao o painel
        medicao: decimal('Medicao').nullish(),
        itemId: z.string().nullish(),
        quantidade: decimal('Quantidade', 3).nullish(),
        custo: decimal('Custo', 2).nullish(),
        oficina: z.string().nullish(),
        ordemServicoId: z.string().nullish(),
        observacao: z.string().nullish(),
      })
      .parse(req.body);

    const unidadeId = unidadeDeEscrita(usuarioDe(req), dados.unidadeId ?? null);
    return reply.status(201).send(await servico.registrarExecucao(atorDe(req), { ...dados, unidadeId }));
  });

  app.get('/historico/:ativoId', { preHandler: [app.autenticar, app.exigirPermissao('preventiva:consultar')] }, async (req) => {
    const { ativoId } = req.params as { ativoId: string };
    const { tipo } = z.object({ tipo: tipoSchema }).parse(req.query);

    // o ativo tem que estar no alcance de quem consulta (secao 5.6)
    const alcance = servico.ehDoEquipamento(tipo)
      ? await prisma.equipamentoFrio.findFirst({ where: { id: ativoId, deletedAt: null }, select: { unidadeId: true } })
      : await prisma.veiculo.findFirst({ where: { id: ativoId, deletedAt: null }, select: { unidadeId: true } });
    if (!alcance) throw new NotFoundError('Ativo');

    const consultadas = unidadesConsultadas(usuarioDe(req));
    if (consultadas !== 'TODAS' && !consultadas.includes(alcance.unidadeId)) throw new NotFoundError('Ativo');

    return { itens: await servico.historicoDoAtivo(tipo, ativoId) };
  });
};
