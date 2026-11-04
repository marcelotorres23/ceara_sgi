import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../../core/env.js';
import { usuarioDe } from '../../core/rbac/plugin.js';
import { atorDe } from '../../core/rbac/ator.js';
import { resolverUnidadesDoRelatorio } from '../../core/rbac/unidades.js';
import { ValidationError } from '../../core/errors/index.js';
import { canaisConfigurados } from '../../core/notifications/adaptadores.js';
import { chaveValida } from '../fiscal/chave-nfe.js';
import { importarAbastecimentos } from './importacao.service.js';

/**
 * Integracoes (F10). O que nao esta configurado **diz que nao esta**, com o nome
 * da variavel de ambiente que falta - em vez de responder erro generico ou,
 * pior, devolver dado inventado.
 */

export const integracoesRoutes: FastifyPluginAsync = async (app) => {
  /** O que esta ligado e o que falta configurar. Alimenta a tela de governanca. */
  app.get('/status', { preHandler: [app.autenticar, app.exigirPermissao('parametro:listar')] }, async () => ({
    notificacoes: canaisConfigurados(),
    sefaz: {
      configurado: Boolean(env.SEFAZ_URL && env.SEFAZ_CERTIFICADO),
      faltando: [
        ...(env.SEFAZ_URL ? [] : ['SEFAZ_URL']),
        ...(env.SEFAZ_CERTIFICADO ? [] : ['SEFAZ_CERTIFICADO']),
      ],
      observacao: 'A consulta por chave exige certificado digital A1 da empresa.',
    },
    importacao: {
      abastecimentos: true,
      formato: 'CSV com separador ; ou , · colunas: data, placa, litros, hodometro e valor_total ou valor_unitario',
    },
  }));

  /**
   * Confere a chave da NF-e sem tocar na SEFAZ: destrincha UF, emitente, serie e
   * numero, e valida o digito verificador. Util no lancamento fiscal, antes de
   * digitar o resto.
   */
  app.get('/nfe/:chave', { preHandler: [app.autenticar, app.exigirPermissao('nota_fiscal:lancar')] }, async (req) => {
    const { chave } = req.params as { chave: string };

    // o modulo puro lanca erro proprio; aqui ele vira 400 com o motivo exato,
    // em vez de 500 - quem esta com a nota na mao precisa saber o que corrigir
    const conferida = chaveValida(chave);
    if (!conferida.valida) throw new ValidationError(conferida.motivo!);

    return {
      chave: conferida.dados!,
      consultaSefaz: env.SEFAZ_URL && env.SEFAZ_CERTIFICADO
        ? { disponivel: true }
        : {
            disponivel: false,
            motivo:
              'Consulta a SEFAZ nao configurada. Defina SEFAZ_URL e SEFAZ_CERTIFICADO ' +
              '(certificado A1 da empresa) para trazer os dados da nota automaticamente.',
          },
    };
  });

  /**
   * Importacao de abastecimentos do posto interno.
   *
   * Por padrao roda em conferencia (`dryRun`): devolve todos os erros de uma vez,
   * para o operador corrigir o arquivo antes de gravar qualquer coisa.
   */
  app.post('/abastecimentos/importar', {
    preHandler: [app.autenticar, app.exigirPermissao('abastecimento:registrar')],
    // arquivo de um mes de posto passa folgado dos 100 KB padrao do Fastify
    bodyLimit: 5 * 1024 * 1024,
  }, async (req) => {
    const { conteudo, dryRun } = z
      .object({
        conteudo: z.string().min(1, 'Envie o conteudo do arquivo CSV.'),
        dryRun: z.boolean().default(true),
      })
      .parse(req.body);

    const { recorte: unidades } = await resolverUnidadesDoRelatorio(usuarioDe(req));

    return importarAbastecimentos(atorDe(req), conteudo, { dryRun, unidades });
  });
};
